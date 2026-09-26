import "server-only";

import { notFound } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

// Loads one customer for the signed-in owner. A customer that belongs to another
// business is invisible under RLS, so it 404s exactly like one that doesn't exist.
export async function getCustomerOr404(id: string) {
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load customer: ${error.message}`);
  if (!data) notFound();
  return data;
}
