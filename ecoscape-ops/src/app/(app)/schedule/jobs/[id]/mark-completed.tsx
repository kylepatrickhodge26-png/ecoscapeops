"use client";

import { useActionState } from "react";

import type { ActionResult } from "../../actions";

export function MarkCompleted({ action }: { action: (state: ActionResult) => Promise<ActionResult> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction}>
      <button type="submit" className="btn small" disabled={pending}>
        {pending ? "Saving…" : "Mark completed"}
      </button>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
