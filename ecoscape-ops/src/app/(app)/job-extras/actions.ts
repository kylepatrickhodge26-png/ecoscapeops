"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { requireMembership, requireOwner } from "@/lib/auth";
import { MAX_CAPTION, PHOTO_BUCKET, PHOTO_KINDS } from "@/lib/photos/constants";
import { createClient } from "@/lib/supabase/server";

// Checklists and photos on a job. The owner and the crew member a job is assigned to can use
// them; the database (row-level security on storage, and these functions) decides who that is.

const uuid = z.uuid();
const FRIENDLY = new Set(["22023", "P0002", "42501"]);

export async function toggleChecklistItem(itemId: string, done: boolean): Promise<{ error?: string }> {
  await requireMembership();
  if (!uuid.safeParse(itemId).success) return { error: "This checklist item no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_checklist_item", { item_id: itemId, done });
  if (error) {
    if (FRIENDLY.has(error.code)) return { error: `${error.message}.` };
    console.error("Ticking checklist item failed", error);
    return { error: "We couldn't save that. Please try again." };
  }
  refresh();
  return {};
}

// Called after the browser has uploaded the file: records the photo against the job.
export async function recordJobPhoto(jobId: string, path: string, kind: string, caption: string): Promise<{ error?: string }> {
  await requireMembership();
  if (!uuid.safeParse(jobId).success) return { error: "This job no longer exists." };
  if (!(PHOTO_KINDS as readonly string[]).includes(kind)) return { error: "Choose before, after or other." };
  if (caption.length > MAX_CAPTION) return { error: `Captions must be ${MAX_CAPTION} characters or fewer.` };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_job_photo", {
    job_id: jobId,
    storage_path: path,
    kind: kind as (typeof PHOTO_KINDS)[number],
    caption,
  });
  if (error) {
    if (FRIENDLY.has(error.code)) return { error: `${error.message}.` };
    console.error("Recording photo failed", error);
    return { error: "We couldn't save that photo. Please try again." };
  }
  refresh();
  return {};
}

export async function removeJobPhoto(photoId: string): Promise<{ error?: string }> {
  await requireOwner();
  if (!uuid.safeParse(photoId).success) return { error: "This photo no longer exists." };
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("delete_job_photo", { photo_id: photoId });
  if (error) {
    if (FRIENDLY.has(error.code)) return { error: `${error.message}.` };
    console.error("Removing photo failed", error);
    return { error: "We couldn't remove that photo. Please try again." };
  }
  // The record is gone; remove the file too so it stops using storage.
  const { error: fileError } = await supabase.storage.from(PHOTO_BUCKET).remove([path]);
  if (fileError) console.error("Removing photo file failed", fileError);
  refresh();
  return {};
}
