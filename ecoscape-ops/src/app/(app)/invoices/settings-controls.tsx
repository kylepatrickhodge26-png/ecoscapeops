"use client";

import { useState, useTransition } from "react";

export function AutoInvoiceToggle({ enabled, save }: { enabled: boolean; save: (enabled: boolean) => Promise<{ error?: string }> }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="auto-invoice">
      <label className="checkbox">
        <input
          type="checkbox"
          defaultChecked={enabled}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            startTransition(async () => setError((await save(next)).error ?? null));
          }}
        />
        Auto-create a draft invoice when a visit is marked completed
      </label>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ConnectStripeButton({ label, connect }: { label: string; connect: () => Promise<{ error?: string }> }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="btn small"
        disabled={pending}
        onClick={() => startTransition(async () => setError((await connect()).error ?? null))}
      >
        {pending ? "Opening Stripe…" : label}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
