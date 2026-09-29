"use client";

import { useActionState } from "react";

import type { DueDateState } from "../actions";

export function DueDateForm({
  action,
  current,
  min,
}: {
  action: (state: DueDateState, formData: FormData) => Promise<DueDateState>;
  current: string;
  min: string;
}) {
  const [state, formAction, pending] = useActionState(action, { value: current });
  return (
    <form action={formAction} className="inline-form due-date-form">
      <div className="field">
        <label htmlFor="due_date">Due date</label>
        <input id="due_date" name="due_date" type="date" min={min} defaultValue={state.value} />
      </div>
      <button className="btn secondary small" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change due date"}
      </button>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
      {state.saved && !state.error && <p className="hint">Due date changed.</p>}
    </form>
  );
}
