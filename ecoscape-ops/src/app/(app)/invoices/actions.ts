"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { invoiceSchema, paymentSchema, type InvoiceFormValues } from "@/lib/invoices/schema";
import { siteOrigin } from "@/lib/site-origin";
import { stripeOnboardingLink } from "@/lib/stripe/connect";
import { createClient } from "@/lib/supabase/server";

// Invoices are owner-only. The database enforces that and every invoice rule regardless;
// these actions validate input and turn database errors into friendly messages.

const uuid = z.uuid();

type InvoiceField = "customer_id" | "due_date" | "notes" | "lines";

export type InvoiceFormState = {
  values: InvoiceFormValues;
  error?: string;
  fieldErrors?: Partial<Record<InvoiceField, string>>;
};

function invoiceValuesFromFormData(formData: FormData): InvoiceFormValues {
  let lines: InvoiceFormValues["lines"] = [];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("lines") ?? "[]"));
    if (Array.isArray(parsed)) {
      lines = parsed.map((l) => ({
        job_id: typeof l?.job_id === "string" && l.job_id ? l.job_id : null,
        description: String(l?.description ?? ""),
        quantity: String(l?.quantity ?? ""),
        unit_price: String(l?.unit_price ?? ""),
      }));
    }
  } catch {
    // Treated as no lines.
  }
  return {
    customer_id: String(formData.get("customer_id") ?? ""),
    due_date: String(formData.get("due_date") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    lines,
  };
}

export async function saveInvoice(invoiceId: string | null, _prev: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  await requireOwner();
  const values = invoiceValuesFromFormData(formData);
  if (invoiceId !== null && !uuid.safeParse(invoiceId).success) return { values, error: "This invoice no longer exists." };

  const parsed = invoiceSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: InvoiceFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as InvoiceField;
      if (fieldErrors[field]) continue;
      fieldErrors[field] = field === "lines" && typeof issue.path[1] === "number" ? `Line ${issue.path[1] + 1}: ${issue.message}` : issue.message;
    }
    return { values, fieldErrors };
  }

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("save_invoice", {
    invoice_id: invoiceId as string,
    customer_id: parsed.data.customer_id,
    due_date: parsed.data.due_date,
    notes: parsed.data.notes,
    lines: parsed.data.lines,
  });
  if (error) {
    if (error.code === "23505") return { values, fieldErrors: { lines: error.message } };
    if (error.code === "22023") return { values, error: `${error.message}.` };
    if (error.code === "P0002") return { values, error: `${error.message}.` };
    console.error("Saving invoice failed", error);
    return { values, error: "We couldn't save this invoice. Please try again." };
  }

  redirect(`/invoices/${id}?notice=${invoiceId ? "updated" : "created"}`);
}

// Marks an invoice sent: called when the owner texts or copies its pay link, or says
// they've sent it another way.
export async function markInvoiceSent(invoiceId: string): Promise<{ error?: string }> {
  await requireOwner();
  if (!uuid.safeParse(invoiceId).success) return { error: "This invoice no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_invoice", { invoice_id: invoiceId });
  if (error) {
    if (error.code !== "22023" && error.code !== "P0002") console.error("Sending invoice failed", error);
    return { error: error.code === "22023" || error.code === "P0002" ? `${error.message}.` : "We couldn't update this invoice." };
  }
  refresh();
  return {};
}

export async function cancelInvoice(invoiceId: string): Promise<{ error?: string }> {
  await requireOwner();
  if (!uuid.safeParse(invoiceId).success) return { error: "This invoice no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_invoice", { invoice_id: invoiceId });
  if (error) {
    if (error.code === "22023" || error.code === "P0002") return { error: `${error.message}.` };
    console.error("Cancelling invoice failed", error);
    return { error: "We couldn't cancel this invoice. Please try again." };
  }
  redirect(`/invoices/${invoiceId}?notice=cancelled`);
}

