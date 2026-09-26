import "server-only";

import { notFound } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

// One visit with its customer and service plan. A visit from another business is
// invisible under RLS, so it 404s exactly like one that doesn't exist.
export async function getJobOr404(id: string) {
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "*, customer:customers(id, first_name, last_name, phone, email, property_address, access_instructions, service_notes), plan:service_plans(id, frequency, active), assignee:crew_members(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load visit: ${error.message}`);
  if (!data) notFound();
  return data;
}
