"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireCrewMember } from "@/lib/auth";
import { isISODate, todayInTimeZone } from "@/lib/dates";
import {
  couldNotServiceNote,
  couldNotServiceValuesFromFormData,
  parseCouldNotService,
} from "@/lib/schedule/schema";
import { createClient } from "@/lib/supabase/server";

import type { CouldNotServiceState } from "../schedule/actions";

// Everything here goes through the crew_* database functions, which only ever act on
// jobs assigned to the signed-in person.

const uuid = z.uuid();
const CREW_STATUSES = ["en_route", "in_progress", "completed"] as const;

export type CrewActionState = { error?: string };

function crewError(code: string | undefined, fallback: string) {
  if (code === "P0002") return "This job is no longer assigned to you.";
  if (code === "22023") return "This job is already completed or cancelled.";
  return fallback;
}

export async function setMyJobStatus(jobId: string, status: (typeof CREW_STATUSES)[number]): Promise<CrewActionState> {
  await requireCrewMember();
  if (!uuid.safeParse(jobId).success || !CREW_STATUSES.includes(status)) return { error: "That isn't allowed." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("crew_set_job_status", { job_id: jobId, new_status: status });
  if (error) {
    if (error.code !== "P0002" && error.code !== "22023") console.error("Crew status change failed", error);
    return { error: crewError(error.code, "We couldn't update this job. Please try again.") };
  }
  redirect(`/my-jobs?notice=${status === "completed" ? "completed" : "started"}`);
}

export type NoteState = { error?: string; value?: string };

export async function addMyJobNote(jobId: string, _prev: NoteState, formData: FormData): Promise<NoteState> {
  await requireCrewMember();
  const value = String(formData.get("note") ?? "");
  const note = value.trim();
  if (!note) return { error: "Write a note first.", value };
  if (note.length > 500) return { error: "Keep notes under 500 characters.", value };
  if (!uuid.safeParse(jobId).success) return { error: "This job is no longer assigned to you.", value };

  const supabase = await createClient();
  const { error } = await supabase.rpc("crew_add_job_note", { job_id: jobId, note });
  if (error) {
    if (error.code !== "P0002") console.error("Crew note failed", error);
    return { error: crewError(error.code, "We couldn't save your note. Please try again."), value };
  }
  redirect("/my-jobs?notice=note");
}

export async function crewCouldNotService(
  jobId: string,
  scheduledDate: string,
  _prev: CouldNotServiceState,
  formData: FormData,
): Promise<CouldNotServiceState> {
  const { business } = await requireCrewMember();
  const values = couldNotServiceValuesFromFormData(formData);
  if (!uuid.safeParse(jobId).success || !isISODate(scheduledDate)) {
    return { values, error: "This job is no longer assigned to you." };
  }

  const parsed = parseCouldNotService(values, todayInTimeZone(business.time_zone));
  if (!parsed.success) return { values, fieldErrors: parsed.fieldErrors };

  const { choice, reason } = parsed.data;
  const newDate = choice === "reschedule" ? parsed.data.new_date : null;
  const noteLine = couldNotServiceNote(
    scheduledDate,
    choice === "reschedule" ? { choice, newDate: parsed.data.new_date } : { choice },
    reason,
  );

  const supabase = await createClient();
  const { error } = await supabase.rpc("crew_could_not_service", {
    job_id: jobId,
    choice,
    new_date: newDate as string,
    note_line: noteLine,
  });
  if (error) {
    if (error.code !== "P0002" && error.code !== "22023") console.error("Crew could-not-service failed", error);
    return { values, error: crewError(error.code, "We couldn't update this job. Please try again.") };
  }
  redirect(`/my-jobs?notice=${choice === "reschedule" ? "rescheduled" : "cancelled"}`);
}
