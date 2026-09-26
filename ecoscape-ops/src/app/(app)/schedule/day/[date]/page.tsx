import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { formatLongDate, isISODate, monthOf, todayInTimeZone } from "@/lib/dates";

import { JobTable } from "../../job-table";
import { jobsBetween } from "../../queries";

export const metadata: Metadata = { title: "Day · EcoScape Ops" };

export default async function DayPage(props: PageProps<"/schedule/day/[date]">) {
  const { business } = await requireOwner();
  const { date } = await props.params;
  const { notice } = await props.searchParams;
  if (!isISODate(date)) notFound();

  const today = todayInTimeZone(business.time_zone);
  const jobs = await jobsBetween(business.id, date, date);

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href={`/schedule?month=${monthOf(date)}`}>
            ← Calendar
          </Link>
          <h1>{formatLongDate(date)}</h1>
          <div className="meta">
            {date === today ? "Today · " : ""}
            {jobs.length} {jobs.length === 1 ? "visit" : "visits"}
          </div>
        </div>
        {date >= today && (
          <Link className="btn" href={`/schedule/new?date=${date}`}>
            + Book a job this day
          </Link>
        )}
      </div>
      {notice === "deleted" && <Notice tone="success">Visit deleted.</Notice>}
      <div className="panel">
        <div className="panel-body flush">
          <JobTable jobs={jobs} today={today} emptyTitle="Nothing scheduled" emptyText="No visits are booked for this day." />
        </div>
      </div>
    </>
  );
}
