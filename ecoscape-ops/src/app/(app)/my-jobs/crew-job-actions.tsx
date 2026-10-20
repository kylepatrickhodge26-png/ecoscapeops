"use client";

import { useActionState, useState } from "react";

import type { NoteState } from "./actions";

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
