import type { Metadata } from "next";

import { Notice } from "@/components/notice";
import { requireCrewMember } from "@/lib/auth";
import { addDays, formatLongDate, todayInTimeZone } from "@/lib/dates";
import { isClosed } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

import { CrewJobCard } from "./crew-job-card";

export const metadata: Metadata = { title: "My jobs · EcoScape Ops" };

const NOTICES: Record<string, string> = {
  started: "Job started.",
  completed: "Job marked completed.",
  note: "Note added.",
  rescheduled: "Job rescheduled.",
  cancelled: "Job cancelled.",
};

// How far ahead a crew member sees their schedule, and how far back overdue jobs reach.
const DAYS_AHEAD = 14;
const DAYS_BACK = 60;


export default async function MyJobsPage(props: PageProps<"/my-jobs">) {
  const { business, crewMember } = await requireCrewMember();
  const { notice } = await props.searchParams;
  const today = todayInTimeZone(business.time_zone);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crew_jobs", {
    from_date: addDays(today, -DAYS_BACK),
    to_date: addDays(today, DAYS_AHEAD),
  });
  if (error) throw new Error(`Could not load your jobs: ${error.message}`);

  const overdue = data.filter((j) => j.scheduled_date < today && !isClosed(j.status));
  const todays = data.filter((j) => j.scheduled_date === today);
  const upcoming = data.filter((j) => j.scheduled_date > today && !isClosed(j.status));

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>My jobs</h1>
          <div className="meta">
            {crewMember.name} · {formatLongDate(today)}
          </div>
        </div>
      </div>

      {typeof notice === "string" && NOTICES[notice] && <Notice tone="success">{NOTICES[notice]}</Notice>}

      {overdue.length > 0 && (
        <section className="crew-section" aria-labelledby="overdue-heading">
          <h2 id="overdue-heading">Overdue</h2>
          {overdue.map((job) => (
            <CrewJobCard key={job.id} job={job} today={today} showDate />
          ))}
        </section>
      )}

      <section className="crew-section" aria-labelledby="today-heading">
        <h2 id="today-heading">Today</h2>
        {todays.length === 0 ? (
          <div className="panel">
            <div className="empty">
              <div className="big">No jobs today</div>
              Nothing is assigned to you today.
            </div>
          </div>
        ) : (
          todays.map((job) => <CrewJobCard key={job.id} job={job} today={today} />)
        )}
      </section>

      <section className="crew-section" aria-labelledby="upcoming-heading">
        <h2 id="upcoming-heading">Coming up</h2>
        {upcoming.length === 0 ? (
          <p className="hint">Nothing else assigned to you in the next {DAYS_AHEAD} days.</p>
        ) : (
          upcoming.map((job) => <CrewJobCard key={job.id} job={job} today={today} showDate />)
        )}
      </section>
    </>
  );
}
