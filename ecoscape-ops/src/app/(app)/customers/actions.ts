"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { todayInTimeZone } from "@/lib/dates";
import { MAX_IMPORT_CHARS, buildImport, isImportRole, type ImportRole } from "@/lib/customers/import";
import {
  customerDisplayName,
  customerFormValuesFromFormData,
  emptyCustomerFormValues,
  parseCustomer,
  phoneDigits,
  type CustomerField,
  type CustomerFormValues,
} from "@/lib/customers/schema";
import { locatePendingCustomers } from "@/lib/geo/customers";
import {
  parseNewCustomerService,
  serviceFormValuesFromFormData,
  type ServiceField,
  type ServiceFormValues,
} from "@/lib/schedule/service";
import { removePhotoFiles } from "@/lib/photos/cleanup";
import { siteOrigin } from "@/lib/site-origin";
import { createClient } from "@/lib/supabase/server";

export type CustomerFormState = {
  values: CustomerFormValues;
  error?: string;
  fieldErrors?: Partial<Record<CustomerField, string>>;
  // Set when another customer already has this phone number (new customers only).
  duplicate?: { id: string; name: string };
  // Add customer can book their work in the same step: a repeat service or a one-time job.
  service?: ServiceFormValues;
  serviceErrors?: Partial<Record<ServiceField, string>>;
};

const customerId = z.uuid();

export async function createCustomer(_prev: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const { business } = await requireOwner();
  const values = customerFormValuesFromFormData(formData);
  const parsed = parseCustomer(values);
  // Their work, when it's booked in the same step. Both are checked before anything is saved,
  // so a mistake in either shows up together and nothing is half done.
  const service = formData.has("service_kind") ? serviceFormValuesFromFormData(formData) : undefined;
  const booking = service ? parseNewCustomerService(service, todayInTimeZone(business.time_zone)) : undefined;
  if (!parsed.success || (booking && !booking.success)) {
    return {
      values,
      service,
      fieldErrors: parsed.success ? undefined : parsed.fieldErrors,
      serviceErrors: booking && !booking.success ? booking.fieldErrors : undefined,
    };
  }

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
      return { values, service, duplicate: { id: existing.id, name: customerDisplayName(existing) } };
    }
  }

  const { data, error } = await supabase
    .from("customers")
    .insert({ ...parsed.data, business_id: business.id })
    .select("id")
    .single();

  if (error) {
    console.error("Create customer failed", error);
    return { values, service, error: "We couldn't save this customer. Please try again." };
  }

  // Book their work (the database adds the visits: 6 for a repeat service, 1 for a one-time job).
  let notice = "created";
  if (booking?.data) {
    const { data: plan, error: planError } = await supabase
      .from("service_plans")
      .insert({ ...booking.data, customer_id: data.id, business_id: business.id })
      .select("paused")
      .single();
    if (planError) console.error("Booking a new customer's work failed", planError);
    notice = planError ? "created-not-booked" : plan.paused ? "booked-waiting" : "created-booked";
  }

  await locateCustomer(business.id, data.id);
  redirect(`/customers/${data.id}?notice=${notice}`);
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

// Done for the season: marking a customer inactive takes their upcoming repeat visits off the
// schedule, and marking them active brings them back on their regular day. The database does
// the work when the status changes (so the Edit form's Status does the same); these are the
// one-tap buttons on the customer's page.
async function upcomingRepeatVisits(customerId: string, today: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("scheduled_date, service_plans!inner(frequency)")
    .eq("customer_id", customerId)
    .gte("scheduled_date", today)
    .in("status", ["scheduled", "assigned", "weather_delay"])
    .neq("service_plans.frequency", "one_time")
    .order("scheduled_date");
  if (error) throw new Error(`Could not load visits: ${error.message}`);
  return data.map((v) => v.scheduled_date);
}

