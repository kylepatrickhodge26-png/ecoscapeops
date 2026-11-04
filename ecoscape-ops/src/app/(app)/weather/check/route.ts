import { NextResponse, type NextRequest } from "next/server";

import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isRainy, nextDryDay, rainCheckDay, rainHoursLabel, rainOn } from "@/lib/weather/hourly";
import { getWorkSettings, getWorkdayRain } from "@/lib/weather/queries";

// The automatic rain check. The app runs it in the owner's browser whenever they open it, so no
// scheduler is needed: after work the day before, and in the morning before work, if rain is
// likely during work hours, that day's repeat visits move to the next dry day. The database
// (auto_rain_move) decides what moves, and moves a day only once.
//
// A Route Handler rather than a Server Action so that a slow weather service never holds up the
// owner's own taps (the app sends Server Actions one at a time).
const nothing = (status = 200) => NextResponse.json({ moved: false }, { status });

export async function POST(request: NextRequest) {
  // Only from the app's own pages.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return nothing(403);

  const user = await getUser();
  if (!user) return nothing(401);
  const supabase = await createClient();
  const { data: member } = await supabase
    .from("business_members")
    .select("role, business:businesses(id, time_zone)")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member?.business || member.role !== "owner") return nothing();
  const business = member.business;

  const settings = await getWorkSettings(business.id);
  if (!settings.autoMove) return nothing();
  const day = rainCheckDay(Date.now(), business.time_zone, settings.work);
  if (!day) return nothing();

  const rain = await getWorkdayRain(business);
  if (rain.status !== "ok") return nothing();
  const wet = rainOn(rain.days, day);
  if (!isRainy(wet)) return nothing();

  const { data: delayId, error } = await supabase.rpc("auto_rain_move", {
    rain_day: day,
    move_to: nextDryDay(day, rain.days),
    rain_hours: rainHoursLabel(wet, rain.work),
  });
  if (error) {
    console.error("Moving visits for rain automatically failed", error);
    return nothing(500);
  }
  return NextResponse.json({ moved: delayId !== null });
}
