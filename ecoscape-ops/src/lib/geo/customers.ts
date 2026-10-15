import "server-only";

import { createClient } from "@/lib/supabase/server";

import { lookUpAddress, type Shop } from "./lookup";

export async function getShop(businessId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shop_locations")
    .select("address, matched_address, city, state, postal_code, lat, lon")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the shop address: ${error.message}`);
  return data;
}

// Looks up customers whose location is still pending (new or changed addresses), a few
// at a time, until done or out of time, and saves what was found. Owner only. Stops early
// if the geocoder is down; those customers stay pending and are tried again later.
// Returns how many are still pending.
export async function locatePendingCustomers(
  businessId: string,
  { customerIds, budgetMs = 8_000 }: { customerIds?: string[]; budgetMs?: number } = {},
): Promise<{ remaining: number }> {
  const supabase = await createClient();
  const shopRow = await getShop(businessId);
  let query = supabase
    .from("customers")
    .select("id, property_address", { count: "exact" })
    .eq("business_id", businessId)
    .eq("geo_status", "pending")
    .order("created_at")
    .limit(100);
  if (customerIds) {
    if (customerIds.length === 0) return { remaining: 0 };
    query = query.in("id", customerIds);
  }
  const { data: pending, count, error } = await query;
  if (error) throw new Error(`Could not load customers to locate: ${error.message}`);
  if (!shopRow || pending.length === 0) return { remaining: count ?? 0 };

  const shop: Shop = { city: shopRow.city, state: shopRow.state, lat: shopRow.lat, lon: shopRow.lon };
  const deadline = Date.now() + budgetMs;
  const queue = [...pending];
  let done = 0;
  let unavailable = false;

  async function worker() {
    while (queue.length > 0 && !unavailable && Date.now() < deadline) {
      const customer = queue.shift()!;
      const result = await lookUpAddress(customer.property_address, shop);
      if (result.status === "unavailable") {
        unavailable = true;
        return;
      }
      const { error: saveError } = await supabase.rpc("record_customer_geocode", {
        customer_id: customer.id,
        address: customer.property_address,
        status: result.status,
        lat: (result.status === "located" ? result.lat : null) as number,
        lon: (result.status === "located" ? result.lon : null) as number,
        matched_address: result.status === "not_found" ? "" : result.matchedAddress,
        distance_miles: (result.status === "not_found" ? null : result.miles) as number,
      });
      if (saveError) console.error("Saving a customer location failed", saveError);
      else done += 1;
    }
  }

  // A few lookups at once: quick, without hammering a free public service.
  await Promise.all([worker(), worker(), worker()]);
  return { remaining: Math.max(0, (count ?? pending.length) - done) };
}
