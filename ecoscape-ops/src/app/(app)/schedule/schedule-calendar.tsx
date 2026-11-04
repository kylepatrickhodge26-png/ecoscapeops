import Link from "next/link";
import { Suspense } from "react";

import { StatusLegend, StatusShape } from "@/components/job-status";
import { RainIcon } from "@/components/rain-icon";
import { customerDisplayName } from "@/lib/customers/schema";
import { addDays, addMonths, formatLongDate, formatMonth, monthGrid, monthOf } from "@/lib/dates";
import { JOB_STATUS_LABELS } from "@/lib/schedule/constants";
import { isRainy, rainHoursLabel, rainOn, shortRainHoursLabel, spanLabel, wetWord, type DayRain, type WorkHours } from "@/lib/weather/hourly";
import { getWorkdayRain } from "@/lib/weather/queries";

import { jobsBetween, type JobListItem } from "./queries";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHOWN_PER_DAY = 4;

type Business = { id: string; time_zone: string };
// The days ahead with rain likely during work hours.
export type CalendarRain = { work: WorkHours; days: DayRain[] };

export async function ScheduleCalendar({ business, month, today }: { business: Business; month: string; today: string }) {
  const weeks = monthGrid(month);
  const first = weeks[0][0];
  const last = weeks.at(-1)!.at(-1)!;
  const jobs = await jobsBetween(business.id, first, last);

  const byDay = new Map<string, JobListItem[]>();
  for (const job of jobs) {
    byDay.set(job.scheduled_date, [...(byDay.get(job.scheduled_date) ?? []), job]);
  }
  const grid = (rain: CalendarRain | null) => (
    <CalendarGrid weeks={weeks} month={month} today={today} byDay={byDay} rain={rain} />
  );
  // The hourly forecast reaches about a week ahead, so it's only needed when this month shows
  // some of that week. The calendar shows straight away; rain marks follow when the forecast
  // arrives, so a slow weather service never holds it up.
  const showsForecast = first <= addDays(today, 7) && last >= today;

  return (
    <>
      <div className="cal-header-row">
        <div className="cal-nav">
          <Link className="btn secondary small" href={`/schedule?month=${addMonths(month, -1)}`} aria-label="Previous month">
            ←
          </Link>
          <h2 className="cal-month">{formatMonth(month)}</h2>
          <Link className="btn secondary small" href={`/schedule?month=${addMonths(month, 1)}`} aria-label="Next month">
            →
          </Link>
          {month !== monthOf(today) && (
            <Link className="btn secondary small" href="/schedule">
              This month
            </Link>
          )}
        </div>
        <StatusLegend />
      </div>

      {showsForecast ? (
        <Suspense fallback={grid(null)}>
          <CalendarWithRain business={business} today={today} grid={grid} />
        </Suspense>
      ) : (
        grid(null)
      )}
    </>
  );
}

async function CalendarWithRain({
  business,
  today,
  grid,
}: {
  business: Business;
  today: string;
  grid: (rain: CalendarRain | null) => React.ReactNode;
}) {
  const rain = await getWorkdayRain(business);
  if (rain.status !== "ok") return grid(null);
  return grid({ work: rain.work, days: rain.days.filter((d) => d.date >= today && isRainy(d)) });
}

export function CalendarGrid({
  weeks,
  month,
  today,
  byDay,
  rain,
}: {
  weeks: string[][];
  month: string;
  today: string;
  byDay: Map<string, JobListItem[]>;
  rain: CalendarRain | null;
}) {
  return (
    <>
      <div className="calendar" data-month={month}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-dow" aria-hidden="true">
            {d}
          </div>
        ))}
        {weeks.flat().map((day) => {
          const dayJobs = byDay.get(day) ?? [];
          const wet = rain ? rainOn(rain.days, day) : undefined;
          const wetText = wet && rain ? `${wetWord(wet)} likely ${rainHoursLabel(wet, rain.work)}` : "";
          const classes = ["cal-cell"];
          if (monthOf(day) !== month) classes.push("other-month");
          if (day === today) classes.push("today");
          return (
            <div key={day} className={classes.join(" ")} data-date={day}>
              <Link
                className="datenum"
                href={`/schedule/day/${day}`}
                aria-label={`${formatLongDate(day)}${day === today ? " (today)" : ""}: ${dayJobs.length} ${dayJobs.length === 1 ? "visit" : "visits"}${wetText ? `. ${wetText}` : ""}`}
              >
                {Number(day.slice(8))}
              </Link>
              {wet && rain && (
                <div className="cal-rain" data-rain={day} title={`${wetText} (${wet.chance}% chance) during work hours`} aria-hidden="true">
                  <RainIcon size={11} />
                  <span className="cal-rain-long">{rainHoursLabel(wet, rain.work)}</span>
                  <span className="cal-rain-short">{shortRainHoursLabel(wet, rain.work)}</span>
                </div>
              )}
              {dayJobs.length > 0 && (
                <ul className="cal-jobs">
                  {dayJobs.slice(0, SHOWN_PER_DAY).map((job) => {
                    const name = customerDisplayName(job.customer);
                    return (
                      <li key={job.id}>
                        <Link
                          className="cal-job"
                          href={`/schedule/jobs/${job.id}`}
                          title={`${name} — ${JOB_STATUS_LABELS[job.status]}`}
                          data-status={job.status}
                        >
                          <StatusShape status={job.status} />
                          <span className="cal-job-name">{name}</span>
                          <span className="visually-hidden">, {JOB_STATUS_LABELS[job.status]}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {dayJobs.length > SHOWN_PER_DAY && (
                <Link className="more-count" href={`/schedule/day/${day}`}>
                  +{dayJobs.length - SHOWN_PER_DAY} more
                </Link>
              )}
            </div>
          );
        })}
      </div>
      {rain && rain.days.length > 0 && (
        <p className="hint cal-rain-key">
          <RainIcon size={11} /> Rain likely during your work hours ({spanLabel(rain.work.start, rain.work.end)}), from the
          National Weather Service. <Link href="/weather#work-hours">Change work hours</Link>
        </p>
      )}
    </>
  );
}
