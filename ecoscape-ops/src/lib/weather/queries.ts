import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

import type { ForecastDay } from "./forecast";
import { DEFAULT_WORK_HOURS, minutesOf, workdayRain, type DayRain, type WorkHours } from "./hourly";
import { getDailyForecast, getHourlyForecast } from "./nws";

export type ServiceArea = { postal_code: string; place_name: string; latitude: number; longitude: number };

// The caller's business's service area. Works for crew members too (through a database
// function), so their dashboard can show the forecast.
export const getServiceArea = cache(async (): Promise<ServiceArea | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("business_service_area");
  if (error) throw new Error(`Could not load your service area: ${error.message}`);
  return data[0] ?? null;
});

export type BusinessForecast =
  | { status: "no_area" }
  | { status: "unavailable"; area: ServiceArea }
  | { status: "ok"; area: ServiceArea; days: ForecastDay[] };

export async function getBusinessForecast(): Promise<BusinessForecast> {
  const area = await getServiceArea();
  if (!area) return { status: "no_area" };
  const forecast = await getDailyForecast(area.latitude, area.longitude);
  return forecast.ok ? { status: "ok", area, days: forecast.days } : { status: "unavailable", area };
}

export type WorkSettings = { work: WorkHours; autoMove: boolean };

// The business's work hours, and whether rain moves its repeat visits automatically. Everyone
// in the business can read them. If they can't be read, the defaults (and no moving).
export const getWorkSettings = cache(async (businessId: string): Promise<WorkSettings> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("businesses")
    .select("work_start, work_end, rain_auto_move")
    .eq("id", businessId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("Could not load work hours", error.message);
    return { work: DEFAULT_WORK_HOURS, autoMove: false };
  }
  const start = minutesOf(data.work_start);
  const end = minutesOf(data.work_end);
  return {
    work: start !== null && end !== null && start < end ? { start, end } : DEFAULT_WORK_HOURS,
    autoMove: data.rain_auto_move,
  };
});

export type WorkdayRain =
  | { status: "no_area" }
  | { status: "unavailable"; work: WorkHours }
  | { status: "ok"; work: WorkHours; days: DayRain[] };

// When rain is likely during work hours over the next 6½ days, day by day.
export async function getWorkdayRain(business: { id: string; time_zone: string }): Promise<WorkdayRain> {
  const [area, { work }] = await Promise.all([getServiceArea(), getWorkSettings(business.id)]);
  if (!area) return { status: "no_area" };
  const forecast = await getHourlyForecast(area.latitude, area.longitude);
  return forecast.ok
    ? { status: "ok", work, days: workdayRain(forecast.hours, work, business.time_zone) }
    : { status: "unavailable", work };
}
