"use client";

import { useActionState } from "react";

import { AssignToField } from "@/components/assign-to-field";
import type { AssigneeOption } from "@/lib/crew";
import { FREQUENCIES, FREQUENCY_LABELS } from "@/lib/schedule/constants";
import type { AcceptField } from "@/lib/quotes/schema";

import type { AcceptState, AcceptValues } from "../actions";

// "They said yes": names the service, picks how often and the first visit, and books it at
// the quote's total. A prospect becomes a customer.
export function AcceptForm({
  action,
  initialValues,
  assignees,
  today,
  isProspect,
}: {
  action: (state: AcceptState, formData: FormData) => Promise<AcceptState>;
  initialValues: AcceptValues;
  assignees?: AssigneeOption[];
  today: string;
  isProspect: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { values: initialValues });
  const errors = state.fieldErrors ?? {};
  const field = (name: AcceptField) => ({
    id: `accept-${name}`,
    name,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `accept-${name}-error` : undefined,
  });
  const err = (name: AcceptField) =>
    errors[name] ? (
      <div id={`accept-${name}-error`} className="field-error">
        {errors[name]}
      </div>
    ) : null;

  return (
    <form key={JSON.stringify(state.values)} action={formAction} noValidate className="accept-form customer-form">
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <div className="row2">
        <div className="field">
          <label htmlFor="accept-service_name">Service name</label>
          <input {...field("service_name")} defaultValue={state.values.service_name} maxLength={100} />
          {err("service_name")}
        </div>
        <div className="field">
          <label htmlFor="accept-frequency">How often</label>
          <select {...field("frequency")} defaultValue={state.values.frequency}>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </option>
            ))}
          </select>
          {err("frequency")}
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="accept-first_visit">First visit</label>
          <input {...field("first_visit")} type="date" min={today} defaultValue={state.values.first_visit} />
          {err("first_visit")}
        </div>
        {assignees && <AssignToField assignees={assignees} defaultValue={state.values.assigned_crew_member_id} error={errors.assigned_crew_member_id} />}
      </div>
      {isProspect && <p className="hint">This prospect will be added to your customers.</p>}
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Booking…" : "Accept & book it"}
        </button>
      </div>
    </form>
  );
}
