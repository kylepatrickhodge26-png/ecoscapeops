import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type CrewMember = {
  id: string;
  name: string;
  user_id: string | null;
  email: string | null;
  invite_expires_at: string | null;
};

// The business's crew, owner first. Owner-only (crew members can only read their own
// record under RLS). Cached per request.
export const getCrew = cache(async (businessId: string, ownerUserId: string): Promise<CrewMember[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crew_members")
    .select("id, name, user_id, email, invite_expires_at")
    .eq("business_id", businessId);
  if (error) throw new Error(`Could not load crew: ${error.message}`);
  return data.sort(
    (a, b) =>
      Number(b.user_id === ownerUserId) - Number(a.user_id === ownerUserId) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
});

// "Assign to" only appears once there's someone besides a solo operator to assign to.
export const showAssignment = (crew: CrewMember[]) => crew.length > 1;

export type AssigneeOption = { id: string; label: string };

export function assigneeOptions(crew: CrewMember[], ownerUserId: string): AssigneeOption[] {
  return crew.map((c) => ({ id: c.id, label: c.user_id === ownerUserId ? `${c.name} (you)` : c.name }));
}
