import type { Metadata } from "next";
import Link from "next/link";

import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers/schema";
import { formatShortDate, todayInTimeZone } from "@/lib/dates";
import { parseRange, presets } from "@/lib/reports/range";
import { formatPrice } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";
import { formatClock, formatDateTime, formatHours } from "@/lib/time/format";

export const metadata: Metadata = { title: "Time · EcoScape Ops" };

const NOTICES: Record<string, string> = { saved: "Time entry saved.", deleted: "Time entry deleted." };

export default async function TimePage(props: PageProps<"/time">) {
  const { business } = await requireOwner();
  const params = await props.searchParams;
  const today = todayInTimeZone(business.time_zone);
  const range = parseRange(params, today);
  const args = { from_date: range.from, to_date: range.to };

  const supabase = await createClient();
  const [byJob, byCrew, byCustomer, entries] = await Promise.all([
    supabase.rpc("time_by_job", args),
    supabase.rpc("time_by_crew", args),
    supabase.rpc("time_by_customer", args),
    supabase
      .from("time_entries")
      .select("id, crew_name, started_at, ended_at, note, edited_at, jobs!inner(id, service_name, scheduled_date, customer:customers(first_name, last_name, phone, email))")
      .gte("jobs.scheduled_date", range.from)
      .lte("jobs.scheduled_date", range.to)
      .order("started_at", { ascending: false })
      .limit(200),
  ]);
  const failed = [byJob, byCrew, byCustomer, entries].find((r) => r.error);
  if (failed?.error) throw new Error(`Could not load time: ${failed.error.message}`);

  const perHour = (v: number | null) => (v === null ? "—" : `${formatPrice(v)}/h`);
  const openCount = entries.data!.filter((e) => !e.ended_at).length;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Time</h1>
          <div className="meta">
            {formatShortDate(range.from)} to {formatShortDate(range.to)} · Owner only, crew never see hours worth or revenue per hour
          </div>
        </div>
      </div>
      {typeof params.notice === "string" && NOTICES[params.notice] && <Notice tone="success">{NOTICES[params.notice]}</Notice>}
      {openCount > 0 && (
        <Notice tone="warn">
          {openCount} {openCount === 1 ? "person is" : "people are"} still clocked in. If someone forgot to clock out, edit their entry below.
        </Notice>
      )}

      <div className="panel">
        <div className="panel-body">
          <form method="get" action="/time" className="range-form">
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
              <Link key={p.key} className="btn secondary small" href={`/time?from=${p.range.from}&to=${p.range.to}`}>
                {p.label}
              </Link>
            ))}
          </div>
          <p className="hint">
            Hours are by the visit&apos;s date. Revenue per hour is per labor hour (two people working an hour each is two hours), using the
            visit&apos;s price, or its invoiced amount once invoiced. Entries still clocked in aren&apos;t counted yet.
          </p>
        </div>
      </div>

      <Table
        title="By visit"
        testId="time-by-job"
        head={["Visit", "Customer", "Hours", "Worth", "Per hour"]}
        rows={byJob.data!.map((r) => [
          `${r.service_name} · ${formatShortDate(r.scheduled_date)}`,
          r.customer_name,
          formatHours(r.hours) + (r.open_entries > 0 ? " + open" : ""),
          formatPrice(r.job_value),
          perHour(r.revenue_per_hour),
        ])}
      />
      <Table
        title="By customer"
        testId="time-by-customer"
        head={["Customer", "Hours", "Visits", "Worth", "Per hour"]}
        rows={byCustomer.data!.map((r) => [r.customer_name, formatHours(r.hours), String(r.visits), formatPrice(r.job_value), perHour(r.revenue_per_hour)])}
      />
      <Table
        title="By crew member"
        testId="time-by-crew"
        head={["Crew member", "Hours", "Entries"]}
        rows={byCrew.data!.map((r) => [r.crew_name, formatHours(r.hours), String(r.entries)])}
      />

      <div className="panel" data-testid="time-entries">
        <div className="panel-head">
          <h3>Entries</h3>
        </div>
        <div className="panel-body">
          {entries.data!.length === 0 ? (
            <div className="empty">No time logged in this date range.</div>
          ) : (
            <ul className="time-list">
              {entries.data!.map((e) => (
                <li key={e.id}>
                  <b>{e.crew_name}</b> · {e.jobs?.service_name} for {e.jobs?.customer ? customerDisplayName(e.jobs.customer) : ""} ·{" "}
                  {formatDateTime(e.started_at, business.time_zone)} to{" "}
                  {e.ended_at ? formatClock(e.ended_at, business.time_zone) : <span className="date-tag overdue">still clocked in</span>}
                  {e.edited_at && <span className="subtext"> · edited{e.note ? `: ${e.note}` : ""}</span>}{" "}
                  <Link href={`/time/${e.id}`}>Edit</Link>
                </li>
              ))}
            </ul>
          )}
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
                  <th key={h} className={i > 1 || (i === 1 && head.length === 3) ? "num" : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i} className={i > 1 || (i === 1 && head.length === 3) ? "num" : undefined}>
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
