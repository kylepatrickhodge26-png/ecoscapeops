import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { supabaseUrl } from "./env";

// A service-role client, which bypasses row-level security. Only for Stripe: its webhook
// (which arrives without a signed-in user and checks Stripe's signature first), a
// customer's Pay button, and saving a business's connected Stripe account. They call
// database functions that only the service role may run. Never use this to read data for
// a page. Null until SUPABASE_SECRET_KEY is set.
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) return null;
  return createClient<Database>(supabaseUrl(), secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
