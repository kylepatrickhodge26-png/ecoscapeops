import Link from "next/link";

import { StatusPill } from "@/components/job-status";
import { customerDisplayName } from "@/lib/customers/schema";
import { addDays, formatLongDate } from "@/lib/dates";
import { formatPrice, isClosed } from "@/lib/schedule/constants";

import { countNeedingAttention, jobsBetween } from "./queries";

// How many days ahead the list reaches.
const DAYS = 14;

// The default Schedule: the next two weeks, one day at a time, the way you'd read a paper
// planner. Tap a visit to open it; "Move" goes straight to the day picker.
export async function ScheduleDays({ businessId, today, showCrew }: { businessId: string; today: string; showCrew: boolean }) {
  const [jobs, attention] = await Promise.all([
    jobsBetween(businessId, today, addDays(today, DAYS - 1)),
    countNeedingAttention(businessId, today),
  ]);
  const live = jobs.filter((j) => j.status !== "cancelled");
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i))
    .map((date) => ({ date, jobs: live.filter((j) => j.scheduled_date === date) }))
    .filter((d) => d.jobs.length > 0 || d.date === today);

  const dayName = (date: string) => (date === today ? "Today" : date === addDays(today, 1) ? "Tomorrow" : formatLongDate(date));

  return (
    <div className="sched-days">
      {attention > 0 && (
        <Link className="sched-attention" href="/schedule?view=list&filter=attention">
          <b>
            {attention} {attention === 1 ? "visit needs" : "visits need"} a look
          </b>
          <span>Overdue, rained out or couldn&apos;t be done ›</span>
        </Link>
      )}
      {days.map((d) => (
        <section key={d.date} aria-label={dayName(d.date)} className="sched-day" data-day={d.date}>
          <h2>
            {dayName(d.date)}
            {(d.date === today || d.date === addDays(today, 1)) && <span className="sched-date"> · {formatLongDate(d.date)}</span>}
            <span className="sched-count">{d.jobs.length === 1 ? "1 visit" : `${d.jobs.length} visits`}</span>
          </h2>
          {d.jobs.length === 0 ? (
            <p className="hint">Nothing booked today.</p>
          ) : (
            <ul>
              {d.jobs.map((job) => (
                <li key={job.id} className="sched-job" data-job-id={job.id}>
                  <Link className="sched-job-main" href={`/schedule/jobs/${job.id}`}>
                    <b>{customerDisplayName(job.customer)}</b>
                    <span className="subtext">
                      {job.service_name} · {formatPrice(job.price)}
                      {job.customer.property_address && ` · ${job.customer.property_address}`}
                      {showCrew && ` · ${job.assignee?.name ?? "Unassigned"}`}
                    </span>
                  </Link>
                  <div className="sched-job-side">
                    {job.status !== "scheduled" && job.status !== "assigned" && <StatusPill status={job.status} />}
                    {!isClosed(job.status) && (
                      <Link className="sched-move" href={`/schedule/jobs/${job.id}?move=1#move`}>
                        Move
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {days.length === 1 && days[0].jobs.length === 0 && (
        <div className="panel">
          <div className="empty">
            <div className="big">Nothing booked for the next two weeks</div>
            <Link className="btn" href="/schedule/new">
              + Book a job
            </Link>
          </div>
        </div>
      )}
      <p className="sched-more">
        <Link href={`/schedule?month=${today.slice(0, 7)}`} className="sched-more-cal">
          Month calendar
        </Link>
        <Link href="/schedule?view=list&filter=upcoming">All visits</Link>
      </p>
    </div>
  );
}
