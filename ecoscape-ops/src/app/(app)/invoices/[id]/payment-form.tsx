"use client";

import { useActionState } from "react";

import { MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/invoices/constants";

import type { PaymentFormState, PaymentFormValues } from "../actions";

type Field = "amount" | "method" | "received_on" | "note";

// Records a cash, check or other payment. request_id (fresh for each page load) makes a
// repeated submission record the payment once.
export function PaymentForm({
  action,
  initialValues,
  today,
}: {
  action: (state: PaymentFormState, formData: FormData) => Promise<PaymentFormState>;
  initialValues: PaymentFormValues;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, { values: initialValues });
  const errors = state.fieldErrors ?? {};
  const firstInvalid = Object.keys(errors)[0];
  const field = (name: Field) => ({
    id: `payment-${name}`,
    name,
    autoFocus: name === firstInvalid,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `payment-${name}-error` : undefined,
  });
  const error = (name: Field) =>
    errors[name] ? (
      <div id={`payment-${name}-error`} className="field-error">
        {errors[name]}
      </div>
    ) : null;

  return (
    <form key={JSON.stringify(state.values)} action={formAction} noValidate className="payment-form">
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <input type="hidden" name="request_id" value={state.values.request_id} />
      <div className="row3">
        <div className="field">
          <label htmlFor="payment-amount">Amount ($)</label>
          <input {...field("amount")} defaultValue={state.values.amount} inputMode="decimal" />
          {error("amount")}
        </div>
        <div className="field">
          <label htmlFor="payment-method">How it was paid</label>
          <select {...field("method")} defaultValue={state.values.method}>
            {MANUAL_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
          {error("method")}
        </div>
        <div className="field">
          <label htmlFor="payment-received_on">Date received</label>
          <input {...field("received_on")} type="date" max={today} defaultValue={state.values.received_on} />
          {error("received_on")}
        </div>
      </div>
      <div className="field">
        <label htmlFor="payment-note">Note</label>
        <input {...field("note")} defaultValue={state.values.note} maxLength={200} placeholder="e.g. Check #1042" />
        {error("note")}
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Recording…" : "Record payment"}
        </button>
      </div>
    </form>
  );
}
