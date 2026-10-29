"use client";

import { useActionState } from "react";

// A one-tap button that runs a server action, showing a message if it fails.
export function ActionButton({
  action,
  label,
  pendingLabel,
  className = "btn small",
}: {
  action: (state: { error?: string }) => Promise<{ error?: string }>;
  label: string;
  pendingLabel: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="action-button">
      <button type="submit" className={className} disabled={pending}>
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
