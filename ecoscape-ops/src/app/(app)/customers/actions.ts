"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import {
  customerDisplayName,
  customerFormValuesFromFormData,
  parseCustomer,
  phoneDigits,
  type CustomerField,
  type CustomerFormValues,
} from "@/lib/customers/schema";
import { locatePendingCustomers } from "@/lib/geo/customers";
import { removePhotoFiles } from "@/lib/photos/cleanup";
import { siteOrigin } from "@/lib/site-origin";
import { createClient } from "@/lib/supabase/server";

export type CustomerFormState = {
  values: CustomerFormValues;
  error?: string;
  fieldErrors?: Partial<Record<CustomerField, string>>;
  // Set when another customer already has this phone number (new customers only).
  duplicate?: { id: string; name: string };
};

const customerId = z.uuid();

export async function createCustomer(_prev: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const { business } = await requireOwner();
  const values = customerFormValuesFromFormData(formData);
  const parsed = parseCustomer(values);
  if (!parsed.success) return { values, fieldErrors: parsed.fieldErrors };

  const supabase = await createClient();

  // Like the prototype: warn when the phone number is already on file, and let the
  // owner add the customer anyway.
  const digits = phoneDigits(parsed.data.phone);
  if (digits && formData.get("confirm_duplicate") !== "1") {
    const { data: existing } = await supabase
      .from("customers")
      .select("id, first_name, last_name, phone, email")
      .eq("business_id", business.id)
      .eq("phone_digits", digits)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return { values, duplicate: { id: existing.id, name: customerDisplayName(existing) } };
    }
  }

  const { data, error } = await supabase
    .from("customers")
    .insert({ ...parsed.data, business_id: business.id })
    .select("id")
    .single();

  if (error) {
    console.error("Create customer failed", error);
    return { values, error: "We couldn't save this customer. Please try again." };
  }

  await locateCustomer(business.id, data.id);
  redirect(`/customers/${data.id}?notice=created`);
}

export async function updateCustomer(
  id: string,
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const { business } = await requireOwner();
  const values = customerFormValuesFromFormData(formData);
  if (!customerId.safeParse(id).success) return { values, error: "This customer no longer exists." };

  const parsed = parseCustomer(values);
  if (!parsed.success) return { values, fieldErrors: parsed.fieldErrors };

  const supabase = await createClient();
  // RLS limits this to the owner's own business; a customer from another business
  // matches zero rows, exactly like one that doesn't exist.
  const { data, error } = await supabase.from("customers").update(parsed.data).eq("id", id).select("id");

  if (error) {
    console.error("Update customer failed", error);
    return { values, error: "We couldn't save your changes. Please try again." };
  }
  if (data.length === 0) return { values, error: "This customer no longer exists." };

  // A changed address goes back to "pending" in the database; look it up again now.
  await locateCustomer(business.id, id);
  redirect(`/customers/${id}?notice=updated`);
}

export type DeleteCustomerState = { error?: string };

export async function deleteCustomer(id: string): Promise<DeleteCustomerState> {
  await requireOwner();
  if (!customerId.safeParse(id).success) return { error: "This customer no longer exists." };

  const supabase = await createClient();
  await removePhotoFiles(supabase, { customerId: id });
  const { data, error } = await supabase.from("customers").delete().eq("id", id).select("id");

  if (error) {
    console.error("Delete customer failed", error);
    return { error: "We couldn't delete this customer. Please try again." };
  }
  if (data.length === 0) return { error: "This customer no longer exists." };

  redirect("/customers?notice=deleted");
}

// Looks up a customer's address if it hasn't been yet (new or changed). Never stops a
// save: if the lookup fails, the address stays "pending" and is tried again later.
async function locateCustomer(businessId: string, id: string) {
  try {
    await locatePendingCustomers(businessId, { customerIds: [id], budgetMs: 9_000 });
  } catch (error) {
    console.error("Looking up the customer's address failed", error);
  }
}

export async function locateCustomerNow(id: string): Promise<void> {
  const { business } = await requireOwner();
  if (!customerId.safeParse(id).success) redirect("/customers");
  await locateCustomer(business.id, id);
  redirect(`/customers/${id}?notice=located`);
}

// Monthly billing: one invoice a month for this customer's completed visits, made from the
// Invoices page, instead of an invoice per visit.
export async function setBillMonthly(id: string, enabled: boolean): Promise<{ error?: string }> {
  await requireOwner();
  if (!customerId.safeParse(id).success) return { error: "This customer no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_customer_bill_monthly", { customer_id: id, enabled });
  if (error) {
    if (error.code === "P0002") return { error: "This customer no longer exists." };
    console.error("Saving monthly billing failed", error);
    return { error: "We couldn't save that. Please try again." };
  }
  refresh();
  return {};
}

// Customer accounts: an invite link the customer uses to create their own login.
export type CustomerInviteState = { error?: string; inviteUrl?: string };

export async function inviteCustomer(id: string): Promise<CustomerInviteState> {
  await requireOwner();
  if (!customerId.safeParse(id).success) return { error: "This customer no longer exists." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_customer", { customer_id: id });
  if (error || !data) {
    if (error?.code === "23505") return { error: "This customer already has an account." };
    if (error?.code === "P0002") return { error: "This customer no longer exists." };
    console.error("Inviting customer failed", error);
    return { error: "We couldn't make an invite link. Please try again." };
  }
  refresh();
  return { inviteUrl: `${await siteOrigin()}/join/customer/${data}` };
}

export async function removeCustomerAccess(id: string): Promise<{ error?: string }> {
  await requireOwner();
  if (!customerId.safeParse(id).success) return { error: "This customer no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_customer_access", { customer_id: id });
  if (error && error.code !== "P0002") {
    console.error("Removing customer access failed", error);
    return { error: "We couldn't remove access. Please try again." };
  }
  redirect(`/customers/${id}?notice=access-removed`);
}
