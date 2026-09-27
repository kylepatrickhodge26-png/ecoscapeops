"use client";

import { useActionState, useState } from "react";

import type { QuickLogState } from "../expenses/actions";

// One-tap expense logging from the dashboard: today's date, an amount, optionally where.
export function QuickLog({
  action,
  label,
  vendorPlaceholder,
}: {
  action: (state: QuickLogState, formData: FormData) => Promise<QuickLogState>;
  label: string;
  vendorPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});

  if (!open) {
    return (
      <button type="button" className="btn secondary small" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <form action={formAction} className="confirm-box quick-log" aria-label={label}>
      <p>
        <b>{label}</b> — today
      </p>
      <div className="quick-log-fields">
        <div className="field">
          <label htmlFor={`${label}-amount`}>Amount ($)</label>
          <input
            id={`${label}-amount`}
            name="amount"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={state.amount}
            autoFocus
            aria-invalid={state.error ? true : undefined}
          />
        </div>
        <div className="field">
          <label htmlFor={`${label}-vendor`}>Where (optional)</label>
          <input id={`${label}-vendor`} name="vendor" maxLength={120} placeholder={vendorPlaceholder} defaultValue={state.vendor} />
        </div>
      </div>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="confirm-box-actions">
        <button type="button" className="btn secondary small" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="btn small" disabled={pending}>
          {pending ? "Saving…" : "Log it"}
        </button>
      </div>
    </form>
  );
}
