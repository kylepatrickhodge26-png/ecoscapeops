import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, inject } from "vitest";

import type { Database, TablesInsert } from "@/lib/supabase/database.types";

export type Client = SupabaseClient<Database>;

const options = { auth: { persistSession: false, autoRefreshToken: false } };

export function anonClient(): Client {
  const { url, publishableKey } = inject("supabase");
  return createClient<Database>(url, publishableKey, options);
}

// Bypasses RLS. Only used to set up situations the app itself can't create yet
// (e.g. a crew membership) — never to check what a user can see.
export function adminClient(): Client {
  const { url, secretKey } = inject("supabase");
  return createClient<Database>(url, secretKey, options);
}

export const uniqueEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@example.test`;
export const PASSWORD = "correct-horse-battery";

export type TestUser = { client: Client; userId: string; email: string };
export type TestOwner = TestUser & { businessId: string };

// Signs up a user through Supabase Auth, the same way the signup form does.
export async function signUp(
  label: string,
  businessName?: string,
  metadata: Record<string, string> = {},
): Promise<TestUser> {
  const client = anonClient();
  const email = uniqueEmail(label);
  const { data, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { data: { ...(businessName ? { business_name: businessName } : {}), ...metadata } },
  });
  expect(error).toBeNull();
  expect(data.session).not.toBeNull();
  return { client, userId: data.user!.id, email };
}

export async function signUpOwner(
  label: string,
  businessName: string,
  metadata: Record<string, string> = {},
): Promise<TestOwner> {
  const user = await signUp(label, businessName, metadata);
  const { data, error } = await user.client
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", user.userId)
    .single();
  expect(error).toBeNull();
  expect(data!.role).toBe("owner");
  return { ...user, businessId: data!.business_id };
}

export async function addCustomer(
  owner: TestOwner,
  fields: Partial<TablesInsert<"customers">> = {},
) {
  const { data, error } = await owner.client
    .from("customers")
    .insert({ business_id: owner.businessId, first_name: "Test", last_name: "Customer", ...fields })
    .select()
    .single();
  expect(error).toBeNull();
  return data!;
}

// Books a service the way the booking form does: insert the plan, and the database
// generates its visits.
export async function bookService(
  owner: TestOwner,
  customerId: string,
  fields: Partial<TablesInsert<"service_plans">> = {},
) {
  const { data, error } = await owner.client
    .from("service_plans")
    .insert({
      business_id: owner.businessId,
      customer_id: customerId,
      service_name: "Mowing",
      price: 65,
      frequency: "weekly",
      start_date: "2030-03-05",
      ...fields,
    })
    .select()
    .single();
  expect(error).toBeNull();
  return data!;
}

export async function visitsFor(owner: TestOwner, planId: string) {
  const { data, error } = await owner.client
    .from("jobs")
    .select("*")
    .eq("service_plan_id", planId)
    .order("scheduled_date");
  expect(error).toBeNull();
  return data!;
}

// Today's date in a time zone, as YYYY-MM-DD.
export const todayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

export function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}


// Owner adds a crew member; returns their id and the one-time invite token.
export async function addCrewMember(owner: TestOwner, name: string) {
  const { data, error } = await owner.client.rpc("add_crew_member", { member_name: name }).single();
  expect(error).toBeNull();
  return { crewMemberId: data!.crew_member_id, token: data!.invite_token };
}

export type TestCrew = TestUser & { crewMemberId: string };

// A crew member signs up through their invite link, the way the join page does.
export async function joinCrew(owner: TestOwner, name: string): Promise<TestCrew> {
  const { crewMemberId, token } = await addCrewMember(owner, name);
  const user = await signUp(name.toLowerCase(), undefined, { crew_invite_token: token });
  return { ...user, crewMemberId };
}
