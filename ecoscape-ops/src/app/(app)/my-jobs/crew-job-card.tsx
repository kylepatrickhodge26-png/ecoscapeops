import { StatusPill } from "@/components/job-status";
import { customerDisplayName } from "@/lib/customers/schema";
import { addDays, formatShortDate } from "@/lib/dates";
import { isClosed, type JobStatus } from "@/lib/schedule/constants";

import { JobExtras } from "../job-extras/job-extras";
import { JobClock } from "../time-clock/job-clock";
import { CouldNotService } from "../schedule/jobs/[id]/could-not-service";
import { addMyJobNote, crewCouldNotService } from "./actions";
import { AddNote } from "./crew-job-actions";


// One job as a crew member sees it (from crew_jobs(): no price).
export type CrewJob = {
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

export const crewCustomerName = (job: Pick<CrewJob, "customer_first_name" | "customer_last_name" | "customer_phone" | "customer_email">) =>
  customerDisplayName({
    first_name: job.customer_first_name,
    last_name: job.customer_last_name,
    phone: job.customer_phone,
    email: job.customer_email,
  });

export function CrewJobCard({ job, today, showDate = false }: { job: CrewJob; today: string; showDate?: boolean }) {
  const name = crewCustomerName(job);
  const open = !isClosed(job.status);
  const latest = (a: string, b: string) => (a > b ? a : b);

  return (
    <article className="jobitem" id={`job-${job.id}`} data-job-id={job.id} aria-label={`${job.service_name} for ${name}`}>
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
      {/* Clock in starts the job; Clock out & finish completes it. */}
      <JobClock jobId={job.id} status={job.status} compact />
      <JobExtras jobId={job.id} />
      <div className="actions">
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
