"use server";

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

  redirect(`/customers/${data.id}?notice=created`);
}

export async function updateCustomer(
  id: string,
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  await requireOwner();
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

  redirect(`/customers/${id}?notice=updated`);
}

export type DeleteCustomerState = { error?: string };

export async function deleteCustomer(id: string): Promise<DeleteCustomerState> {
  await requireOwner();
  if (!customerId.safeParse(id).success) return { error: "This customer no longer exists." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").delete().eq("id", id).select("id");

  if (error) {
    console.error("Delete customer failed", error);
    return { error: "We couldn't delete this customer. Please try again." };
  }
  if (data.length === 0) return { error: "This customer no longer exists." };

  redirect("/customers?notice=deleted");
}
