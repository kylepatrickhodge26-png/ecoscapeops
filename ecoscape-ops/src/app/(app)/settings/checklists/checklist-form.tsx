"use client";

import Link from "next/link";
import { useActionState } from "react";

import { MAX_CHECKLIST_ITEMS } from "@/lib/photos/checklist";

import { saveChecklist, type ChecklistFormState } from "./actions";

export function ChecklistForm({ initial, serviceNames }: { initial: ChecklistFormState["values"]; serviceNames: string[] }) {
  const [state, formAction, pending] = useActionState(saveChecklist, { values: initial });
  return (
    <form key={JSON.stringify(state.values)} action={formAction} noValidate className="customer-form">
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="service_name">Service</label>
        <input id="service_name" name="service_name" list="service-names" defaultValue={state.values.service_name} maxLength={100} placeholder="e.g. Mowing" />
        <datalist id="service-names">
          {serviceNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <div className="hint">It must match the service&apos;s name exactly (capital letters don&apos;t matter).</div>
      </div>
      <div className="field">
        <label htmlFor="items">Checklist (one item per line)</label>
        <textarea id="items" name="items" rows={8} defaultValue={state.values.items} placeholder={"Mow\nEdge\nBlow driveway\nBag clippings"} />
        <div className="hint">Up to {MAX_CHECKLIST_ITEMS} items. Leave it empty to remove this service&apos;s checklist.</div>
      </div>
      <div className="form-actions">
        <Link className="btn secondary" href="/settings/checklists">
          Clear
        </Link>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save checklist"}
        </button>
      </div>
    </form>
  );
}
