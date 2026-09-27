import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import type { Enums } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type BusinessRole = Enums<"business_role">;

export type Membership = {
  user: { id: string; email: string };
  role: BusinessRole;
  business: { id: string; name: string; time_zone: string };
};

// The signed-in user, verified with Supabase Auth (not just read from the cookie).
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
});

// The signed-in user's business and role. Sends signed-out users to /login and users
// without a business to /onboarding. Cached for the duration of one request.
export const requireMembership = cache(async (): Promise<Membership> => {
  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_members")
    .select("role, business:businesses(id, name, time_zone)")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(`Could not load your business: ${error.message}`);
  if (!data?.business) redirect("/onboarding");

  return { user, role: data.role, business: data.business };
});

// Owner-only pages (customers, schedule, crew). Crew members are sent to their own
// jobs instead. The database enforces this regardless (RLS gives crew no access to
// these tables); this just routes people to the right place.
export async function requireOwner(): Promise<Membership> {
  const membership = await requireMembership();
  if (membership.role !== "owner") redirect("/my-jobs");
  return membership;
}

// Anyone on the crew list: crew members, and the owner (who is on the crew too).
export const requireCrewMember = cache(async () => {
  const membership = await requireMembership();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crew_members")
    .select("id, name")
    .eq("user_id", membership.user.id)
    .maybeSingle();
  if (error) throw new Error(`Could not load your crew record: ${error.message}`);
  if (!data) redirect("/");
  return { ...membership, crewMember: data };
});

