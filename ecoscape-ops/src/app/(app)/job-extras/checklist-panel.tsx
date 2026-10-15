"use client";

import { useState, useTransition } from "react";

import { formatShortDate } from "@/lib/dates";

import { toggleChecklistItem } from "./actions";

export type ChecklistItem = { id: string; label: string; done: boolean; done_at: string | null; done_by_name: string };

// A job's checklist: tick items off as they're done. Each tick remembers who and when.
export function ChecklistPanel({ items }: { items: ChecklistItem[] }) {
  const [state, setState] = useState(() => Object.fromEntries(items.map((i) => [i.id, i.done])));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const doneCount = items.filter((i) => state[i.id]).length;

  function toggle(item: ChecklistItem, done: boolean) {
    setState((s) => ({ ...s, [item.id]: done }));
    setError(null);
    startTransition(async () => {
      const result = await toggleChecklistItem(item.id, done);
      if (result.error) {
        setState((s) => ({ ...s, [item.id]: !done }));
        setError(result.error);
      }
    });
  }

  return (
    <div className="checklist" data-testid="job-checklist">
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <label>
              <input type="checkbox" checked={Boolean(state[item.id])} disabled={pending} onChange={(e) => toggle(item, e.target.checked)} />
              <span className={state[item.id] ? "done" : undefined}>{item.label}</span>
            </label>
            {item.done && item.done_by_name && state[item.id] && (
              <span className="subtext">
                {" "}
                {item.done_by_name}
                {item.done_at ? `, ${formatShortDate(item.done_at.slice(0, 10))}` : ""}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="hint" aria-live="polite">
        {doneCount} of {items.length} done
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
