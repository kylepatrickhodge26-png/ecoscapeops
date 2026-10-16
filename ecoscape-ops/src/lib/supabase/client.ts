import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { supabasePublishableKey, supabaseUrl } from "./env";

// A Supabase client for the browser, signed in as the current user (from the same cookies the
// server uses). Used only to upload photos straight to storage; storage's own access rules
// decide what each person may add.
export function createClient() {
  return createBrowserClient<Database>(supabaseUrl(), supabasePublishableKey());
}
