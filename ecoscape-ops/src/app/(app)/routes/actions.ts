"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireMembership } from "@/lib/auth";
import { isISODate } from "@/lib/dates";
import { getShop } from "@/lib/geo/customers";
import { LOOKUP_UNAVAILABLE } from "@/lib/geo/format";
import { lookUpAddress, type Shop } from "@/lib/geo/lookup";
import { moveStop } from "@/lib/geo/route";
import { createClient } from "@/lib/supabase/server";

// Route changes, for owners (any route in their business) and crew members (their own
// route only). The database enforces who may change which route; these validate input.

const uuid = z.uuid();
// Where to go back to after a change: a day's routes, or My jobs.
const RETURN_TO = /^\/(my-jobs|schedule\/day\/\d{4}-\d{2}-\d{2})$/;

type Route = { date: string; crewMemberId: string | null; returnTo: string };

function routeFrom(formData: FormData): Route | null {
  const date = String(formData.get("date") ?? "");
  const crew = String(formData.get("crew_member_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "");
  if (!isISODate(date) || (crew !== "" && !uuid.safeParse(crew).success) || !RETURN_TO.test(returnTo)) return null;
  return { date, crewMemberId: crew || null, returnTo };
}

// The database takes null for the unassigned route.
const crewArg = (route: Route) => route.crewMemberId as string;

function failed(route: Route | null, what: string, error: unknown): never {
  console.error(`${what} failed`, error);
  redirect(`${route?.returnTo ?? "/"}?notice=route-error`);
}

// Moves one stop up or down a place, saving the whole order as it now stands.
export async function moveRouteStop(formData: FormData): Promise<void> {
  await requireMembership();
  const route = routeFrom(formData);
  const order = String(formData.get("order") ?? "").split(",");
  const jobId = String(formData.get("job_id") ?? "");
  const direction = formData.get("direction") === "up" ? "up" : "down";
  if (!route || !order.every((id) => uuid.safeParse(id).success) || !order.includes(jobId)) failed(route, "Moving a stop", "bad input");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_route_order", {
    route_date: route.date,
    crew_member_id: crewArg(route),
    job_ids: moveStop(order, jobId, direction),
  });
  if (error) failed(route, "Moving a stop", error);
  refresh();
}

// Back to the suggested order.
export async function resetRouteOrder(formData: FormData): Promise<void> {
  await requireMembership();
  const route = routeFrom(formData);
  if (!route) failed(route, "Resetting a route", "bad input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reset_route_order", { route_date: route.date, crew_member_id: crewArg(route) });
  if (error) failed(route, "Resetting a route", error);
  refresh();
}

// Back to starting from the shop.
export async function clearRouteStart(formData: FormData): Promise<void> {
  await requireMembership();
  const route = routeFrom(formData);
  if (!route) failed(route, "Clearing a route start", "bad input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_route_start", {
    route_date: route.date,
    crew_member_id: crewArg(route),
    address: "",
    matched_address: "",
    lat: 0,
    lon: 0,
  });
  if (error) failed(route, "Clearing a route start", error);
  refresh();
}

export type RouteStartState = { values: { address: string }; error?: string; saved?: boolean };

// A different starting address for this route on this day only. Looked up like a customer
// address (anchored to the shop's town, US only, within range of the shop).
export async function setRouteStart(_prev: RouteStartState, formData: FormData): Promise<RouteStartState> {
  const { business, role } = await requireMembership();
  const values = { address: String(formData.get("address") ?? "").trim() };
  const route = routeFrom(formData);
  if (!route) return { values, error: "Please reload the page and try again." };
  if (!values.address) return { values, error: "Enter where this route starts today." };
  if (values.address.length > 300) return { values, error: "Keep the address to 300 characters or fewer." };

  const supabase = await createClient();
  let shop: Shop | null = null;
  if (role === "owner") {
    const row = await getShop(business.id);
    if (row) shop = { city: row.city, state: row.state, lat: row.lat, lon: row.lon };
  } else {
    const { data } = await supabase.rpc("crew_route_settings", { route_date: route.date }).maybeSingle();
    if (data?.shop_lat != null && data.shop_lon != null) shop = { city: data.shop_city!, state: data.shop_state!, lat: data.shop_lat, lon: data.shop_lon };
  }
  if (!shop) {
    return {
      values,
      error: role === "owner" ? "Set your shop address in Settings first." : "The owner hasn't set the shop address yet, so routes can't be ordered.",
    };
  }

  const result = await lookUpAddress(values.address, shop);
  switch (result.status) {
    case "unavailable":
      return { values, error: LOOKUP_UNAVAILABLE };
    case "not_found":
      return { values, error: "We couldn't find that address. Check the street and town." };
    case "flagged":
      return {
        values,
        error:
          result.reason === "outside_us"
            ? `That matched “${result.matchedAddress}”, which isn't in the US. Check the address.`
            : `That matched “${result.matchedAddress}”, ${Math.round(result.miles ?? 0).toLocaleString("en-US")} miles from the shop, so it wasn't used. Check the address.`,
      };
  }

  const { error } = await supabase.rpc("set_route_start", {
    route_date: route.date,
    crew_member_id: crewArg(route),
    address: values.address,
    matched_address: result.matchedAddress,
    lat: result.lat,
    lon: result.lon,
  });
  if (error) {
    if (error.code === "42501") return { values, error: "You can only change your own route." };
    console.error("Setting a route start failed", error);
    return { values, error: "We couldn't save that. Please try again." };
  }
  refresh();
  return { values, saved: true };
}
