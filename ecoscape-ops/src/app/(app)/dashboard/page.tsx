import type { Metadata } from "next";
import Link from "next/link";

import { Notice } from "@/components/notice";
import { requireMembership, type Membership } from "@/lib/auth";
import { getCrew, showAssignment } from "@/lib/crew";
import { customerDisplayName } from "@/lib/customers/schema";
import { formatLongDate, formatMonth, formatShortDate, monthOf } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/expenses/schema";
import { formatPrice } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";
import { getShop } from "@/lib/geo/customers";
import { buildRoute } from "@/lib/routes/build";
import { getServiceArea, type ServiceArea } from "@/lib/weather/queries";

import { quickLogExpense } from "../expenses/actions";
import { crewCustomerName } from "../my-jobs/crew-job-card";
import { JobTable } from "../schedule/job-table";
import { jobsBetween, type JobListItem } from "../schedule/queries";
import { getMyClock } from "../time-clock/clock-state";
import { WorkdayCard } from "../time-clock/workday-card";
import { CrewNow } from "./crew-now";
import { QuickLog } from "./quick-log";
import { TodayRoute, type TodayStop } from "./today-route";
import { WeatherCard } from "./weather-card";

export const metadata: Metadata = { title: "Today" };

const located = (geo: { geo_status: string; geo_lat: number | null; geo_lon: number | null }) =>
  geo.geo_status === "located" && geo.geo_lat != null && geo.geo_lon != null ? { lat: geo.geo_lat, lon: geo.geo_lon } : null;

// From dashboard_summary(): the money fields are null for crew members.
type Summary = {
  month_expenses: number | null;
  outstanding: number | null;
  overdue: number | null;
  month_collected: number | null;
  today: string;
  today_total: number;
  today_completed: number;
  tomorrow_total: number;
  week_total: number;
  month_booked: number | null;
  month_completed: number | null;
};

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const membership = await requireMembership();
  const { logged } = await props.searchParams;
  const supabase = await createClient();
  // Role-aware in the database: owners get the whole business, crew only their own jobs.
  const { data, error } = await supabase.rpc("dashboard_summary");
  if (error) throw new Error(`Could not load your dashboard: ${error.message}`);
  const summary = data[0] as Summary | undefined;
  if (!summary) throw new Error("Could not load your dashboard.");
  const area = await getServiceArea();

  return membership.role === "owner" ? (
    <OwnerDashboard
      membership={membership}
      summary={summary}
      area={area}
      loggedExpenseId={typeof logged === "string" ? logged : undefined}
    />
  ) : (
    <CrewDashboard summary={summary} area={area} />
  );
}

// The day's counts, plus the weather card when there is one.
function CountCards({ summary, whose, weather }: { summary: Summary; whose: string; weather?: React.ReactNode }) {
  const remaining = summary.today_total - summary.today_completed;
  return (
    <div className={weather ? "grid g4" : "grid g3"} aria-label={`${whose} job counts`}>
      <div className="card accent-sage" data-card="today">
        <div className="label">TODAY</div>
        <div className="big">{summary.today_total}</div>
        <div className="sub">
          {summary.today_completed} completed · {remaining} remaining
        </div>
      </div>
      <div className="card accent-sky" data-card="tomorrow">
        <div className="label">TOMORROW</div>
        <div className="big">{summary.tomorrow_total}</div>
        <div className="sub">{summary.tomorrow_total === 1 ? "job" : "jobs"} scheduled</div>
      </div>
      <div className="card accent-sun" data-card="week">
        <div className="label">THIS WEEK</div>
        <div className="big">{summary.week_total}</div>
        <div className="sub">today and the next 6 days</div>
      </div>
      {weather}
    </div>
  );
}

