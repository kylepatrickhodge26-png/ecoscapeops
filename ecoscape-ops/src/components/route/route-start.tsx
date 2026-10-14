"use client";

import { useActionState, useState } from "react";

import { setRouteStart, type RouteStartState } from "@/app/(app)/routes/actions";

import { RouteFields, type RouteRef } from "./route-fields";

// "Starting from …", with a box to start somewhere else on this day only.
export function RouteStartForm({ route, label }: { route: RouteRef; label: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<RouteStartState, FormData>(
    async (prev, formData) => {
      const next = await setRouteStart(prev, formData);
      if (next.saved) setOpen(false);
      return next;
    },
    { values: { address: "" } },
  );

  if (!open) {
    return (
      <button type="button" className="linklike" onClick={() => setOpen(true)} aria-label={`Start ${label} somewhere else this day`}>
        Start somewhere else this day
      </button>
    );
  }
  return (
    <form action={formAction} noValidate className="route-start-form">
      <RouteFields route={route} />
      <label htmlFor={`route-start-${route.crewMemberId ?? "unassigned"}`} className="visually-hidden">
        Starting address for {label} this day
      </label>
      <input
        id={`route-start-${route.crewMemberId ?? "unassigned"}`}
        name="address"
        defaultValue={state.values.address}
        maxLength={300}
        placeholder="e.g. 8 Home Rd"
        autoFocus
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? `route-start-error-${route.crewMemberId ?? "unassigned"}` : undefined}
      />
      <button className="btn small" type="submit" disabled={pending}>
        {pending ? "Finding it…" : "Start here this day"}
      </button>
      <button type="button" className="btn secondary small" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {state.error && (
        <div id={`route-start-error-${route.crewMemberId ?? "unassigned"}`} className="field-error" role="alert">
          {state.error}
        </div>
      )}
    </form>
  );
}
