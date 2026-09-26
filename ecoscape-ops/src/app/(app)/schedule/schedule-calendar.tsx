import Link from "next/link";

import { StatusLegend, StatusShape } from "@/components/job-status";
import { customerDisplayName } from "@/lib/customers/schema";
import { addMonths, formatLongDate, formatMonth, monthGrid, monthOf } from "@/lib/dates";
import { JOB_STATUS_LABELS } from "@/lib/schedule/constants";

import { jobsBetween, type JobListItem } from "./queries";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHOWN_PER_DAY = 4;

export async function ScheduleCalendar({ businessId, month, today }: { businessId: string; month: string; today: string }) {
  const weeks = monthGrid(month);
  const jobs = await jobsBetween(businessId, weeks[0][0], weeks.at(-1)!.at(-1)!);

  const byDay = new Map<string, JobListItem[]>();
  for (const job of jobs) {
    byDay.set(job.scheduled_date, [...(byDay.get(job.scheduled_date) ?? []), job]);
  }

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

      <div className="calendar" data-month={month}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-dow" aria-hidden="true">
            {d}
          </div>
        ))}
        {weeks.flat().map((day) => {
          const dayJobs = byDay.get(day) ?? [];
          const classes = ["cal-cell"];
          if (monthOf(day) !== month) classes.push("other-month");
          if (day === today) classes.push("today");
          return (
            <div key={day} className={classes.join(" ")} data-date={day}>
              <Link
                className="datenum"
                href={`/schedule/day/${day}`}
                aria-label={`${formatLongDate(day)}${day === today ? " (today)" : ""}: ${dayJobs.length} ${dayJobs.length === 1 ? "visit" : "visits"}`}
              >
                {Number(day.slice(8))}
              </Link>
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
    </>
  );
}
