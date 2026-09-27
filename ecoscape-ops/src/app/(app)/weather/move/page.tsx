import type { Metadata } from "next";
import Link from "next/link";

import { requireOwner } from "@/lib/auth";
import { addDays, formatShortDate, isISODate, todayInTimeZone } from "@/lib/dates";
import { getBusinessForecast } from "@/lib/weather/queries";

import { MoveDayForm } from "../move-form";

export const metadata: Metadata = { title: "Move a day's jobs · EcoScape Ops" };

export default async function MoveDayPage(props: PageProps<"/weather/move">) {
  const { business } = await requireOwner();
  const { from } = await props.searchParams;
  const today = todayInTimeZone(business.time_zone);
  const fromDate = isISODate(from) && from >= today ? from : today;
  const toDate = addDays(fromDate, 1);
  const forecast = await getBusinessForecast();
  const chance = (date: string) =>
    forecast.status === "ok" ? forecast.days.find((d) => d.date === date)?.rainChance : undefined;
  const fromChance = chance(fromDate);
  const toChance = chance(toDate);

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href="/weather">
            ← Weather
          </Link>
          <h1>Move a day&apos;s jobs</h1>
        </div>
      </div>
      {fromChance !== undefined && (
        <div className="notice" role="status" data-testid="move-forecast">
          Forecast: {fromChance}% chance of rain {formatShortDate(fromDate)}
          {toChance !== undefined && `, ${toChance}% ${formatShortDate(toDate)}`}.
        </div>
      )}
      <MoveDayForm initialValues={{ from_date: fromDate, to_date: toDate }} today={today} />
    </>
  );
}
