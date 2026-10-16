import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Notice } from "@/components/notice";
import { RouteHeader } from "@/components/route/route-header";
import { requireOwner } from "@/lib/auth";
import { getCrew, showAssignment } from "@/lib/crew";
import { formatLongDate, isISODate, monthOf, todayInTimeZone } from "@/lib/dates";
import { getShop, locatePendingCustomers } from "@/lib/geo/customers";
import { buildRoute } from "@/lib/routes/build";
import { createClient } from "@/lib/supabase/server";

import { JobTable } from "../../job-table";
import { jobsBetween, type JobListItem } from "../../queries";

export const metadata: Metadata = { title: "Day" };

const pointOf = (job: JobListItem) =>
  job.customer.geo_status === "located" && job.customer.geo_lat != null && job.customer.geo_lon != null
    ? { lat: job.customer.geo_lat, lon: job.customer.geo_lon }
    : null;

export default async function DayPage(props: PageProps<"/schedule/day/[date]">) {
  const { business, user } = await requireOwner();
  const { date } = await props.params;
  const { notice } = await props.searchParams;
  if (!isISODate(date)) notFound();

  const today = todayInTimeZone(business.time_zone);
  const supabase = await createClient();

  // Place any of the day's customers that haven't been looked up yet.
  const { data: pending } = await supabase
    .from("jobs")
    .select("customer_id, customers!inner(geo_status)")
    .eq("business_id", business.id)
    .eq("scheduled_date", date)
    .eq("customers.geo_status", "pending");
  if (pending && pending.length > 0) {
    await locatePendingCustomers(business.id, { customerIds: [...new Set(pending.map((p) => p.customer_id))], budgetMs: 6_000 });
  }

  const [jobs, crew, shop, { data: days, error: daysError }] = await Promise.all([
    jobsBetween(business.id, date, date),
    getCrew(business.id, user.id),
    getShop(business.id),
    supabase.from("route_days").select("crew_member_id, start_address, start_lat, start_lon, manual_order").eq("business_id", business.id).eq("route_date", date),
  ]);
  if (daysError) throw new Error(`Could not load routes: ${daysError.message}`);
  const showCrew = showAssignment(crew);

  // One route per crew member with visits that day (owner first), then unassigned visits.
  const live = jobs.filter((j) => j.status !== "cancelled");
  const cancelled = jobs.filter((j) => j.status === "cancelled");
  const owners = [...crew.map((c) => c.id), null];
  const routes = owners
    .map((crewMemberId) => {
      const stops = live.filter((j) => j.assigned_crew_member_id === crewMemberId || (crewMemberId === null && !crew.some((c) => c.id === j.assigned_crew_member_id)));
      const member = crew.find((c) => c.id === crewMemberId);
      const label = !showCrew ? "Route" : member ? (member.user_id === user.id ? `${member.name} (you)` : member.name) : "Unassigned";
      const day = days.find((d) => d.crew_member_id === crewMemberId);
      return { crewMemberId, label, ...buildRoute(stops, pointOf, day, shop) };
    })
    .filter((r) => r.stops.length > 0);
  const returnTo = `/schedule/day/${date}`;

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
      {notice === "route-error" && <Notice tone="error">That route change couldn&apos;t be saved. Please try again.</Notice>}
      {!shop && live.length > 0 && (
        <Notice tone="warn">
          <Link href="/settings">Set your shop address</Link> to put each day&apos;s visits in route order.
        </Notice>
      )}

      {routes.length === 0 && cancelled.length === 0 && (
        <div className="panel">
          <div className="panel-body flush">
            <JobTable jobs={[]} today={today} emptyTitle="Nothing scheduled" emptyText="No visits are booked for this day." />
          </div>
        </div>
      )}
      {routes.map((r) => (
        <section className="panel route-panel" key={r.crewMemberId ?? "unassigned"} aria-label={`${r.label} route`} data-route={r.label}>
          <div className="panel-head">
            <h3>
              {r.label} · {r.stops.length} {r.stops.length === 1 ? "stop" : "stops"}
            </h3>
          </div>
          <div className="panel-body">
            <RouteHeader
              route={{ date, crewMemberId: r.crewMemberId, returnTo }}
              label={`${r.label} route`}
              start={r.start}
              manual={r.manual}
              canOrder={r.canOrder}
            />
          </div>
          <div className="panel-body flush">
            <JobTable jobs={r.stops} today={today} emptyTitle="" emptyText="" showCrew={false} route={{ date, crewMemberId: r.crewMemberId, returnTo }} />
          </div>
        </section>
      ))}
      {cancelled.length > 0 && (
        <section className="panel" aria-label="Cancelled visits">
          <div className="panel-head">
            <h3>Cancelled</h3>
          </div>
          <div className="panel-body flush">
            <JobTable jobs={cancelled} today={today} emptyTitle="" emptyText="" showCrew={showCrew} />
          </div>
        </section>
      )}
    </>
  );
}
