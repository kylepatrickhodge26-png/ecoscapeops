import type { Metadata } from "next";
import Link from "next/link";

import { requireOwner } from "@/lib/auth";
import { formatShortDate, todayInTimeZone } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/expenses/schema";
import { parseRange, presets } from "@/lib/reports/range";
import { formatPrice } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Reports" };

function monthLabel(isoDate: string) {
  const [y, m] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default async function ReportsPage(props: PageProps<"/reports">) {
  const { business } = await requireOwner();
  const params = await props.searchParams;
  const today = todayInTimeZone(business.time_zone);
  const range = parseRange(params, today);
  const args = { from_date: range.from, to_date: range.to };

  const supabase = await createClient();
  const [summary, byMonth, byCustomer, byService, byCategory, byCrew] = await Promise.all([
    supabase.rpc("report_summary", args),
    supabase.rpc("report_revenue_by_month", args),
    supabase.rpc("report_revenue_by_customer", args),
    supabase.rpc("report_revenue_by_service", args),
    supabase.rpc("report_expenses_by_category", args),
    supabase.rpc("report_jobs_by_crew", args),
  ]);
  const failed = [summary, byMonth, byCustomer, byService, byCategory, byCrew].find((r) => r.error);
  if (failed?.error) throw new Error(`Could not load reports: ${failed.error.message}`);

  const s = summary.data![0] ?? { booked: 0, completed: 0, collected: 0, expenses: 0, outstanding: 0, overdue: 0 };
  const query = `from=${range.from}&to=${range.to}`;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Reports</h1>
          <div className="meta">
            {formatShortDate(range.from)} to {formatShortDate(range.to)} · Owner only, crew members never see reports
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-body">
          <form method="get" action="/reports" className="range-form">
            <div className="field">
              <label htmlFor="from">From</label>
              <input id="from" name="from" type="date" defaultValue={range.from} required />
            </div>
            <div className="field">
              <label htmlFor="to">To</label>
              <input id="to" name="to" type="date" defaultValue={range.to} required />
            </div>
            <button className="btn" type="submit">
              Show
            </button>
          </form>
          <div className="range-presets">
            {presets(today).map((p) => (
              <Link key={p.key} className="btn secondary small" href={`/reports?from=${p.range.from}&to=${p.range.to}`}>
                {p.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="card accent-sage" data-card="report-booked">
          <div className="label">BOOKED</div>
          <div className="big">{formatPrice(s.booked)}</div>
          <div className="sub">Visits and invoice extras, cancelled visits left out</div>
        </div>
        <div className="card accent-sage" data-card="report-completed">
          <div className="label">COMPLETED</div>
          <div className="big">{formatPrice(s.completed)}</div>
          <div className="sub">Work done</div>
        </div>
        <div className="card accent-sky" data-card="report-collected">
          <div className="label">COLLECTED</div>
          <div className="big">{formatPrice(s.collected)}</div>
          <div className="sub">Payments received</div>
        </div>
        <div className="card accent-clay" data-card="report-expenses">
          <div className="label">EXPENSES</div>
          <div className="big">{formatPrice(s.expenses)}</div>
        </div>
        <div className="card accent-sage" data-card="report-profit">
          <div className="label">PROFIT</div>
          <div className="big">{formatPrice(Math.round((s.completed - s.expenses) * 100) / 100)}</div>
          <div className="sub">
            Completed work minus expenses · cash basis {formatPrice(Math.round((s.collected - s.expenses) * 100) / 100)}
          </div>
        </div>
        <div className="card accent-clay" data-card="report-owed">
          <div className="label">OWED TO YOU NOW</div>
          <div className="big">{formatPrice(s.outstanding)}</div>
          <div className="sub">{formatPrice(s.overdue)} overdue (as of today, not just this range)</div>
        </div>
      </div>

      <Table
        title="Revenue by month"
        testId="by-month"
        head={["Month", "Booked", "Completed"]}
        rows={byMonth.data!.map((r) => [monthLabel(r.month), formatPrice(r.booked), formatPrice(r.completed)])}
      />
      <Table
        title="Revenue by customer"
        testId="by-customer"
        head={["Customer", "Booked", "Completed"]}
        rows={byCustomer.data!.map((r) => [r.customer_name, formatPrice(r.booked), formatPrice(r.completed)])}
      />
      <Table
        title="Revenue by service"
        testId="by-service"
        head={["Service", "Booked", "Completed"]}
        rows={byService.data!.map((r) => [r.service_name, formatPrice(r.booked), formatPrice(r.completed)])}
      />
      <Table
        title="Expenses by category"
        testId="by-category"
        head={["Category", "Spent"]}
        rows={byCategory.data!.map((r) => [EXPENSE_CATEGORY_LABELS[r.category] ?? r.category, formatPrice(r.total)])}
      />
      <Table
        title="Visits per crew member"
        testId="by-crew"
        head={["Crew member", "Completed", "Scheduled"]}
        rows={byCrew.data!.map((r) => [r.crew_name, String(r.completed), String(r.scheduled)])}
      />

      <div className="panel">
        <div className="panel-head">
          <h3>Export for your accountant (CSV)</h3>
        </div>
        <div className="panel-body">
          <p className="hint">
            Opens in Excel, Google Sheets or Numbers. Jobs, invoices and expenses use the dates above; customers are all of them.
          </p>
          <div className="range-presets">
            <a className="btn secondary small" href="/reports/export/customers" download>
              Customers
            </a>
            <a className="btn secondary small" href={`/reports/export/jobs?${query}`} download>
              Jobs
            </a>
            <a className="btn secondary small" href={`/reports/export/invoices?${query}`} download>
              Invoices
            </a>
            <a className="btn secondary small" href={`/reports/export/expenses?${query}`} download>
              Expenses
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

function Table({ title, testId, head, rows }: { title: string; testId: string; head: string[]; rows: string[][] }) {
  return (
    <div className="panel" data-testid={testId}>
      <div className="panel-head">
        <h3>{title}</h3>
      </div>
      <div className="panel-body flush">
        {rows.length === 0 ? (
          <div className="empty">Nothing in this date range.</div>
        ) : (
          <table className="invoice-table">
            <thead>
              <tr>
                {head.map((h, i) => (
                  <th key={h} className={i > 0 ? "num" : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i} className={i > 0 ? "num" : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
