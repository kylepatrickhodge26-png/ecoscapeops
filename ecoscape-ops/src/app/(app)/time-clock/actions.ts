"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();
// Errors the database words for the person (already clocked in elsewhere, visit finished, ...).
const FRIENDLY = new Set(["22023", "23505", "P0002", "42501"]);

// One tap on a visit: starts the workday if needed, clocks in, and starts the visit.
export async function startJob(jobId: string): Promise<{ error?: string }> {
  await requireMembership();
  if (!uuid.safeParse(jobId).success) return { error: "This visit no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_job", { job_id: jobId });
  if (error) {
    if (FRIENDLY.has(error.code)) return { error: `${error.message}.` };
    console.error("Starting a job failed", error);
    return { error: "We couldn't clock you in. Please try again." };
  }
  refresh();
  return {};
}

// Clock out of a visit; with complete, it's marked completed too.
export async function finishJob(jobId: string, complete: boolean): Promise<{ error?: string }> {
  await requireMembership();
  if (!uuid.safeParse(jobId).success) return { error: "This visit no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finish_job", { job_id: jobId, complete });
  if (error) {
    if (FRIENDLY.has(error.code)) return { error: `${error.message}.` };
    console.error("Clocking out of a job failed", error);
    return { error: "We couldn't clock you out. Please try again." };
  }
  refresh();
  return {};
}

export async function startWorkday(): Promise<{ error?: string }> {
  await requireMembership();
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_workday");
  if (error) {
    if (FRIENDLY.has(error.code)) return { error: `${error.message}.` };
    console.error("Starting the workday failed", error);
    return { error: "We couldn't start your day. Please try again." };
  }
  refresh();
  return {};
}

export async function endWorkday(): Promise<{ error?: string }> {
  await requireMembership();
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_workday");
  if (error) {
    if (FRIENDLY.has(error.code)) return { error: `${error.message}.` };
    console.error("Ending the workday failed", error);
    return { error: "We couldn't end your day. Please try again." };
  }
  refresh();
  return {};
}
