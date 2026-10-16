"use client";

import { useState, useTransition } from "react";

type Action = () => Promise<{ error?: string }>;

export function ClockButton({ clockedInSince, clockIn, clockOut, otherJob }: { clockedInSince: string | null; clockIn: Action; clockOut: Action; otherJob?: string | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: Action) => startTransition(async () => setError((await action()).error ?? null));

  return (
    <div className="time-clock" data-testid="time-clock">
      {clockedInSince ? (
        <>
          <span className="subtext">Clocked in since {clockedInSince}</span>
          <button type="button" className="btn small danger" disabled={pending} onClick={() => run(clockOut)}>
            {pending ? "Saving…" : "Clock out"}
          </button>
        </>
      ) : (
        <>
          {otherJob && <span className="subtext">Clocked in to {otherJob}</span>}
          <button type="button" className="btn small secondary" disabled={pending || Boolean(otherJob)} onClick={() => run(clockIn)}>
            {pending ? "Saving…" : "Clock in"}
          </button>
        </>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
