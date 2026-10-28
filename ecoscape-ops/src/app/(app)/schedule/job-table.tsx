import Link from "next/link";

import { StatusPill } from "@/components/job-status";
import { RouteArrows } from "@/components/route/route-arrows";
import type { RouteRef } from "@/components/route/route-fields";
import { customerDisplayName } from "@/lib/customers/schema";
import { formatShortDate } from "@/lib/dates";
import { formatPrice, isClosed, isOverdue } from "@/lib/schedule/constants";

import type { JobListItem } from "./queries";

export function JobTable({ jobs, today, emptyTitle, emptyText, showCrew = false, route, selectForm }: {
  jobs: JobListItem[];
  today: string;
  emptyTitle: string;
  emptyText: React.ReactNode;
  // Only once the business has more than one crew member.
  showCrew?: boolean;
  // A day's route: the jobs are in route order, with arrows to change it.
  route?: RouteRef;
  // The id of a form to tick visits for (moving several at once). Closed visits can't be ticked.
  selectForm?: string;
}) {
  const order = jobs.map((j) => j.id);
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
          {selectForm && (
            <th className="select-cell">
              <span className="visually-hidden">Tick to move</span>
            </th>
          )}
          {route && <th>Stop</th>}
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
            {selectForm && (
              <td className="select-cell">
                {!isClosed(job.status) && (
                  <input
                    type="checkbox"
                    name="job_ids"
                    value={job.id}
                    form={selectForm}
                    aria-label={`Tick ${customerDisplayName(job.customer)} to move`}
                  />
                )}
              </td>
            )}
            {route && (
              <td className="stop-cell">
                <RouteArrows route={route} order={order} jobId={job.id} label={customerDisplayName(job.customer)} />
              </td>
            )}
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
            <td className="address-cell">
              {job.customer.property_address || "—"}
              {route && job.customer.geo_status !== "located" && (
                <Link className="date-tag overdue nowrap" href={`/customers/${job.customer.id}`}>
                  {job.customer.geo_status === "pending" ? "Not looked up yet" : "Location not found"}
                </Link>
              )}
            </td>
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
