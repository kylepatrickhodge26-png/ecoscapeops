import Link from "next/link";

import { StatusPill } from "@/components/job-status";
import { customerDisplayName } from "@/lib/customers/schema";
import { formatShortDate } from "@/lib/dates";
import { formatPrice, isOverdue } from "@/lib/schedule/constants";

import type { JobListItem } from "./queries";

export function JobTable({ jobs, today, emptyTitle, emptyText, showCrew = false }: {
  jobs: JobListItem[];
  today: string;
  emptyTitle: string;
  emptyText: React.ReactNode;
  // Only once the business has more than one crew member.
  showCrew?: boolean;
}) {
  if (jobs.length === 0) {
    return (
      <div className="empty">
        <div className="big">{emptyTitle}</div>
        {emptyText}
      </div>
    );
  }

  return (
    <table className="job-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Customer</th>
          <th>Service</th>
          <th>Property address</th>
          {showCrew && <th>Crew</th>}
          <th>Status</th>
          <th>
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.id} data-job-id={job.id}>
            <td className="date-cell">
              <span className="nowrap">{formatShortDate(job.scheduled_date)}</span>
              {job.scheduled_date === today && <span className="date-tag">Today</span>}
              {isOverdue(job, today) && <span className="date-tag overdue">Overdue</span>}
            </td>
            <td className="name-cell">
              <Link className="row-link" href={`/schedule/jobs/${job.id}`}>
                <b>{customerDisplayName(job.customer)}</b>
              </Link>
            </td>
            <td className="service-cell">
              {job.service_name} · {formatPrice(job.price)}
            </td>
            <td className="address-cell">{job.customer.property_address || "—"}</td>
            {showCrew && <td className="crew-cell">{job.assignee?.name ?? <span className="subtext">Unassigned</span>}</td>}
            <td className="status-cell">
              <StatusPill status={job.status} />
            </td>
            <td className="actions-cell">
              <Link className="btn secondary small" href={`/schedule/jobs/${job.id}`}>
                Open
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
