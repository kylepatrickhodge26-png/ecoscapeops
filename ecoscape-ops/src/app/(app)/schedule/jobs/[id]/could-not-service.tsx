"use client";

import { useActionState, useState } from "react";

import type { CouldNotServiceValues } from "@/lib/schedule/schema";

import type { CouldNotServiceState } from "../../actions";

type Props = {
  action: (state: CouldNotServiceState, formData: FormData) => Promise<CouldNotServiceState>;
  defaultNewDate: string;
  today: string;
};

// "Could not service" isn't a final answer: the visit either goes to a new day or is
// called off, so ask which right away.
export function CouldNotService({ action, defaultNewDate, today }: Props) {
  const initial: CouldNotServiceValues = { choice: "", new_date: defaultNewDate, reason: "" };
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, { values: initial });
  const errors = state.fieldErrors ?? {};

  if (!open) {
    return (
      <button type="button" className="btn secondary small" onClick={() => setOpen(true)}>
        Could not service
      </button>
    );
  }

  return (
    <form
      key={JSON.stringify(state.values)}
      action={formAction}
      noValidate
      className="confirm-box could-not-service"
      aria-label="Could not service"
    >
      <p>
        <b>Couldn&apos;t service this visit?</b> Reschedule it or cancel it.
      </p>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
      {errors.choice && (
        <p className="field-error" role="alert">
          {errors.choice}
        </p>
      )}
      <div className="field">
        <label htmlFor="cns-reason">What happened? (optional)</label>
        <input
          id="cns-reason"
          name="reason"
          defaultValue={state.values.reason}
          placeholder="e.g. Gate locked"
          maxLength={300}
          aria-invalid={errors.reason ? true : undefined}
        />
        {errors.reason && <div className="field-error">{errors.reason}</div>}
      </div>
      <div className="field">
        <label htmlFor="cns-date">New date</label>
        <input
          id="cns-date"
          name="new_date"
          type="date"
          min={today}
          defaultValue={state.values.new_date}
          aria-invalid={errors.new_date ? true : undefined}
          aria-describedby={errors.new_date ? "cns-date-error" : undefined}
        />
        {errors.new_date && (
          <div id="cns-date-error" className="field-error">
            {errors.new_date}
          </div>
        )}
      </div>
      <div className="confirm-box-actions">
        <button type="button" className="btn secondary small" onClick={() => setOpen(false)} disabled={pending}>
          Not now
        </button>
        <button type="submit" name="choice" value="cancel" className="btn danger small" disabled={pending}>
          Cancel visit
        </button>
        <button type="submit" name="choice" value="reschedule" className="btn small" disabled={pending}>
          Reschedule
        </button>
      </div>
    </form>
  );
}
