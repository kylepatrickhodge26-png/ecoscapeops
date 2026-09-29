"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { isISODate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { lookupZip } from "@/lib/weather/zip";

// All owner-only. The database enforces that regardless, and decides who can be texted.

const uuid = z.uuid();

export type AreaFormState = { values: { postal_code: string }; error?: string; fieldError?: string };

export async function setServiceArea(_prev: AreaFormState, formData: FormData): Promise<AreaFormState> {
  const { business } = await requireOwner();
  const values = { postal_code: String(formData.get("postal_code") ?? "").trim() };
  if (!/^\d{5}$/.test(values.postal_code)) return { values, fieldError: "Enter a 5-digit ZIP code" };

  const place = lookupZip(values.postal_code);
  if (!place) return { values, fieldError: "We couldn't find that ZIP code" };

  const supabase = await createClient();
  const { error } = await supabase.from("service_areas").upsert({
    business_id: business.id,
    postal_code: place.postalCode,
    place_name: place.placeName,
    latitude: place.latitude,
    longitude: place.longitude,
  });
  if (error) {
    console.error("Saving service area failed", error);
    return { values, error: "We couldn't save your service area. Please try again." };
  }

  redirect("/weather?notice=area");
}

export type MoveDayValues = { from_date: string; to_date: string };
export type MoveDayState = {
  values: MoveDayValues;
  error?: string;
  fieldErrors?: Partial<Record<keyof MoveDayValues, string>>;
};

export async function moveDay(_prev: MoveDayState, formData: FormData): Promise<MoveDayState> {
  await requireOwner();
  const values = {
    from_date: String(formData.get("from_date") ?? ""),
    to_date: String(formData.get("to_date") ?? ""),
  };
  const fieldErrors: MoveDayState["fieldErrors"] = {};
  if (!isISODate(values.from_date)) fieldErrors.from_date = "Choose the day to move";
  if (!isISODate(values.to_date)) fieldErrors.to_date = "Choose the new day";
  else if (values.to_date === values.from_date) fieldErrors.to_date = "Choose a different day";
  if (Object.keys(fieldErrors).length > 0) return { values, fieldErrors };

  const supabase = await createClient();
  const { data: rainDelayId, error } = await supabase.rpc("move_day_visits", values);
  if (error) {
    if (error.code === "P0002") return { values, fieldErrors: { from_date: "There are no visits to move on that day" } };
    if (error.code === "22023") return { values, error: `${error.message}.` };
    console.error("Moving a day's visits failed", error);
    return { values, error: "We couldn't move those visits. Please try again." };
  }

  redirect(`/weather/delays/${rainDelayId}?notice=moved`);
}

// Records that the owner opened a customer's weather text (in their own Messages app).
// The database refuses it unless that customer can be texted.
export async function markWeatherTextOpened(rainDelayId: string, customerId: string): Promise<void> {
  await requireOwner();
  if (!uuid.safeParse(rainDelayId).success || !uuid.safeParse(customerId).success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_weather_text_opened", { rain_delay_id: rainDelayId, customer_id: customerId });
  if (error) console.error("Recording an opened weather text failed", error);
  refresh();
}
