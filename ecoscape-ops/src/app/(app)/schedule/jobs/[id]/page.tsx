import type { Metadata } from "next";
import Link from "next/link";

import { ConfirmButton } from "@/components/confirm-button";
import { StatusPill } from "@/components/job-status";
import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers/schema";
import { addDays, formatLongDate, formatShortDate, monthOf, todayInTimeZone } from "@/lib/dates";
import { FREQUENCY_LABELS, formatPrice, isClosed, isOverdue } from "@/lib/schedule/constants";

import { couldNotService, deleteJob, markJobCompleted } from "../../actions";
import { getJobOr404 } from "../../get-job";
import { CouldNotService } from "./could-not-service";
import { MarkCompleted } from "./mark-completed";

export const metadata: Metadata = { title: "Visit · EcoScape Ops" };

const NOTICES: Record<string, string> = {
  updated: "Changes saved.",
  completed: "Marked completed.",
  rescheduled: "Visit rescheduled.",
  cancelled: "Visit cancelled.",
};

export default async function JobPage(props: PageProps<"/schedule/jobs/[id]">) {
  const { business } = await requireOwner();
  const { id } = await props.params;
  const { notice } = await props.searchParams;
  const job = await getJobOr404(id);
  const today = todayInTimeZone(business.time_zone);
  const name = customerDisplayName(job.customer);
  const open = !isClosed(job.status);
  const latest = (a: string, b: string) => (a > b ? a : b);

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href={`/schedule?month=${monthOf(job.scheduled_date)}`}>
            ← Schedule
          </Link>
          <h1>
            {job.service_name} for {name}
          </h1>
          <div className="meta">
            {formatLongDate(job.scheduled_date)}
            {job.scheduled_date === today && " · Today"}
          </div>
          <div className="job-status-row">
            <StatusPill status={job.status} />
            {isOverdue(job, today) && <span className="date-tag overdue">Overdue</span>}
          </div>
        </div>
      </div>
      <div className="job-actions">
          {open && <MarkCompleted action={markJobCompleted.bind(null, job.id)} />}
          {open && (
            <CouldNotService
              action={couldNotService.bind(null, job.id)}
              defaultNewDate={latest(addDays(job.scheduled_date, 1), today)}
              today={today}
            />
          )}
          <Link className="btn secondary small" href={`/schedule/jobs/${job.id}/edit`}>
            Edit
          </Link>
          <ConfirmButton
            action={deleteJob.bind(null, job.id)}
            label="Delete"
            confirmLabel="Yes, delete"
            pendingLabel="Deleting…"
            confirmText={
              <>
                Delete this {job.service_name} visit for <b>{name}</b> on {formatShortDate(job.scheduled_date)}? This
                can&apos;t be undone.
              </>
            }
          />
      </div>

      {typeof notice === "string" && NOTICES[notice] && <Notice tone="success">{NOTICES[notice]}</Notice>}
      {job.customer.access_instructions && <div className="notice">Access: {job.customer.access_instructions}</div>}
      {job.customer.service_notes && <div className="notice pre-line">Customer notes: {job.customer.service_notes}</div>}

      <div className="panel">
        <div className="panel-head">
          <h3>Details</h3>
        </div>
        <div className="panel-body">
          <dl className="details">
            <div>
              <dt>Customer</dt>
              <dd>
                <Link href={`/customers/${job.customer.id}`}>{name}</Link>
              </dd>
            </div>
            <div>
              <dt>Property address</dt>
              <dd>{job.customer.property_address || "—"}</dd>
            </div>
            <div>
              <dt>Service</dt>
              <dd>{job.service_name}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{formatPrice(job.price)}</dd>
            </div>
            <div>
              <dt>Repeats</dt>
              <dd>
                {FREQUENCY_LABELS[job.plan.frequency]}
                {job.plan.frequency !== "one_time" && !job.plan.active && " (stopped)"}
              </dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{job.customer.phone || "—"}</dd>
            </div>
            {job.completed_at && (
              <div>
                <dt>Completed</dt>
                <dd>{formatShortDate(new Date(job.completed_at).toLocaleDateString("en-CA", { timeZone: business.time_zone }))}</dd>
              </div>
            )}
          </dl>
          {job.notes && (
            <div className="job-notes">
              <div className="label">Notes</div>
              <p className="pre-line">{job.notes}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
