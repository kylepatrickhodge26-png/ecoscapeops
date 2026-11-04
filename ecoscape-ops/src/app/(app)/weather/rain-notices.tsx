import Link from "next/link";

import { RainIcon } from "@/components/rain-icon";
import { formatShortDate } from "@/lib/dates";
import { CLOSED_STATUSES } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";
import { dayLabel } from "@/lib/weather/forecast";
import { isRainy, rainHoursLabel, rainOn, spanLabel, wetWord, type DayRain, type WorkHours } from "@/lib/weather/hourly";
import { getWorkdayRain } from "@/lib/weather/queries";

// "Rain likely 10am–2pm tomorrow: 6 repeat visits moved to Wed, Nov 11 automatically." One for
// each day the app moved on its own that's still ahead (and wasn't undone), with the way to
// text the customers or undo it.
export async function AutoRainNotices({ businessId, today }: { businessId: string; today: string }) {
  const supabase = await createClient();
  const { data: delays, error } = await supabase
    .from("rain_delays")
    .select("id, from_date, to_date, rain_window, rain_delay_visits(count)")
    .eq("business_id", businessId)
    .eq("automatic", true)
    .is("undone_at", null)
    .gte("from_date", today)
    .order("from_date")
    .limit(3);
  if (error) {
    console.error("Could not load automatic rain moves", error.message);
    return null;
  }
  if (delays.length === 0) return null;

  // What's still on each rainy day (one-time jobs, and anything under way): the owner's call.
  const { data: left } = await supabase
    .from("jobs")
    .select("scheduled_date")
    .eq("business_id", businessId)
    .in(
      "scheduled_date",
      delays.map((d) => d.from_date),
    )
    .not("status", "in", `(${CLOSED_STATUSES.join(",")})`);

  return delays.map((d) => (
    <AutoRainNotice
      key={d.id}
      delay={{ id: d.id, fromDate: d.from_date, toDate: d.to_date, rainWindow: d.rain_window }}
      moved={d.rain_delay_visits[0]?.count ?? 0}
      staying={(left ?? []).filter((j) => j.scheduled_date === d.from_date).length}
      today={today}
    />
  ));
}

export function AutoRainNotice({
  delay,
  moved,
  staying,
  today,
}: {
  delay: { id: string; fromDate: string; toDate: string; rainWindow: string };
  moved: number;
  staying: number;
  today: string;
}) {
  return (
    <div className="notice rain" role="status" data-testid="auto-rain-notice">
      <RainIcon />{" "}
      <b>
        Rain likely {delay.rainWindow ? `${delay.rainWindow} ` : ""}
        {dayLabel(delay.fromDate, today)}
      </b>
      : {moved} repeat {moved === 1 ? "visit" : "visits"} moved to {formatShortDate(delay.toDate)} automatically.
      {staying > 0 && (
        <>
          {" "}
          <Link href={`/schedule/day/${delay.fromDate}`}>
            {staying} other {staying === 1 ? "visit is" : "visits are"} still on {formatShortDate(delay.fromDate)}
          </Link>
          .
        </>
      )}{" "}
      <Link href={`/weather/delays/${delay.id}`}>Text customers or undo →</Link>
    </div>
  );
}

// On a day's page: "Rain likely 10am–2pm (80% chance) during work hours (8am–4pm)."
export async function DayRainNotice({ business, date }: { business: { id: string; time_zone: string }; date: string }) {
  const rain = await getWorkdayRain(business);
  if (rain.status !== "ok") return null;
  const day = rainOn(rain.days, date);
  return isRainy(day) ? <DayRainNoticeView day={day} work={rain.work} /> : null;
}

export function DayRainNoticeView({ day, work }: { day: DayRain; work: WorkHours }) {
  return (
    <div className="notice rain" role="status" data-testid="day-rain">
      <RainIcon />{" "}
      <b>
        {wetWord(day)} likely {rainHoursLabel(day, work)}
      </b>{" "}
      ({day.chance}% chance) during work hours ({spanLabel(work.start, work.end)}).{" "}
      <Link href={`/weather/move?from=${day.date}`}>Move this day&apos;s jobs →</Link>
    </div>
  );
}
