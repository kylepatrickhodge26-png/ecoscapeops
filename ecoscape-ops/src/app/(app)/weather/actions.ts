"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { isISODate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { EARLIEST_START, LATEST_END, minutesOf, timeValue } from "@/lib/weather/hourly";
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

export type RainSettingsValues = { start: number; end: number; autoMove: boolean };
export type RainSettingsState = { values: RainSettingsValues; error?: string; fieldError?: string };

// Work hours, and whether rain moves repeat visits automatically.
export async function saveRainSettings(_prev: RainSettingsState, formData: FormData): Promise<RainSettingsState> {
  const { business } = await requireOwner();
  const start = minutesOf(formData.get("work_start"));
  const end = minutesOf(formData.get("work_end"));
  const values = { start: start ?? _prev.values.start, end: end ?? _prev.values.end, autoMove: formData.get("rain_auto_move") === "on" };
  if (start === null || end === null || start < EARLIEST_START || end > LATEST_END || start % 15 !== 0 || end % 15 !== 0) {
    return { values, error: "Choose when work starts and ends." };
  }
  if (end <= start) return { values, fieldError: "Work has to end after it starts" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("businesses")
    .update({ work_start: timeValue(start), work_end: timeValue(end), rain_auto_move: values.autoMove })
    .eq("id", business.id)
    .select("id");
  if (error || data.length !== 1) {
    console.error("Saving work hours failed", error);
    return { values, error: "We couldn't save that. Please try again." };
  }
  redirect("/weather?notice=work-hours#work-hours");
}

// Puts a rain delay's visits back on their old day (the database checks it's the owner's and
// that the day hasn't passed).
export async function undoRainDelay(rainDelayId: string): Promise<{ error?: string }> {
  await requireOwner();
  if (!uuid.safeParse(rainDelayId).success) return { error: "Rain delay not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("undo_rain_delay", { rain_delay_id: rainDelayId });
  if (error) {
    if (error.code === "22023" || error.code === "P0002") return { error: `${error.message}.` };
    console.error("Undoing a rain delay failed", error);
    return { error: "We couldn't undo that. Please try again." };
  }
  redirect(`/weather/delays/${rainDelayId}?notice=undone`);
}

