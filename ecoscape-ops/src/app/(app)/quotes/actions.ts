"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { acceptSchema, quoteSchema, type AcceptField, type QuoteFormValues } from "@/lib/quotes/schema";
import { createClient } from "@/lib/supabase/server";

// Quotes are owner-only. The database enforces that and every quote rule regardless;
// these actions validate input and turn database errors into friendly messages.

const uuid = z.uuid();
const FRIENDLY = new Set(["22023", "P0002", "23514"]);

type QuoteField = keyof QuoteFormValues;

export type QuoteFormState = {
  values: QuoteFormValues;
  error?: string;
  fieldErrors?: Partial<Record<QuoteField, string>>;
};

function quoteValuesFromFormData(formData: FormData): QuoteFormValues {
  let lines: QuoteFormValues["lines"] = [];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("lines") ?? "[]"));
    if (Array.isArray(parsed)) {
      lines = parsed.map((l) => ({
        description: String(l?.description ?? ""),
        quantity: String(l?.quantity ?? ""),
        unit_price: String(l?.unit_price ?? ""),
      }));
    }
  } catch {
    // Treated as no lines.
  }
  const text = (name: string) => String(formData.get(name) ?? "");
  return {
    customer_id: text("customer_id"),
    prospect_name: text("prospect_name"),
    prospect_phone: text("prospect_phone"),
    prospect_email: text("prospect_email"),
    prospect_address: text("prospect_address"),
    title: text("title"),
    expires_on: text("expires_on"),
    notes: text("notes"),
    lines,
  };
}

export async function saveQuote(quoteId: string | null, _prev: QuoteFormState, formData: FormData): Promise<QuoteFormState> {
  await requireOwner();
  const values = quoteValuesFromFormData(formData);
  if (quoteId !== null && !uuid.safeParse(quoteId).success) return { values, error: "This quote no longer exists." };

  const parsed = quoteSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: QuoteFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as QuoteField;
      if (fieldErrors[field]) continue;
      fieldErrors[field] = field === "lines" && typeof issue.path[1] === "number" ? `Line ${issue.path[1] + 1}: ${issue.message}` : issue.message;
    }
    return { values, fieldErrors };
  }

  const q = parsed.data;
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("save_quote", {
    quote_id: quoteId as string,
    customer_id: (q.customer_id || null) as string,
    prospect_name: q.prospect_name,
    prospect_phone: q.prospect_phone,
    prospect_email: q.prospect_email,
    prospect_address: q.prospect_address,
    title: q.title,
    expires_on: q.expires_on,
    notes: q.notes,
    lines: q.lines,
  });
  if (error) {
    if (FRIENDLY.has(error.code)) return { values, error: `${error.message}.` };
    console.error("Saving quote failed", error);
    return { values, error: "We couldn't save this quote. Please try again." };
  }

  redirect(`/quotes/${id}?notice=${quoteId ? "updated" : "created"}`);
}

type Rpc = "send_quote" | "decline_quote" | "duplicate_quote" | "delete_draft_quote";

async function run(quoteId: string, fn: Rpc): Promise<{ error?: string; data?: unknown }> {
  await requireOwner();
  if (!uuid.safeParse(quoteId).success) return { error: "This quote no longer exists." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, { quote_id: quoteId });
  if (error) {
    if (FRIENDLY.has(error.code)) return { error: `${error.message}.` };
    console.error(`${fn} failed`, error);
    return { error: "Something went wrong. Please try again." };
  }
  return { data };
}

// Marks a quote sent: called when the owner texts or copies it, or says they've sent it
// another way.
export async function markQuoteSent(quoteId: string): Promise<{ error?: string }> {
  const result = await run(quoteId, "send_quote");
  if (result.error) return { error: result.error };
  refresh();
  return {};
}

export async function declineQuote(quoteId: string): Promise<{ error?: string }> {
  const result = await run(quoteId, "decline_quote");
  if (result.error) return { error: result.error };
  redirect(`/quotes/${quoteId}?notice=declined`);
}

export async function deleteDraftQuote(quoteId: string): Promise<{ error?: string }> {
  const result = await run(quoteId, "delete_draft_quote");
  if (result.error) return { error: result.error };
  redirect("/quotes?notice=deleted");
}

export async function duplicateQuote(quoteId: string): Promise<{ error?: string }> {
  const result = await run(quoteId, "duplicate_quote");
  if (result.error) return { error: result.error };
  redirect(`/quotes/${result.data}?notice=copied`);
}

export type AcceptValues = Record<AcceptField, string>;
export type AcceptState = { values: AcceptValues; error?: string; fieldErrors?: Partial<Record<AcceptField, string>> };

// Accepts a quote: books the work (a recurring service or a one-time visit) at the
// quote's total, creating the customer first if it was a prospect.
export async function acceptQuote(quoteId: string, _prev: AcceptState, formData: FormData): Promise<AcceptState> {
  await requireOwner();
  const text = (name: AcceptField) => String(formData.get(name) ?? "");
  const values: AcceptValues = {
    service_name: text("service_name"),
    frequency: text("frequency"),
    first_visit: text("first_visit"),
    assigned_crew_member_id: text("assigned_crew_member_id"),
  };
  if (!uuid.safeParse(quoteId).success) return { values, error: "This quote no longer exists." };
  const parsed = acceptSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: AcceptState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as AcceptField] ??= issue.message;
    return { values, fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_quote", {
    quote_id: quoteId,
    service_name: parsed.data.service_name,
    frequency: parsed.data.frequency,
    first_visit: parsed.data.first_visit,
    assigned_crew_member_id: (parsed.data.assigned_crew_member_id || undefined) as string,
  });
  if (error) {
    if (FRIENDLY.has(error.code)) return { values, error: `${error.message}.` };
    console.error("Accepting quote failed", error);
    return { values, error: "We couldn't book this quote. Please try again." };
  }
  redirect(`/quotes/${quoteId}?notice=accepted`);
}
