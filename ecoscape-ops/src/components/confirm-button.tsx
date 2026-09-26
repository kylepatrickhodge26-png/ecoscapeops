"use client";

import { useActionState, useState } from "react";

type Props = {
  action: (state: { error?: string }) => Promise<{ error?: string }>;
  label: string;
  confirmText: React.ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  danger?: boolean;
};

// A button that asks "are you sure?" inline before running a server action.
export function ConfirmButton({ action, label, confirmText, confirmLabel, pendingLabel, danger = true }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  const tone = danger ? "danger" : "";

  if (!confirming) {
    return (
      <button type="button" className={`btn small ${danger ? "danger" : "secondary"}`} onClick={() => setConfirming(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className={`confirm-box ${tone}`} role="alertdialog" aria-label={label}>
      <p>{confirmText}</p>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
      <form action={formAction} className="confirm-box-actions">
        <button type="button" className="btn secondary small" onClick={() => setConfirming(false)} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className={`btn small ${danger ? "danger" : ""}`} disabled={pending}>
          {pending ? pendingLabel : confirmLabel}
        </button>
      </form>
    </div>
  );
}
