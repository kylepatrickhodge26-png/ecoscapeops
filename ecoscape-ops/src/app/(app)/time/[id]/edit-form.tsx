"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { EditTimeState } from "../actions";

// Start, end and a required note: for a time entry or a workday.
export function EditTimeForm({
  action,
  initial,
}: {
  action: (state: EditTimeState, formData: FormData) => Promise<EditTimeState>;
  initial: EditTimeState["values"];
}) {
  const [state, formAction, pending] = useActionState(action, { values: initial } as EditTimeState);
  return (
    <form key={JSON.stringify(state.values)} action={formAction} noValidate className="customer-form">
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <div className="row2">
        <div className="field">
          <label htmlFor="started">Started</label>
          <input id="started" name="started" type="datetime-local" defaultValue={state.values.started} />
        </div>
        <div className="field">
          <label htmlFor="ended">Ended</label>
          <input id="ended" name="ended" type="datetime-local" defaultValue={state.values.ended} />
          <div className="hint">Leave empty if they&apos;re still clocked in.</div>
        </div>
      </div>
      <div className="field">
        <label htmlFor="note">Why are you changing this?</label>
        <input id="note" name="note" defaultValue={state.values.note} maxLength={500} placeholder="e.g. Forgot to clock out" />
      </div>
      <div className="form-actions">
        <Link className="btn secondary" href="/time">
          Cancel
        </Link>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