// Their earlier repeat visits that were never done: Done for the season cancels these.
async function leftoverRepeatVisits(customerId: string, today: string) {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("id, service_plans!inner(frequency)", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .lt("scheduled_date", today)
    .in("status", ["scheduled", "assigned", "weather_delay", "unable_to_complete"])
    .neq("service_plans.frequency", "one_time");
  if (error) throw new Error(`Could not load visits: ${error.message}`);
  return count ?? 0;
}

async function setCustomerStatus(id: string, status: "active" | "inactive") {
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").update({ status }).eq("id", id).select("id");
  if (error) {
    console.error("Changing customer status failed", error);
    return "We couldn't save that. Please try again.";
  }
  if (data.length === 0) return "This customer no longer exists.";
  return null;
}

export async function endCustomerSeason(id: string): Promise<{ error?: string }> {
  const { business } = await requireOwner();
  if (!customerId.safeParse(id).success) return { error: "This customer no longer exists." };
  const today = todayInTimeZone(business.time_zone);
  const [before, leftover] = await Promise.all([upcomingRepeatVisits(id, today), leftoverRepeatVisits(id, today)]);
  const problem = await setCustomerStatus(id, "inactive");
  if (problem) return { error: problem };
  redirect(`/customers/${id}?notice=season-ended&removed=${before.length}&cancelled=${leftover}`);
}

export async function startCustomerSeason(id: string): Promise<{ error?: string }> {
  const { business } = await requireOwner();
  if (!customerId.safeParse(id).success) return { error: "This customer no longer exists." };
  const problem = await setCustomerStatus(id, "active");
  if (problem) return { error: problem };
  const [next] = await upcomingRepeatVisits(id, todayInTimeZone(business.time_zone));
  redirect(`/customers/${id}?notice=season-started${next ? `&next=${next}` : ""}`);
}

// ---------------------------------------------------------------------------
// Importing a list
// ---------------------------------------------------------------------------
export type ImportState = { error?: string };

// Adds every customer in a pasted list or CSV file at once (see lib/customers/import.ts),
// using the columns picked in the preview. Customers already on file (same phone number, or
// same name and address) and rows with no way to reach anyone are left out.
export async function importCustomers(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const { business } = await requireOwner();
  const text = String(formData.get("text") ?? "");
  if (text.trim() === "") return { error: "Paste your list or choose a file first." };
  if (text.length > MAX_IMPORT_CHARS) return { error: "That list is too long. Split it into smaller lists of up to 500 customers." };
  let roles: ImportRole[] | undefined;
  try {
    const parsedRoles: unknown = JSON.parse(String(formData.get("roles") ?? "[]"));
    roles = Array.isArray(parsedRoles) ? parsedRoles.map((r) => (isImportRole(r) ? r : "skip")) : undefined;
  } catch {
    roles = undefined;
  }
  const result = buildImport(text, { roles, hasHeader: formData.get("has_header") === "1" });

  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("customers")
    .select("phone_digits, first_name, last_name, property_address")
    .eq("business_id", business.id);
  if (existingError) {
    console.error("Loading customers for an import failed", existingError);
    return { error: "We couldn't check your customers. Please try again." };
  }
  const key = (c: { first_name: string; last_name: string; property_address: string }) =>
    `${c.first_name} ${c.last_name}|${c.property_address}`.toLowerCase().replace(/\s+/g, " ").trim();
  const phones = new Set(existing.map((c) => c.phone_digits).filter(Boolean));
  const names = new Set(existing.map(key));

  const today = todayInTimeZone(business.time_zone);
  const rows = [];
  let duplicates = 0;
  let unusable = result.skipped.length;
  for (const row of result.rows) {
    const digits = phoneDigits(row.phone);
    if ((digits && phones.has(digits)) || names.has(key(row))) {
      duplicates++;
      continue;
    }
    const parsed = parseCustomer({
      ...emptyCustomerFormValues(),
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone,
      email: row.email,
      property_address: row.property_address,
      service_notes: row.service_notes,
      customer_since: today,
    });
    if (!parsed.success) {
      unusable++;
      continue;
    }
    if (digits) phones.add(digits);
    names.add(key(row));
    rows.push({ ...parsed.data, business_id: business.id });
  }
  if (rows.length === 0) {
    return {
      error:
        duplicates > 0
          ? "Everyone on that list is already in your customers."
          : "None of those rows had a name, phone number or email to add.",
    };
  }

  const { data: added, error } = await supabase.from("customers").insert(rows).select("id");
  if (error) {
    console.error("Importing customers failed", error);
    return { error: "We couldn't add those customers. Please try again." };
  }
  // Look up as many addresses as there's time for now; the customers page finishes the rest.
  try {
    await locatePendingCustomers(business.id, { customerIds: added.map((c) => c.id), budgetMs: 6_000 });
  } catch (lookupError) {
    console.error("Looking up imported addresses failed", lookupError);
  }
  redirect(`/customers?notice=imported&added=${added.length}&same=${duplicates}&bad=${unusable}`);
}

// After an import: look up the addresses still waiting, a batch at a time, while the
// customers page is open (no scheduled job). Says how many are left.
export async function locateWaitingCustomers(): Promise<{ remaining: number }> {
  const { business } = await requireOwner();
  try {
    return await locatePendingCustomers(business.id, { budgetMs: 8_000 });
  } catch (error) {
    console.error("Looking up waiting addresses failed", error);
    return { remaining: -1 };
  }
}