async function OwnerDashboard({
  membership,
  summary,
  area,
  loggedExpenseId,
}: {
  membership: Membership;
  summary: Summary;
  area: ServiceArea | null;
  loggedExpenseId?: string;
}) {
  const { business, user } = membership;
  const month = formatMonth(monthOf(summary.today)).split(" ")[0];
  const booked = summary.month_booked ?? 0;
  const completed = summary.month_completed ?? 0;
  const expenses = summary.month_expenses ?? 0;
  const outstanding = summary.outstanding ?? 0;
  const overdue = summary.overdue ?? 0;
  const supabase = await createClient();
  const [todaysJobs, crew, shop, clock, { data: routeDays }] = await Promise.all([
    jobsBetween(business.id, summary.today, summary.today),
    getCrew(business.id, user.id),
    getShop(business.id),
    getMyClock(),
    supabase.from("route_days").select("crew_member_id, start_address, start_lat, start_lon, manual_order").eq("business_id", business.id).eq("route_date", summary.today),
  ]);
  const hasCrew = showAssignment(crew);
  // The owner's own route: visits assigned to them (and, working solo, every visit).
  const me = crew.find((c) => c.user_id === user.id);
  const mine = todaysJobs.filter(
    (j) => j.status !== "cancelled" && (j.assigned_crew_member_id === me?.id || (!hasCrew && j.assigned_crew_member_id === null)),
  );
  const myRouteKey = hasCrew ? (me?.id ?? null) : null;
  const ownRoute = buildRoute(
    mine,
    (j: JobListItem) => located(j.customer),
    routeDays?.find((d) => d.crew_member_id === myRouteKey),
    shop,
  );
  const ownStops: TodayStop[] = ownRoute.stops.map((j) => ({
    id: j.id,
    status: j.status,
    service: j.service_name,
    customerName: customerDisplayName(j.customer),
    phone: j.customer.phone,
    address: j.customer.property_address,
    access: j.customer.access_instructions,
    customerNotes: j.customer.service_notes,
    href: `/schedule/jobs/${j.id}`,
  }));

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Today</h1>
          <div className="meta">{formatLongDate(summary.today)}</div>
        </div>
      </div>

      <LoggedNotice expenseId={loggedExpenseId} />
      <WorkdayCard />
      {ownStops.length > 0 && (
        <section aria-label="Your route">
          {hasCrew && <h2 className="today-section-heading">Your route</h2>}
          <TodayRoute stops={ownStops} clock={clock} emptyText="" canMove />
        </section>
      )}
      {hasCrew && <CrewNow businessId={business.id} crew={crew} ownerUserId={user.id} timeZone={business.time_zone} />}

      <CountCards
        summary={summary}
        whose="Business"
        weather={<WeatherCard area={area} today={summary.today} isOwner />}
      />

      <div className="panel">
        <div className="panel-head">
          <h3>Quick actions</h3>
        </div>
        <div className="panel-body quick-actions">
          <Link className="btn secondary small" href="/customers/new">
            + Add customer
          </Link>
          <Link className="btn secondary small" href="/schedule/new">
            + Book a job
          </Link>
          <Link className="btn secondary small" href="/invoices/new">
            + New invoice
          </Link>
          {/* Keyed on the last logged expense so the quick-log forms close after saving. */}
          <QuickLog
            key={`fuel-${loggedExpenseId}`}
            action={quickLogExpense.bind(null, "fuel")}
            label="Log gas"
            vendorPlaceholder="e.g. Speedway"
          />
          <QuickLog
            key={`equipment-${loggedExpenseId}`}
            action={quickLogExpense.bind(null, "equipment")}
            label="Log equipment"
            vendorPlaceholder="e.g. Home Depot"
          />
          <Link className="btn secondary small" href="/expenses/new">
            + Other expense
          </Link>
          <Link className="btn secondary small" href="/weather/move">
            Move a day&apos;s jobs (weather)
          </Link>
          <Link className="btn secondary small" href="/crew">
            Manage crew
          </Link>
          <Link className="btn secondary small" href="/schedule?view=list&filter=attention">
            Needs attention
          </Link>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Today&apos;s jobs</h3>
          <Link className="btn secondary small" href="/schedule">
            View schedule
          </Link>
        </div>
        <div className="panel-body flush">
          <JobTable
            jobs={todaysJobs}
            today={summary.today}
            emptyTitle="Nothing scheduled today"
            emptyText="No jobs are booked for today."
            showCrew={hasCrew}
          />
        </div>
      </div>

      <div className="grid money">
        <div className="card accent-sage" data-card="revenue">
          <div className="label">REVENUE · {month.toUpperCase()}</div>
          <div className="big">{formatPrice(booked)}</div>
          <div className="sub">booked this month, completed or not (invoiced visits at their invoiced amount)</div>
          <div className="sub strong">{formatPrice(completed)} completed so far</div>
          <div className="sub">{formatPrice(summary.month_collected ?? 0)} collected this month</div>
        </div>
        <div className="card" data-card="profit">
          <div className="label">EST. PROFIT · {month.toUpperCase()}</div>
          <div className="big">{formatPrice(booked - expenses)}</div>
          <div className="sub">
            revenue minus <Link href="/expenses">{formatPrice(expenses)} in expenses</Link> this month
          </div>
        </div>
        <div className="card accent-sun" data-card="outstanding">
          <div className="label">OUTSTANDING</div>
          <div className="big">{formatPrice(outstanding)}</div>
          <div className="sub">owed on sent invoices</div>
          <div className={overdue > 0 ? "sub strong overdue-text" : "sub"}>
            {overdue > 0 ? <Link href="/invoices?status=overdue">{formatPrice(overdue)} overdue</Link> : "nothing overdue"}
          </div>
        </div>
      </div>
    </>
  );
}

