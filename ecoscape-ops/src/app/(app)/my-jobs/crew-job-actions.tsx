"use client";

import { useActionState, useState } from "react";

import type { CrewActionState, NoteState } from "./actions";

export function CrewStatusButton({
  action,
  label,
  pendingLabel,
  primary = true,
}: {
  action: (state: CrewActionState) => Promise<CrewActionState>;
  label: string;
  pendingLabel: string;
  primary?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction}>
      <button type="submit" className={`btn small${primary ? "" : " secondary"}`} disabled={pending}>
        {pending ? pendingLabel : label}
      </button>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function AddNote({ action }: { action: (state: NoteState, formData: FormData) => Promise<NoteState> }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  if (!open) {
    return (
      <button type="button" className="btn secondary small" onClick={() => setOpen(true)}>
        Add note
      </button>
    );
  }
  return (
    <form action={formAction} className="confirm-box add-note" aria-label="Add a note">
      <div className="field">
        <label htmlFor="note">Note</label>
        <textarea id="note" name="note" maxLength={500} defaultValue={state.value} autoFocus />
        {state.error && <div className="field-error">{state.error}</div>}
      </div>
      <div className="confirm-box-actions">
        <button type="button" className="btn secondary small" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="btn small" disabled={pending}>
          {pending ? "Saving…" : "Save note"}
        </button>
      </div>
    </form>
  );
}
