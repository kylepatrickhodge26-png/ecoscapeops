import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { supabaseUrl } from "@/lib/supabase/env";

// A one-way hash of the visitor's address, used only to limit repeat submissions. The address
// itself is never stored. The hash is mixed with this project's own URL so it can't be looked
// up in a table of hashed addresses.
export async function visitorHash(): Promise<string> {
  const h = await headers();
  const ip = (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim() || "unknown";
  return createHash("sha256").update(`${supabaseUrl()}|${ip}`).digest("hex").slice(0, 40);
}
