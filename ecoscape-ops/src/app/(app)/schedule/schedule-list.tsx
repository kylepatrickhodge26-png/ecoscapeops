import Link from "next/link";

import { SCHEDULE_FILTERS, SCHEDULE_FILTER_LABELS, type ScheduleFilter } from "@/lib/schedule/constants";

import { JobTable } from "./job-table";
import { LIST_LIMIT, countNeedingAttention, listJobs } from "./queries";

const EMPTY: Record<ScheduleFilter, [string, string]> = {
  upcoming: ["Nothing upcoming", "Book a recurring service to fill the schedule."],
  today: ["Nothing scheduled today", "No visits are booked for today."],
  completed: ["No completed visits yet", "Visits you mark completed show up here."],
  attention: ["All clear", "Nothing is overdue, weather-delayed, or waiting on a decision."],
  all: ["No visits yet", "Book a recurring service to fill the schedule."],
};

export async function ScheduleList({ businessId, filter, today }: { businessId: string; filter: ScheduleFilter; today: string }) {
  const [jobs, attention] = await Promise.all([
    listJobs(businessId, filter, today),
    countNeedingAttention(businessId, today),
  ]);

  return (
    <>
      <nav className="tabbar" aria-label="Filter visits">
        {SCHEDULE_FILTERS.map((f) => (
          <Link
            key={f}
            href={`/schedule?view=list&filter=${f}`}
            className={f === filter ? "active" : undefined}
            aria-current={f === filter ? "page" : undefined}
          >
            {SCHEDULE_FILTER_LABELS[f]}
            {f === "attention" && attention > 0 && (
              <span className="count-badge" aria-label={`${attention} need attention`}>
                {attention}
              </span>
            )}
          </Link>
        ))}
      </nav>
      <div className="panel">
        <div className="panel-body flush">
          <JobTable jobs={jobs} today={today} emptyTitle={EMPTY[filter][0]} emptyText={EMPTY[filter][1]} />
        </div>
      </div>
      {jobs.length === LIST_LIMIT && <p className="hint">Showing the first {LIST_LIMIT} visits.</p>}
    </>
  );
}
