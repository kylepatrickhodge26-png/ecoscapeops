"use client";

import Link from "next/link";
import { useActionState } from "react";

import { JOB_STATUSES, JOB_STATUS_LABELS } from "@/lib/schedule/constants";
import type { JobField, JobFormValues } from "@/lib/schedule/schema";

import type { JobFormState } from "../../../actions";

type Props = {
  action: (state: JobFormState, formData: FormData) => Promise<JobFormState>;
  initialValues: JobFormValues;
  cancelHref: string;
};

export function JobForm({ action, initialValues, cancelHref }: Props) {
  const [state, formAction, pending] = useActionState(action, { values: initialValues });
  const values = state.values;
  const errors = state.fieldErrors ?? {};
  const firstInvalid = Object.keys(errors)[0];

  const field = (name: JobField) => ({
    id: name,
    name,
    autoFocus: name === firstInvalid,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });
  const error = (name: JobField) =>
    errors[name] ? (
      <div id={`${name}-error`} className="field-error">
        {errors[name]}
      </div>
    ) : null;

  return (
    // Remount after each submit so every field shows what was submitted (see CustomerForm).
    <form key={JSON.stringify(values)} action={formAction} noValidate className="panel panel-body customer-form">
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      {Object.keys(errors).length > 0 && (
        <div className="notice error" role="alert">
          Please fix the highlighted fields.
        </div>
      )}
      <div className="row2">
        <div className="field">
          <label htmlFor="service_name">Service</label>
          <input {...field("service_name")} defaultValue={values.service_name} maxLength={100} />
          {error("service_name")}
        </div>
        <div className="field">
          <label htmlFor="price">Price ($)</label>
          <input {...field("price")} defaultValue={values.price} inputMode="decimal" />
          {error("price")}
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="scheduled_date">Date</label>
          <input {...field("scheduled_date")} type="date" defaultValue={values.scheduled_date} />
          {error("scheduled_date")}
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select {...field("status")} defaultValue={values.status}>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {JOB_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {error("status")}
        </div>
      </div>
      <div className="field">
        <label htmlFor="notes">Notes</label>
        <textarea {...field("notes")} defaultValue={values.notes} maxLength={4000} />
        {error("notes")}
      </div>
      <div className="notice">
        Changes apply to this visit only. Completing or cancelling a recurring visit adds the next one automatically.
      </div>
      <div className="form-actions">
        <Link className="btn secondary" href={cancelHref}>
          Cancel
        </Link>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
