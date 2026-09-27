"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { isISODate } from "@/lib/dates";
import { siteOrigin } from "@/lib/site-origin";
import { createClient } from "@/lib/supabase/server";
import { sendSms, twilioConfig } from "@/lib/twilio/client";
import { geocodeZip } from "@/lib/weather/openweather";

// All owner-only. The database enforces that regardless, and decides who gets texted.

const uuid = z.uuid();

export type AreaFormState = { values: { postal_code: string }; error?: string; fieldError?: string };

export async function setServiceArea(_prev: AreaFormState, formData: FormData): Promise<AreaFormState> {
  const { business } = await requireOwner();
  const values = { postal_code: String(formData.get("postal_code") ?? "").trim() };
  if (!/^\d{5}$/.test(values.postal_code)) return { values, fieldError: "Enter a 5-digit ZIP code" };

  const result = await geocodeZip(values.postal_code);
  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return { values, fieldError: "We couldn't find that ZIP code" };
      case "not_configured":
        return { values, error: "The weather forecast isn't connected yet (the server has no OpenWeather API key)." };
      case "unavailable":
        return { values, error: "We couldn't reach the weather service. Please try again." };
    }
  }

  const { place } = result;
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

// Runs fn over items, a few at a time.
async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

// Texts the customers a rain delay affects. The database picks the recipients (opted-in
// customers of this business with a visit in the rain delay and a usable number) and
// claims each text before it's sent, so nobody is texted twice.
export async function sendRainDelayTexts(rainDelayId: string): Promise<{ error?: string }> {
  await requireOwner();
  if (!uuid.safeParse(rainDelayId).success) return { error: "This rain delay no longer exists." };
  const twilio = twilioConfig();
  if (!twilio) return { error: "Texting isn't connected yet (the server has no Twilio credentials)." };

  const supabase = await createClient();
  const { data: claimed, error } = await supabase.rpc("start_rain_delay_texts", { rain_delay_id: rainDelayId });
  if (error) {
    if (error.code === "55000") return { error: "Texting isn't set up for your business yet: it needs a texting number." };
    if (error.code === "P0002") return { error: "This rain delay no longer exists." };
    console.error("Starting rain delay texts failed", error);
    return { error: "We couldn't send the texts. Please try again." };
  }

  const statusCallback = `${await siteOrigin()}/api/twilio/status`;
  let sent = 0;
  let failed = 0;
  await inBatches(claimed, 4, async (text) => {
    const result = await sendSms(twilio, { to: text.to_phone, from: text.from_phone, body: text.body, statusCallback });
    if (result.ok) sent++;
    else failed++;
    const { error: recordError } = await supabase.rpc(
      "record_sms_result",
      result.ok
        ? { message_id: text.message_id, twilio_sid: result.sid, twilio_status: result.status }
        : {
            message_id: text.message_id,
            ...(result.code != null ? { error_code: result.code } : {}),
            error_message: result.message,
          },
    );
    if (recordError) console.error("Recording a text's result failed", recordError);
  });

  redirect(`/weather/delays/${rainDelayId}?notice=sent&sent=${sent}&failed=${failed}`);
}