export async function deleteDraftInvoice(invoiceId: string): Promise<{ error?: string }> {
  await requireOwner();
  if (!uuid.safeParse(invoiceId).success) return { error: "This invoice no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_draft_invoice", { invoice_id: invoiceId });
  if (error) {
    if (error.code === "22023" || error.code === "P0002") return { error: `${error.message}.` };
    console.error("Deleting invoice failed", error);
    return { error: "We couldn't delete this draft. Please try again." };
  }
  redirect("/invoices?notice=deleted");
}

export type DueDateState = { value: string; error?: string; saved?: boolean };

export async function changeDueDate(invoiceId: string, _prev: DueDateState, formData: FormData): Promise<DueDateState> {
  await requireOwner();
  const value = String(formData.get("due_date") ?? "");
  if (!uuid.safeParse(invoiceId).success) return { value, error: "This invoice no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("change_invoice_due_date", { invoice_id: invoiceId, due_date: value });
  if (error) {
    if (error.code === "22023" || error.code === "P0002" || error.code === "22007" || error.code === "22008") {
      return { value, error: error.code.startsWith("2200") ? "Choose a valid date." : `${error.message}.` };
    }
    console.error("Changing due date failed", error);
    return { value, error: "We couldn't change the due date. Please try again." };
  }
  refresh();
  return { value, saved: true };
}

type PaymentField = "amount" | "method" | "received_on" | "note";
export type PaymentFormValues = Record<PaymentField, string> & { request_id: string };
export type PaymentFormState = {
  values: PaymentFormValues;
  error?: string;
  fieldErrors?: Partial<Record<PaymentField, string>>;
};

// Records a cash/check/other payment. The form carries a request id, so submitting it
// twice (a double tap, a retry) records the payment once.
export async function recordPayment(invoiceId: string, _prev: PaymentFormState, formData: FormData): Promise<PaymentFormState> {
  await requireOwner();
  const values: PaymentFormValues = {
    amount: String(formData.get("amount") ?? ""),
    method: String(formData.get("method") ?? ""),
    received_on: String(formData.get("received_on") ?? ""),
    note: String(formData.get("note") ?? ""),
    request_id: String(formData.get("request_id") ?? ""),
  };
  if (!uuid.safeParse(invoiceId).success) return { values, error: "This invoice no longer exists." };
  const parsed = paymentSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: PaymentFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as PaymentField;
      fieldErrors[field] ??= issue.message;
    }
    if (Object.keys(fieldErrors).length === 0) return { values, error: "Please reload the page and try again." };
    return { values, fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_manual_payment", { invoice_id: invoiceId, ...parsed.data });
  if (error) {
    if (error.code === "22023" || error.code === "P0002") return { values, error: `${error.message}.` };
    console.error("Recording payment failed", error);
    return { values, error: "We couldn't record this payment. Please try again." };
  }
  redirect(`/invoices/${invoiceId}?notice=payment`);
}

export async function deletePayment(invoiceId: string, paymentId: string): Promise<{ error?: string }> {
  await requireOwner();
  if (!uuid.safeParse(paymentId).success) return { error: "This payment no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_manual_payment", { payment_id: paymentId });
  if (error) {
    if (error.code === "22023" || error.code === "P0002") return { error: `${error.message}.` };
    console.error("Removing payment failed", error);
    return { error: "We couldn't remove this payment. Please try again." };
  }
  redirect(`/invoices/${invoiceId}?notice=payment-removed`);
}

export async function setAutoInvoice(enabled: boolean): Promise<{ error?: string }> {
  await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_auto_invoice", { enabled });
  if (error) {
    console.error("Saving auto-invoice setting failed", error);
    return { error: "We couldn't save that setting. Please try again." };
  }
  refresh();
  return {};
}

// Starts (or continues) Stripe's own onboarding for this business's Stripe account.
export async function connectStripe(): Promise<{ error?: string }> {
  const membership = await requireOwner();
  const result = await stripeOnboardingLink(membership, await siteOrigin());
  if ("error" in result) return result;
  redirect(result.url);
}
