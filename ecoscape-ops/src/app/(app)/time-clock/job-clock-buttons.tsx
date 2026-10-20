"use client";

import { useState, useTransition } from "react";

import { LiveTimer } from "./live-timer";

type Action = () => Promise<{ error?: string }>;

// The one or two buttons a visit needs: Clock in, or (once clocked in) Clock out & finish, with
// a smaller "not finished" for a visit to come back to.
export function JobClockButtons({
  state,
  since,
  sinceText,
  elsewhere,
  big = false,
  start,
  finish,
  leave,
}: {
  state: "ready" | "here" | "elsewhere";
  since: string | null;
  sinceText: string | null;
  elsewhere: string | null;
  big?: boolean;
  start: Action;
  finish: Action;
  leave: Action;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: Action) => startTransition(async () => setError((await action()).error ?? null));
  const size = big ? " big" : "";

  return (
    <div className={`job-clock${big ? " big" : ""}`} data-testid="job-clock">
      {state === "ready" && (
        <button type="button" className={`btn clock-in${size}`} disabled={pending} onClick={() => run(start)}>
          {pending ? "Clocking in…" : "Clock in"}
        </button>
      )}
      {state === "here" && (
        <>
          <div className="clock-status" role="status">
            <span className="clock-dot" aria-hidden="true" /> Clocked in{sinceText ? ` at ${sinceText}` : ""} ·{" "}
            {since && <LiveTimer since={since} className="clock-elapsed" />}
          </div>
          <div className="clock-actions">
            <button type="button" className={`btn clock-out${size}`} disabled={pending} onClick={() => run(finish)}>
              {pending ? "Saving…" : "Clock out & finish"}
            </button>
            <button type="button" className="btn secondary" disabled={pending} onClick={() => run(leave)}>
              Clock out, not finished
            </button>
          </div>
        </>
      )}
      {state === "elsewhere" && <p className="hint">You&apos;re clocked in at {elsewhere}. Clock out there first.</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
