import type { Metadata } from "next";
import Link from "next/link";

import { Notice } from "@/components/notice";
import { requireMembership, type Membership } from "@/lib/auth";
import { getCrew, showAssignment } from "@/lib/crew";
import { formatLongDate, formatMonth, formatShortDate, monthOf } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/expenses/schema";
import { formatPrice } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";
import { getServiceArea, type ServiceArea } from "@/lib/weather/queries";

import { quickLogExpense } from "../expenses/actions";
import { CrewJobCard } from "../my-jobs/crew-job-card";
import { JobTable } from "../schedule/job-table";
import { jobsBetween } from "../schedule/queries";
import { QuickLog } from "./quick-log";
import { WeatherCard } from "./weather-card";

export const metadata: Metadata = { title: "Home · EcoScape Ops" };

// From dashboard_summary(): the money fields are null for crew members.
type Summary = {
  month_expenses: number | null;
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
  const [todaysJobs, crew] = await Promise.all([
    jobsBetween(business.id, summary.today, summary.today),
    getCrew(business.id, user.id),
  ]);

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Home</h1>
          <div className="meta">{formatLongDate(summary.today)}</div>
        </div>
      </div>

      <LoggedNotice expenseId={loggedExpenseId} />

      <CountCards
        summary={summary}
        whose="Business"
        weather={<WeatherCard area={area} today={summary.today} isOwner />}
      />

      <div className="grid g2">
        <div className="card accent-sage" data-card="revenue">
          <div className="label">REVENUE · {month.toUpperCase()}</div>
          <div className="big">{formatPrice(booked)}</div>
          <div className="sub">booked this month, completed or not</div>
          <div className="sub strong">{formatPrice(completed)} completed so far</div>
        </div>
        <div className="card" data-card="profit">
          <div className="label">EST. PROFIT · {month.toUpperCase()}</div>
          <div className="big">{formatPrice(booked - expenses)}</div>
          <div className="sub">
            revenue minus <Link href="/expenses">{formatPrice(expenses)} in expenses</Link> this month
          </div>
        </div>
      </div>

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
            showCrew={showAssignment(crew)}
          />
        </div>
      </div>
    </>
  );
}

async function CrewDashboard({ summary, area }: { summary: Summary; area: ServiceArea | null }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crew_jobs", { from_date: summary.today, to_date: summary.today });
  if (error) throw new Error(`Could not load your jobs: ${error.message}`);

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Home</h1>
          <div className="meta">{formatLongDate(summary.today)}</div>
        </div>
        <Link className="btn secondary small" href="/my-jobs">
          All my jobs
        </Link>
      </div>

      <CountCards
        summary={summary}
        whose="Your"
        weather={
          // Crew members see the forecast once the owner has set a service area.
          area && <WeatherCard area={area} today={summary.today} isOwner={false} />
        }
      />

      <section className="crew-section" aria-labelledby="today-heading">
        <h2 id="today-heading">Your jobs today</h2>
        {data.length === 0 ? (
          <div className="panel">
            <div className="empty">
              <div className="big">No jobs today</div>
              Nothing is assigned to you today.
            </div>
          </div>
        ) : (
          data.map((job) => <CrewJobCard key={job.id} job={job} today={summary.today} />)
        )}
      </section>
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
