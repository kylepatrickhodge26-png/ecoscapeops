import type { Metadata } from "next";

import { Notice } from "@/components/notice";
import { RouteArrows } from "@/components/route/route-arrows";
import { RouteHeader } from "@/components/route/route-header";
import { requireCrewMember } from "@/lib/auth";
import { addDays, formatLongDate, todayInTimeZone } from "@/lib/dates";
import { buildRoute } from "@/lib/routes/build";
import { isClosed } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

import { CrewJobCard, crewCustomerName } from "./crew-job-card";

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
  const [{ data, error }, { data: route, error: routeError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase.rpc("crew_jobs", { from_date: addDays(today, -DAYS_BACK), to_date: addDays(today, DAYS_AHEAD) }),
    supabase.rpc("crew_route", { route_date: today }),
    supabase.rpc("crew_route_settings", { route_date: today }).maybeSingle(),
  ]);
  if (error || routeError || settingsError) throw new Error(`Could not load your jobs: ${(error ?? routeError ?? settingsError)!.message}`);

  const overdue = data.filter((j) => j.scheduled_date < today && !isClosed(j.status));
  const upcoming = data.filter((j) => j.scheduled_date > today && !isClosed(j.status));
  // Today's visits in route order (only this crew member's own), then any cancelled ones.
  const shop =
    settings?.shop_address && settings.shop_lat != null && settings.shop_lon != null
      ? { address: settings.shop_address, lat: settings.shop_lat, lon: settings.shop_lon }
      : null;
  const todays = buildRoute(
    route,
    (j) => (j.geo_status === "located" && j.geo_lat != null && j.geo_lon != null ? { lat: j.geo_lat, lon: j.geo_lon } : null),
    settings,
    shop,
  );
  const cancelledToday = data.filter((j) => j.scheduled_date === today && j.status === "cancelled");
  const routeRef = { date: today, crewMemberId: crewMember.id, returnTo: "/my-jobs" };
  const order = todays.stops.map((j) => j.id);

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
      {notice === "route-error" && <Notice tone="error">That route change couldn&apos;t be saved. Please try again.</Notice>}

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
        {todays.stops.length === 0 && cancelledToday.length === 0 ? (
          <div className="panel">
            <div className="empty">
              <div className="big">No jobs today</div>
              Nothing is assigned to you today.
            </div>
          </div>
        ) : (
          <>
            {todays.stops.length > 0 && (
              <div className="panel">
                <div className="panel-body">
                  <RouteHeader route={routeRef} label="your route" start={todays.start} manual={todays.manual} canOrder={todays.canOrder} />
                </div>
              </div>
            )}
            <ol className="route-stops" aria-label="Today's route">
              {todays.stops.map((job) => (
                <li key={job.id} className="route-stop" data-stop-job={job.id}>
                  <RouteArrows route={routeRef} order={order} jobId={job.id} label={crewCustomerName(job)} />
                  <div className="route-stop-card">
                    {job.geo_status !== "located" && (
                      <div className="date-tag overdue route-unplaced">{job.geo_status === "pending" ? "Not looked up yet" : "Location not found"}</div>
                    )}
                    <CrewJobCard job={job} today={today} />
                  </div>
                </li>
              ))}
            </ol>
            {cancelledToday.map((job) => (
              <CrewJobCard key={job.id} job={job} today={today} />
            ))}
          </>
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