// A crew member's Today: their workday clock, the visit they're on (or the next one) with one
// big button, then the rest of their route. Only their own visits, never prices.
async function CrewDashboard({ summary, area }: { summary: Summary; area: ServiceArea | null }) {
  const supabase = await createClient();
  const [{ data: route, error }, { data: settings, error: settingsError }, clock] = await Promise.all([
    supabase.rpc("crew_route", { route_date: summary.today }),
    supabase.rpc("crew_route_settings", { route_date: summary.today }).maybeSingle(),
    getMyClock(),
  ]);
  if (error || settingsError) throw new Error(`Could not load your jobs: ${(error ?? settingsError)!.message}`);
  const shop =
    settings?.shop_address && settings.shop_lat != null && settings.shop_lon != null
      ? { address: settings.shop_address, lat: settings.shop_lat, lon: settings.shop_lon }
      : null;
  const stops: TodayStop[] = buildRoute(route, located, settings, shop).stops.map((j) => ({
    id: j.id,
    status: j.status,
    service: j.service_name,
    customerName: crewCustomerName(j),
    phone: j.customer_phone,
    address: j.property_address,
    access: j.access_instructions,
    customerNotes: j.service_notes,
    href: `/my-jobs#job-${j.id}`,
  }));

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Today</h1>
          <div className="meta">{formatLongDate(summary.today)}</div>
        </div>
      </div>
      <WorkdayCard />
      <TodayRoute stops={stops} clock={clock} emptyText="Nothing is assigned to you today." />
      {area && (
        <div className="grid today-weather">
          <WeatherCard area={area} today={summary.today} isOwner={false} />
        </div>
      )}
    </>
  );
}

// "Logged $62.40 for fuel (Speedway)." after a quick-log.
async function LoggedNotice({ expenseId }: { expenseId?: string }) {
  if (!expenseId || !/^[0-9a-f-]{36}$/.test(expenseId)) return null;
  const supabase = await createClient();
  const { data: expense } = await supabase
    .from("expenses")
    .select("id, amount, category, vendor, spent_on")
    .eq("id", expenseId)
    .maybeSingle();
  if (!expense) return null;
  return (
    <Notice tone="success">
      Logged {formatPrice(expense.amount)} for {EXPENSE_CATEGORY_LABELS[expense.category].toLowerCase()}
      {expense.vendor && ` (${expense.vendor})`} on {formatShortDate(expense.spent_on)}.{" "}
      <Link href={`/expenses/${expense.id}/edit`}>Edit</Link>
    </Notice>
  );
}
