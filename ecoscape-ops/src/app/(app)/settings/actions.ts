"use server";

import { redirect } from "next/navigation";

import { requireOwner } from "@/lib/auth";
import { shopAddressProblem } from "@/lib/geo/address";
import { locatePendingCustomers } from "@/lib/geo/customers";
import { LOOKUP_UNAVAILABLE, titleCase } from "@/lib/geo/format";
import { lookUpAddress } from "@/lib/geo/lookup";
import { createClient } from "@/lib/supabase/server";
import { getServiceArea } from "@/lib/weather/queries";

export type ShopFormState = { values: { address: string }; error?: string; fieldError?: string };

// Saves the shop address: looked up as typed (it has to name its own town and state), US
// only, and, if the business has set a weather service area, within range of it.
export async function saveShopAddress(_prev: ShopFormState, formData: FormData): Promise<ShopFormState> {
  const { business } = await requireOwner();
  const values = { address: String(formData.get("address") ?? "").trim() };
  const problem = values.address.length > 300 ? "Keep the address to 300 characters or fewer" : shopAddressProblem(values.address);
  if (problem) return { values, fieldError: problem };

  const area = await getServiceArea();
  const result = await lookUpAddress(values.address, null, area ? { lat: area.latitude, lon: area.longitude } : null);
  switch (result.status) {
    case "unavailable":
      return { values, error: LOOKUP_UNAVAILABLE };
    case "not_found":
      return { values, fieldError: "We couldn't find that address. Check the street, town and state." };
    case "flagged":
      return {
        values,
        fieldError:
          result.reason === "outside_us"
            ? `That matched “${result.matchedAddress}”, which isn't in the US. Check the address.`
            : `That matched “${result.matchedAddress}”, ${Math.round(result.miles ?? 0).toLocaleString("en-US")} miles from your service area (${area?.place_name}). Check the address, or change your service area on the Weather page.`,
      };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_shop_location", {
    address: values.address,
    matched_address: result.matchedAddress,
    city: titleCase(result.city),
    state: result.state.toUpperCase(),
    postal_code: /^\d{5}(-\d{4})?$/.test(result.zip) ? result.zip : "",
    lat: result.lat,
    lon: result.lon,
  });
  if (error) {
    console.error("Saving the shop address failed", error);
    return { values, error: "We couldn't save the shop address. Please try again." };
  }

  // Place customers right away (as many as there's time for; the rest on the next pass).
  await locatePendingCustomers(business.id, { budgetMs: 8_000 });
  redirect("/settings?notice=shop");
}

// Looks up the customers still waiting for a location.
export async function locateRemainingCustomers(): Promise<void> {
  const { business } = await requireOwner();
  await locatePendingCustomers(business.id, { budgetMs: 9_000 });
  redirect("/settings?notice=located");
}
