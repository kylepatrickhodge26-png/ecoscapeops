import type { Metadata } from "next";

import { StatusPill } from "@/components/job-status";
import { Notice } from "@/components/notice";
import { requireCrewMember } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers/schema";
import { addDays, formatLongDate, formatShortDate, todayInTimeZone } from "@/lib/dates";
import { isClosed, type JobStatus } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

import { CouldNotService } from "../schedule/jobs/[id]/could-not-service";
import { addMyJobNote, crewCouldNotService, setMyJobStatus } from "./actions";
import { AddNote, CrewStatusButton } from "./crew-job-actions";

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

// Like the prototype's crew buttons: start a job that hasn't started, finish one that has.
const STARTABLE: readonly JobStatus[] = ["scheduled", "assigned", "en_route", "weather_delay", "unable_to_complete"];

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

type CrewJob = {
  id: string;
  scheduled_date: string;
  status: JobStatus;
  service_name: string;
  notes: string;
  customer_first_name: string;
  customer_last_name: string;
  customer_phone: string;
  customer_email: string;
  property_address: string;
  access_instructions: string;
  service_notes: string;
};

function CrewJobCard({ job, today, showDate = false }: { job: CrewJob; today: string; showDate?: boolean }) {
  const name = customerDisplayName({
    first_name: job.customer_first_name,
    last_name: job.customer_last_name,
    phone: job.customer_phone,
    email: job.customer_email,
  });
  const open = !isClosed(job.status);
  const latest = (a: string, b: string) => (a > b ? a : b);

  return (
    <article className="jobitem" data-job-id={job.id} aria-label={`${job.service_name} for ${name}`}>
      <div className="top">
        <div>
          <div className="cust">{name}</div>
          {job.property_address && <div className="addr">{job.property_address}</div>}
          {showDate && <div className="addr">{formatShortDate(job.scheduled_date)}</div>}
        </div>
        <StatusPill status={job.status} />
      </div>
      <div className="svc">
        {job.service_name}
        {job.customer_phone && (
          <>
            {" · "}
            <a href={`tel:${job.customer_phone.replace(/[^\d+]/g, "")}`}>{job.customer_phone}</a>
          </>
        )}
      </div>
      {job.access_instructions && <div className="notice compact">Access: {job.access_instructions}</div>}
      {job.service_notes && <div className="notice compact pre-line">Customer notes: {job.service_notes}</div>}
      {job.notes && <div className="job-notes-inline pre-line">{job.notes}</div>}
      <div className="actions">
        {open && STARTABLE.includes(job.status) && (
          <CrewStatusButton action={setMyJobStatus.bind(null, job.id, "in_progress")} label="Start job" pendingLabel="Starting…" />
        )}
        {open && (
          <CrewStatusButton
            action={setMyJobStatus.bind(null, job.id, "completed")}
            label="Mark completed"
            pendingLabel="Saving…"
            primary={job.status === "in_progress"}
          />
        )}
        {open && (
          <CouldNotService
            action={crewCouldNotService.bind(null, job.id, job.scheduled_date)}
            defaultNewDate={latest(addDays(job.scheduled_date, 1), today)}
            today={today}
          />
        )}
        <AddNote action={addMyJobNote.bind(null, job.id)} />
      </div>
    </article>
  );
}
