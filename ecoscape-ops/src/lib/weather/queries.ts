import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { ForecastDay } from "./forecast";
import { getDailyForecast } from "./openweather";

export type ServiceArea = { postal_code: string; place_name: string; latitude: number; longitude: number };

// The caller's business's service area. Works for crew members too (through a database
// function), so their dashboard can show the forecast.
export async function getServiceArea(): Promise<ServiceArea | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("business_service_area");
  if (error) throw new Error(`Could not load your service area: ${error.message}`);
  return data[0] ?? null;
}

export type BusinessForecast =
  | { status: "no_area" }
  | { status: "not_configured" | "unavailable"; area: ServiceArea }
  | { status: "ok"; area: ServiceArea; days: ForecastDay[] };

export async function getBusinessForecast(): Promise<BusinessForecast> {
  const area = await getServiceArea();
  if (!area) return { status: "no_area" };
  const forecast = await getDailyForecast(area.latitude, area.longitude);
  return forecast.ok ? { status: "ok", area, days: forecast.days } : { status: forecast.reason, area };
}

// The number this business's texts come from, if one has been assigned (owners only).
export async function getTextingNumber(businessId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("sms_senders").select("phone_number").eq("business_id", businessId).maybeSingle();
  if (error) throw new Error(`Could not load your texting number: ${error.message}`);
  return data?.phone_number ?? null;
}
