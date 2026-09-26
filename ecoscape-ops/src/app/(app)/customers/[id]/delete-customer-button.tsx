"use client";

import { useActionState, useState } from "react";

import type { DeleteCustomerState } from "../actions";

type Props = {
  action: (state: DeleteCustomerState) => Promise<DeleteCustomerState>;
  customerName: string;
};

export function DeleteCustomerButton({ action, customerName }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});

  if (!confirming) {
    return (
      <button type="button" className="btn danger small" onClick={() => setConfirming(true)}>
        Delete
      </button>
    );
  }

  return (
    <div className="confirm-delete" role="alertdialog" aria-labelledby="confirm-delete-text">
      <p id="confirm-delete-text">
        Delete <b>{customerName}</b>? This can&apos;t be undone.
      </p>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
      <form action={formAction} className="confirm-delete-actions">
        <button type="button" className="btn secondary small" onClick={() => setConfirming(false)} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="btn danger small" disabled={pending}>
          {pending ? "Deleting…" : "Yes, delete"}
        </button>
      </form>
    </div>
  );
}
