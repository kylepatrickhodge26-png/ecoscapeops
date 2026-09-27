"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { monthOf, todayInTimeZone } from "@/lib/dates";
import { isClosed } from "@/lib/schedule/constants";
import {
  appendNote,
  bookingFormValuesFromFormData,
  couldNotServiceNote,
  couldNotServiceValuesFromFormData,
  jobFormValuesFromFormData,
  parseBooking,
  parseCouldNotService,
  parseJob,
  type BookingField,
  type BookingFormValues,
  type CouldNotServiceField,
  type CouldNotServiceValues,
  type JobField,
  type JobFormValues,
} from "@/lib/schedule/schema";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------
export type BookingFormState = {
  values: BookingFormValues;
  error?: string;
  fieldErrors?: Partial<Record<BookingField, string>>;
};

export async function bookService(_prev: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const { business } = await requireOwner();
  const values = bookingFormValuesFromFormData(formData);
  const parsed = parseBooking(values, todayInTimeZone(business.time_zone));
  if (!parsed.success) return { values, fieldErrors: parsed.fieldErrors };

  const supabase = await createClient();
  // The database generates the visits (6 for recurring, 1 for one-time).
  const { data, error } = await supabase
    .from("service_plans")
    .insert({ ...parsed.data, business_id: business.id })
    .select("id, start_date")
    .single();

  if (error) {
    // 23503: the customer or crew member isn't in this business (e.g. removed in another tab).
    if (error.code === "23503") {
      return error.message.includes("crew")
        ? { values, fieldErrors: { assigned_crew_member_id: "Choose a crew member" } }
        : { values, fieldErrors: { customer_id: "Choose a customer" } };
    }
    console.error("Book service failed", error);
    return { values, error: "We couldn't book this service. Please try again." };
  }

  redirect(`/schedule?month=${monthOf(data.start_date)}&booked=${data.id}`);
}

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------
export type JobFormState = {
  values: JobFormValues;
  error?: string;
  fieldErrors?: Partial<Record<JobField, string>>;
};

export async function updateJob(id: string, _prev: JobFormState, formData: FormData): Promise<JobFormState> {
  await requireOwner();
  const values = jobFormValuesFromFormData(formData);
  if (!uuid.safeParse(id).success) return { values, error: "This visit no longer exists." };

  const parsed = parseJob(values);
  if (!parsed.success) return { values, fieldErrors: parsed.fieldErrors };

  // "Assign to" is only on the form once there's a crew to assign to; without it,
  // leave the assignment alone rather than clearing it.
  const { assigned_crew_member_id, ...rest } = parsed.data;
  const update = formData.has("assigned_crew_member_id") ? { ...rest, assigned_crew_member_id } : rest;

  const supabase = await createClient();
  const { data, error } = await supabase.from("jobs").update(update).eq("id", id).select("id");
  if (error) {
    if (error.code === "23503") return { values, fieldErrors: { assigned_crew_member_id: "Choose a crew member" } };
    console.error("Update visit failed", error);
    return { values, error: "We couldn't save your changes. Please try again." };
  }
  if (data.length === 0) return { values, error: "This visit no longer exists." };

  redirect(`/schedule/jobs/${id}?notice=updated`);
}

export type ActionResult = { error?: string };

export async function markJobCompleted(id: string): Promise<ActionResult> {
  await requireOwner();
  if (!uuid.safeParse(id).success) return { error: "This visit no longer exists." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("jobs").update({ status: "completed" }).eq("id", id).select("id");
  if (error) {
    console.error("Complete visit failed", error);
    return { error: "We couldn't update this visit. Please try again." };
  }
  if (data.length === 0) return { error: "This visit no longer exists." };

  redirect(`/schedule/jobs/${id}?notice=completed`);
}

export type CouldNotServiceState = {
  values: CouldNotServiceValues;
  error?: string;
  fieldErrors?: Partial<Record<CouldNotServiceField, string>>;
};

// "Could not service" always ends in a decision: move the visit to a new day, or
// cancel it. Either way the reason is kept in the visit's notes.
export async function couldNotService(
  id: string,
  _prev: CouldNotServiceState,
  formData: FormData,
): Promise<CouldNotServiceState> {
  const { business } = await requireOwner();
  const values = couldNotServiceValuesFromFormData(formData);
  if (!uuid.safeParse(id).success) return { values, error: "This visit no longer exists." };

  const parsed = parseCouldNotService(values, todayInTimeZone(business.time_zone));
  if (!parsed.success) return { values, fieldErrors: parsed.fieldErrors };

  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("scheduled_date, notes, status").eq("id", id).maybeSingle();
  if (!job) return { values, error: "This visit no longer exists." };
  if (isClosed(job.status)) return { values, error: "This visit is already completed or cancelled." };

  const { choice, reason } = parsed.data;
  const note = couldNotServiceNote(
    job.scheduled_date,
    choice === "reschedule" ? { choice, newDate: parsed.data.new_date } : { choice },
    reason,
  );
  const update =
    choice === "reschedule"
      ? { scheduled_date: parsed.data.new_date, status: "scheduled" as const }
      : { status: "cancelled" as const };

  const { error } = await supabase
    .from("jobs")
    .update({ ...update, notes: appendNote(job.notes, note) })
    .eq("id", id);
  if (error) {
    console.error("Could-not-service update failed", error);
    return { values, error: "We couldn't update this visit. Please try again." };
  }

  redirect(`/schedule/jobs/${id}?notice=${choice === "reschedule" ? "rescheduled" : "cancelled"}`);
}

export async function deleteJob(id: string): Promise<ActionResult> {
  await requireOwner();
  if (!uuid.safeParse(id).success) return { error: "This visit no longer exists." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .delete()
    .eq("id", id)
    .select("scheduled_date");
  if (error) {
    console.error("Delete visit failed", error);
    return { error: "We couldn't delete this visit. Please try again." };
  }
  if (data.length === 0) return { error: "This visit no longer exists." };

  redirect(`/schedule/day/${data[0].scheduled_date}?notice=deleted`);
}

// ---------------------------------------------------------------------------
// Service plans
// ---------------------------------------------------------------------------
export async function stopServicePlan(planId: string, customerId: string): Promise<ActionResult> {
  await requireOwner();
  if (!uuid.safeParse(planId).success || !uuid.safeParse(customerId).success) {
    return { error: "This service no longer exists." };
  }

  const supabase = await createClient();
  const { data: removed, error } = await supabase.rpc("stop_service_plan", { plan_id: planId });
  if (error) {
    if (error.code === "P0002") return { error: "This service no longer exists." };
    console.error("Stop service failed", error);
    return { error: "We couldn't stop this service. Please try again." };
  }

  redirect(`/customers/${customerId}?notice=stopped&removed=${removed}`);
}
