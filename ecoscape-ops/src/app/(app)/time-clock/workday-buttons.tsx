"use client";

import { useState, useTransition } from "react";

import { LiveTimer } from "./live-timer";

type Action = () => Promise<{ error?: string }>;

// Start / end the workday. Ending asks once, so a stray tap can't end someone's day.
export function WorkdayButtons({ since, sinceText, onJob, start, end }: { since: string | null; sinceText: string | null; onJob: boolean; start: Action; end: Action }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (action: Action) =>
    startTransition(async () => {
      const result = await action();
      setError(result.error ?? null);
      if (!result.error) setConfirming(false);
    });

  if (!since) {
    return (
      <div className="workday" data-testid="workday">
        <button type="button" className="btn big block" disabled={pending} onClick={() => run(start)}>
          {pending ? "Starting…" : "Start my day"}
        </button>
        <p className="hint">Clocking in to a job starts your day too.</p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="workday on" data-testid="workday">
      <div className="workday-status" role="status">
        <span className="clock-dot" aria-hidden="true" />
        <span>
          On the clock since <b>{sinceText}</b> · <LiveTimer since={since} className="clock-elapsed" />
        </span>
      </div>
      {!confirming ? (
        <button type="button" className="btn secondary" disabled={pending} onClick={() => setConfirming(true)}>
          End my day
        </button>
      ) : (
        <div className="confirm-box" role="alertdialog" aria-label="End my day">
          <p>{onJob ? "End your day? You'll be clocked out of your job too (it stays open)." : "End your day?"}</p>
          <div className="confirm-box-actions">
            <button type="button" className="btn secondary small" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="btn small" disabled={pending} onClick={() => run(end)}>
              {pending ? "Ending…" : "Yes, end my day"}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
