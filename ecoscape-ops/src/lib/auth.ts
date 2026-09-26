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

// Customers are owner-only for now (see the RLS policies). The database enforces this
// regardless; this check just gives a clear error instead of an empty result.
export async function requireOwner(): Promise<Membership> {
  const membership = await requireMembership();
  if (membership.role !== "owner") {
    throw new Error("Only the business owner can manage customers.");
  }
  return membership;
}
