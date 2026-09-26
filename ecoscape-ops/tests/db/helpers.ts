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
export async function signUp(label: string, businessName?: string): Promise<TestUser> {
  const client = anonClient();
  const email = uniqueEmail(label);
  const { data, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: businessName ? { data: { business_name: businessName } } : undefined,
  });
  expect(error).toBeNull();
  expect(data.session).not.toBeNull();
  return { client, userId: data.user!.id, email };
}

export async function signUpOwner(label: string, businessName: string): Promise<TestOwner> {
  const user = await signUp(label, businessName);
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
