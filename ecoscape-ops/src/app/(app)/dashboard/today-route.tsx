import Link from "next/link";

import { StatusPill } from "@/components/job-status";
import { directionsLink } from "@/lib/maps";
import { isClosed, type JobStatus } from "@/lib/schedule/constants";

import { JobClock } from "../time-clock/job-clock";
import type { MyClock } from "../time-clock/clock-state";

// One stop on someone's route today, from either the crew view (crew_route) or the owner's.
export type TodayStop = {
  id: string;
  status: JobStatus;
  service: string;
  customerName: string;
  phone: string;
  address: string;
  access: string;
  customerNotes: string;
  // Where to see everything about the visit (checklist, photos, notes).
  href: string;
};

// Today, made for a thumb: the visit you're on (or the next one) as a big card with one big
// button, then the rest of the day in order, each with its own Clock in, then what's done.
export function TodayRoute({ stops, clock, emptyText }: { stops: TodayStop[]; clock: MyClock; emptyText: string }) {
  if (stops.length === 0) {
    return (
      <div className="panel" data-testid="today-route">
        <div className="empty">
          <div className="big">Nothing on your route today</div>
          {emptyText}
        </div>
      </div>
    );
  }

  const open = stops.filter((s) => !isClosed(s.status));
  const done = stops.filter((s) => isClosed(s.status));
  const current = stops.find((s) => s.id === clock.jobId) ?? null;
  const focus = current ?? open[0] ?? null;
  const later = open.filter((s) => s !== focus);
  const position = (s: TodayStop) => stops.indexOf(s) + 1;

  return (
    <div className="today-route" data-testid="today-route">
      {focus ? (
        <section className={`now-card${current ? " on" : ""}`} aria-label={current ? "Now" : "Next up"} data-today-stop={focus.id}>
          <div className="now-label">
            {current ? "Now" : "Next up"} · Stop {position(focus)} of {stops.length}
          </div>
          <h2 className="now-customer">{focus.customerName}</h2>
          {focus.address && (
            <a className="now-address" href={directionsLink(focus.address)} target="_blank" rel="noopener noreferrer">
              {focus.address} <span className="now-directions">Directions ›</span>
            </a>
          )}
          <div className="now-service">
            {focus.service}
            {focus.phone && (
              <>
                {" · "}
                <a href={`tel:${focus.phone.replace(/[^\d+]/g, "")}`}>Call</a>
              </>
            )}
          </div>
          {focus.access && <div className="notice compact">Access: {focus.access}</div>}
          {focus.customerNotes && <div className="notice compact pre-line">Notes: {focus.customerNotes}</div>}
          <JobClock jobId={focus.id} status={focus.status} big />
          <Link className="now-more" href={focus.href}>
            Checklist, photos &amp; notes ›
          </Link>
        </section>
      ) : (
        <section className="now-card done" aria-label="All done">
          <h2 className="now-customer">All done for today</h2>
          <p className="hint">Nice work. End your day above when you head home.</p>
        </section>
      )}

      {later.length > 0 && (
        <section aria-label="Later today">
          <h3 className="today-heading">Later today</h3>
          <ol className="today-list">
            {later.map((s) => (
              <li key={s.id} data-today-stop={s.id}>
                <span className="today-number">{position(s)}</span>
                <Link className="today-main" href={s.href}>
                  <b>{s.customerName}</b>
                  <span className="subtext">
                    {s.service}
                    {s.address && ` · ${s.address}`}
                  </span>
                </Link>
                <div className="today-action">
                  {s.status === "scheduled" || s.status === "assigned" ? null : <StatusPill status={s.status} />}
                  <JobClock jobId={s.id} status={s.status} compact />
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {done.length > 0 && (
        <details className="today-done">
          <summary>Done today ({done.length})</summary>
          <ol className="today-list">
            {done.map((s) => (
              <li key={s.id} data-today-stop={s.id}>
                <span className="today-number">{position(s)}</span>
                <Link className="today-main" href={s.href}>
                  <b>{s.customerName}</b>
                  <span className="subtext">{s.service}</span>
                </Link>
                <StatusPill status={s.status} />
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
