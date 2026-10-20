"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { localInputToTimestamp } from "@/lib/time/format";

const uuid = z.uuid();

export type EditTimeState = { values: { started: string; ended: string; note: string }; error?: string };

export async function editTimeEntry(id: string, _prev: EditTimeState, formData: FormData): Promise<EditTimeState> {
  await requireOwner();
  const values = {
    started: String(formData.get("started") ?? ""),
    ended: String(formData.get("ended") ?? ""),
    note: String(formData.get("note") ?? ""),
  };
  if (!uuid.safeParse(id).success) return { values, error: "This time entry no longer exists." };
  const started = localInputToTimestamp(values.started);
  if (!started) return { values, error: "Enter a start time." };
  const ended = values.ended === "" ? null : localInputToTimestamp(values.ended);
  if (values.ended !== "" && !ended) return { values, error: "Enter a valid end time, or leave it empty if they're still clocked in." };
  if (values.note.trim() === "") return { values, error: "Add a note saying why you changed this." };
  if (values.note.length > 500) return { values, error: "The note must be 500 characters or fewer." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_time_entry", { entry_id: id, started_local: started, ended_local: ended as never, note: values.note });
  if (error) {
    if (error.code === "22023" || error.code === "P0002") return { values, error: `${error.message}.` };
    console.error("Editing time entry failed", error);
    return { values, error: "We couldn't save that. Please try again." };
  }
  redirect("/time?notice=saved");
}

export async function deleteTimeEntry(id: string): Promise<{ error?: string }> {
  await requireOwner();
  if (!uuid.safeParse(id).success) return { error: "This time entry no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_time_entry", { entry_id: id });
  if (error && error.code !== "P0002") {
    console.error("Deleting time entry failed", error);
    return { error: "We couldn't delete that. Please try again." };
  }
  redirect("/time?notice=deleted");
}

// A workday (the day clock): same rules as a time entry.
export async function editWorkday(id: string, _prev: EditTimeState, formData: FormData): Promise<EditTimeState> {
  await requireOwner();
  const values = {
    started: String(formData.get("started") ?? ""),
    ended: String(formData.get("ended") ?? ""),
    note: String(formData.get("note") ?? ""),
  };
  if (!uuid.safeParse(id).success) return { values, error: "This workday no longer exists." };
  const started = localInputToTimestamp(values.started);
  if (!started) return { values, error: "Enter a start time." };
  const ended = values.ended === "" ? null : localInputToTimestamp(values.ended);
  if (values.ended !== "" && !ended) return { values, error: "Enter a valid end time, or leave it empty if they're still on the clock." };
  if (values.note.trim() === "") return { values, error: "Add a note saying why you changed this." };
  if (values.note.length > 500) return { values, error: "The note must be 500 characters or fewer." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_work_shift", { shift_id: id, started_local: started, ended_local: ended as never, note: values.note });
  if (error) {
    if (error.code === "22023" || error.code === "P0002") return { values, error: `${error.message}.` };
    console.error("Editing workday failed", error);
    return { values, error: "We couldn't save that. Please try again." };
  }
  redirect("/time?notice=workday-saved");
}

export async function deleteWorkday(id: string): Promise<{ error?: string }> {
  await requireOwner();
  if (!uuid.safeParse(id).success) return { error: "This workday no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_work_shift", { shift_id: id });
  if (error && error.code !== "P0002") {
    console.error("Deleting workday failed", error);
    return { error: "We couldn't delete that. Please try again." };
  }
  redirect("/time?notice=workday-deleted");
}
