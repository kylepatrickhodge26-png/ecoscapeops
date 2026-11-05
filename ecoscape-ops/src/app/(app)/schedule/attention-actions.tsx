"use client";

import { useActionState, useEffect, useState } from "react";

import { closeVisits, type CloseVisitsState } from "./actions";

// Needs attention: tick old visits in the list (their checkboxes belong to this form), then
// mark them all done or cancel them, so overdue visits don't pile up.
export function AttentionActions() {
  const [ticked, setTicked] = useState(0);
  const [state, formAction, pending] = useActionState<CloseVisitsState, FormData>(closeVisits, {});

  useEffect(() => {
    const count = () => setTicked(document.querySelectorAll('input[form="attention-selected"]:checked').length);
    document.addEventListener("change", count);
    count();
    return () => document.removeEventListener("change", count);
  }, []);

  const what = `${ticked} ${ticked === 1 ? "visit" : "visits"}`;
  return (
    <form action={formAction} id="attention-selected" className="panel attention-actions" aria-label="Clear old visits">
      <div className="panel-body">
        <p className="hint">
          {ticked === 0
            ? "Tick visits below to clear them: mark the ones you did as done, cancel the ones that didn't happen."
            : `${what} ticked.`}
        </p>
        {state.error && (
          <p className="field-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" name="how" value="cancelled" className="btn secondary" disabled={pending || ticked === 0}>
            Cancel {ticked > 0 ? what : "visits"}
          </button>
          <button type="submit" name="how" value="completed" className="btn" disabled={pending || ticked === 0}>
            {pending ? "Saving…" : `Mark ${ticked > 0 ? what : "visits"} done`}
          </button>
        </div>
      </div>
    </form>
  );
}
