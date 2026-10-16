"use client";

import { useState, useTransition } from "react";

export function BillMonthlyToggle({ enabled, save }: { enabled: boolean; save: (enabled: boolean) => Promise<{ error?: string }> }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="auto-invoice">
      <label className="checkbox">
        <input
          type="checkbox"
          name="bill_monthly"
          defaultChecked={enabled}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            startTransition(async () => setError((await save(next)).error ?? null));
          }}
        />
        Bill monthly
      </label>
      <p className="hint">One invoice a month covers all this customer&apos;s completed visits. Make them from the Invoices page.</p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
