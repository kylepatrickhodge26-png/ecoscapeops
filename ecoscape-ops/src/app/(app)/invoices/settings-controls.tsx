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
