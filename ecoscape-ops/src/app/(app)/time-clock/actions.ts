"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();
// Errors the database words for the person (already clocked in elsewhere, visit finished, ...).
const FRIENDLY = new Set(["22023", "23505", "P0002", "42501"]);

export async function clockIn(jobId: string): Promise<{ error?: string }> {
  await requireMembership();
  if (!uuid.safeParse(jobId).success) return { error: "This visit no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("clock_in", { job_id: jobId });
  if (error) {
    if (FRIENDLY.has(error.code)) return { error: `${error.message}.` };
    console.error("Clock in failed", error);
    return { error: "We couldn't clock you in. Please try again." };
  }
  refresh();
  return {};
}

export async function clockOut(jobId: string): Promise<{ error?: string }> {
  await requireMembership();
  if (!uuid.safeParse(jobId).success) return { error: "This visit no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("clock_out", { job_id: jobId });
  if (error) {
    if (FRIENDLY.has(error.code)) return { error: `${error.message}.` };
    console.error("Clock out failed", error);
    return { error: "We couldn't clock you out. Please try again." };
  }
  refresh();
  return {};
}
