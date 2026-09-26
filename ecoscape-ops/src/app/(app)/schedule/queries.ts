import "server-only";

import type { QueryData } from "@supabase/supabase-js";

import { CLOSED_STATUSES, type ScheduleFilter } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

// Lists are capped; a business would need years of history to hit this in "All".
export const LIST_LIMIT = 500;

const CLOSED = `(${CLOSED_STATUSES.join(",")})`;

type Client = Awaited<ReturnType<typeof createClient>>;

// Not async on purpose: a query builder is "thenable", so returning it from an async
// function would run the query before filters are added.
function jobsWithCustomer(supabase: Client) {
  return supabase
    .from("jobs")
    .select(
      "id, scheduled_date, status, service_name, price, customer:customers(id, first_name, last_name, phone, email, property_address)",
    );
}

export type JobListItem = QueryData<ReturnType<typeof jobsWithCustomer>>[number];

// The database side of matchesFilter() in lib/schedule/constants.ts — keep the two in step.
export async function listJobs(businessId: string, filter: ScheduleFilter, today: string) {
  let query = jobsWithCustomer(await createClient()).eq("business_id", businessId);

  switch (filter) {
    case "upcoming":
      query = query.gte("scheduled_date", today).not("status", "in", CLOSED);
      break;
    case "today":
      query = query.eq("scheduled_date", today);
      break;
    case "completed":
      query = query.eq("status", "completed");
      break;
    case "attention":
      query = query.or(
        `status.in.(unable_to_complete,weather_delay),and(scheduled_date.lt.${today},status.not.in.${CLOSED})`,
      );
      break;
    case "all":
      break;
  }

  // Completed work reads most-recent-first; everything else in date order.
  const { data, error } = await query
    .order("scheduled_date", { ascending: filter !== "completed" })
    .order("created_at")
    .limit(LIST_LIMIT);
  if (error) throw new Error(`Could not load visits: ${error.message}`);
  return data;
}

export async function jobsBetween(businessId: string, from: string, to: string) {
  const { data, error } = await jobsWithCustomer(await createClient())
    .eq("business_id", businessId)
    .gte("scheduled_date", from)
    .lte("scheduled_date", to)
    .order("scheduled_date")
    .order("created_at");
  if (error) throw new Error(`Could not load visits: ${error.message}`);
  return data;
}

export async function countNeedingAttention(businessId: string, today: string) {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .or(`status.in.(unable_to_complete,weather_delay),and(scheduled_date.lt.${today},status.not.in.${CLOSED})`);
  if (error) throw new Error(`Could not count visits: ${error.message}`);
  return count ?? 0;
}
