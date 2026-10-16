import "server-only";

import { notFound } from "next/navigation";
import { z } from "zod";

import type { QuoteStatus } from "@/lib/quotes/constants";
import { createClient } from "@/lib/supabase/server";

// Quote reads. RLS limits them to the owner's own business; another business's quote is
// simply not found.

export async function listQuotes(businessId: string, status: QuoteStatus | null) {
  const supabase = await createClient();
  let query = supabase
    .from("quotes")
    .select(
      "id, number, title, prospect_name, expires_on, total, quote_status_shown, customer:customers(first_name, last_name, phone, email)",
    )
    .eq("business_id", businessId)
    .order("number", { ascending: false })
    .limit(500);
  if (status) query = query.eq("quote_status_shown", status);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load quotes: ${error.message}`);
  return data;
}

export async function getQuoteOr404(id: string) {
  if (!z.uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes")
    .select(
      "*, quote_status_shown, customer:customers(id, first_name, last_name, phone, email, property_address, billing_address, sms_opt_in), quote_lines(id, position, description, quantity, unit_price, amount)",
    )
    .eq("id", id)
    .order("position", { referencedTable: "quote_lines" })
    .maybeSingle();
  if (error) throw new Error(`Could not load quote: ${error.message}`);
  if (!data) notFound();
  return data;
}

// Customers to pick from when writing a quote.
export async function quoteCustomers(businessId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, phone, email")
    .eq("business_id", businessId)
    .order("last_name")
    .order("first_name");
  if (error) throw new Error(`Could not load customers: ${error.message}`);
  return data;
}
