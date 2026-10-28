"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { isISODate } from "@/lib/dates";
import { safeNextPath } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();

export type MoveState = { error?: string };

// Moves one or more visits to another day. `back` is where to go afterwards: the visit's
// own page, or "day" for the new day (after moving several from a day's list).
export async function moveVisits(back: string, _prev: MoveState, formData: FormData): Promise<MoveState> {
  await requireOwner();
  const ids = [...new Set(formData.getAll("job_ids").map(String))].filter((v) => uuid.safeParse(v).success);
  const newDate = String(formData.get("new_date") ?? "");
  const moveLater = formData.get("move_later") === "on";
  if (ids.length === 0) return { error: "Tick the visits you want to move first." };
  if (!isISODate(newDate)) return { error: "Pick the day to move to." };

  const supabase = await createClient();
  const { data: moved, error } = await supabase.rpc("move_visits", { job_ids: ids, new_date: newDate, move_later: moveLater });
  if (error) {
    if (error.code === "22023" || error.code === "P0002") return { error: `${error.message}.` };
    console.error("Moving visits failed", error);
    return { error: "We couldn't move that. Please try again." };
  }

  const params = new URLSearchParams({ notice: "moved", to: newDate, n: String(moved ?? ids.length), ids: ids.slice(0, 30).join(",") });
  if (moveLater) params.set("later", "1");
  const dest = back === "day" ? `/schedule/day/${newDate}` : (safeNextPath(back) ?? `/schedule/day/${newDate}`);
  redirect(`${dest}?${params}`);
}
