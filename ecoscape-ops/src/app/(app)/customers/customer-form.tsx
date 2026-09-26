"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import {
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_LABELS,
  NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_LABELS,
  PREFERRED_DAYS,
  PREFERRED_DAY_LABELS,
  type CustomerField,
  type CustomerFormValues,
} from "@/lib/customers/schema";

import type { CustomerFormState } from "./actions";

type Props = {
  action: (state: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  initialValues: CustomerFormValues;
  submitLabel: string;
  cancelHref: string;
};

export function CustomerForm({ action, initialValues, submitLabel, cancelHref }: Props) {
  const [state, formAction, pending] = useActionState(action, { values: initialValues });
  const values = state.values;
  const errors = state.fieldErrors ?? {};
  const firstInvalid = Object.keys(errors)[0];

  // React resets a form after its action runs, and a <select> doesn't pick up a changed
  // defaultValue, so after an error it would snap back to its original option.
  // Remounting the form whenever the submitted values change keeps every input showing
  // exactly what was submitted.
  const formKey = JSON.stringify(values);

  // For a new customer, default "Customer since" to today in the owner's own time zone,
  // which only the browser knows (the server would use UTC and could be a day ahead).
  const sinceRef = useRef<HTMLInputElement>(null);
  const defaultSinceToToday = initialValues.customer_since === "";
  useEffect(() => {
    const input = sinceRef.current;
    if (defaultSinceToToday && input && !input.value) input.value = new Date().toLocaleDateString("en-CA");
  }, [defaultSinceToToday, formKey]);

  // Props shared by every input: id/name and error wiring.
  const field = (name: CustomerField) => ({
    id: name,
    name,
    autoFocus: name === firstInvalid,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });
  const error = (name: CustomerField) =>
    errors[name] ? (
      <div id={`${name}-error`} className="field-error">
        {errors[name]}
      </div>
    ) : null;

  return (
    <form key={formKey} action={formAction} noValidate className="panel panel-body customer-form">
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
      {state.duplicate && (
        <div className="notice warn" role="alert">
          <b>{state.duplicate.name}</b> already has this phone number on file — could this be the same customer?
          <div className="notice-actions">
            <Link className="btn secondary small" href={`/customers/${state.duplicate.id}`}>
              View {state.duplicate.name}
            </Link>
            <button className="btn small" type="submit" name="confirm_duplicate" value="1" disabled={pending}>
              Add anyway
            </button>
          </div>
        </div>
      )}

      <div className="row2">
        <div className="field">
          <label htmlFor="first_name">First name</label>
          <input {...field("first_name")} defaultValue={values.first_name} autoComplete="off" maxLength={100} />
          {error("first_name")}
        </div>
        <div className="field">
          <label htmlFor="last_name">Last name</label>
          <input {...field("last_name")} defaultValue={values.last_name} autoComplete="off" maxLength={100} />
          {error("last_name")}
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="phone">Phone</label>
          <input {...field("phone")} type="tel" defaultValue={values.phone} autoComplete="off" maxLength={40} />
          {error("phone")}
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input {...field("email")} type="email" defaultValue={values.email} autoComplete="off" maxLength={254} />
          {error("email")}
        </div>
      </div>
      <div className="field">
        <label htmlFor="property_address">Property address</label>
        <input {...field("property_address")} defaultValue={values.property_address} autoComplete="off" maxLength={300} />
        {error("property_address")}
      </div>
      <div className="field">
        <label htmlFor="billing_address">Billing address</label>
        <input
          {...field("billing_address")}
          defaultValue={values.billing_address}
          placeholder="Same as property"
          autoComplete="off"
          maxLength={300}
        />
        {error("billing_address")}
      </div>
      <div className="field">
        <label htmlFor="access_instructions">Gate / access instructions</label>
        <input
          {...field("access_instructions")}
          defaultValue={values.access_instructions}
          autoComplete="off"
          maxLength={1000}
        />
        {error("access_instructions")}
      </div>
      <div className="field">
        <label htmlFor="service_notes">Service notes</label>
        <textarea {...field("service_notes")} defaultValue={values.service_notes} maxLength={2000} />
        {error("service_notes")}
      </div>
      <div className="row3">
        <div className="field">
          <label htmlFor="preferred_day">Preferred day</label>
          <select {...field("preferred_day")} defaultValue={values.preferred_day}>
            {PREFERRED_DAYS.map((day) => (
              <option key={day} value={day}>
                {PREFERRED_DAY_LABELS[day]}
              </option>
            ))}
          </select>
          {error("preferred_day")}
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select {...field("status")} defaultValue={values.status}>
            {CUSTOMER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CUSTOMER_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          {error("status")}
        </div>
        <div className="field">
          <label htmlFor="notification_preference">Notification preference</label>
          <select {...field("notification_preference")} defaultValue={values.notification_preference}>
            {NOTIFICATION_PREFERENCES.map((pref) => (
              <option key={pref} value={pref}>
                {NOTIFICATION_PREFERENCE_LABELS[pref]}
              </option>
            ))}
          </select>
          {error("notification_preference")}
        </div>
      </div>
      <div className="row3">
        <div className="field">
          <label htmlFor="customer_since">Customer since</label>
          <input {...field("customer_since")} ref={sinceRef} type="date" defaultValue={values.customer_since} />
          {error("customer_since")}
        </div>
      </div>
      <div className="field checkbox">
        <label>
          <input type="checkbox" name="sms_opt_in" defaultChecked={values.sms_opt_in} />
          Customer has opted in to SMS
        </label>
      </div>

      <div className="form-actions">
        <Link className="btn secondary" href={cancelHref}>
          Cancel
        </Link>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
