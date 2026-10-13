"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { PaymentOptionField } from "@/lib/invoices/payment-options";

import { savePaymentOptions, type PaymentOptionsFormState, type PaymentOptionsFormValues } from "../actions";

const FIELDS: { name: PaymentOptionField; label: string; placeholder: string; hint: string; inputMode?: "email" | "url" }[] = [
  { name: "venmo", label: "Venmo username", placeholder: "@Green-Acres-Lawn", hint: "Opens Venmo with the amount filled in." },
  { name: "cash_app", label: "Cash App $cashtag", placeholder: "$GreenAcresLawn", hint: "Opens Cash App with the amount filled in." },
  { name: "paypal", label: "PayPal.Me name", placeholder: "GreenAcresLawn", hint: "The part after paypal.me/. Opens PayPal with the amount filled in." },
  {
    name: "zelle",
    label: "Zelle email or phone",
    placeholder: "pay@greenacreslawn.com",
    hint: "Customers send the amount to this from their bank's app.",
    inputMode: "email",
  },
  {
    name: "pay_link",
    label: "Other payment link",
    placeholder: "https://square.link/u/…",
    hint: "Any other way to pay online, like a Square or Stripe payment link you made yourself.",
    inputMode: "url",
  },
];

export function PaymentOptionsForm({ initialValues }: { initialValues: PaymentOptionsFormValues }) {
  const [state, formAction, pending] = useActionState<PaymentOptionsFormState, FormData>(savePaymentOptions, {
    values: initialValues,
  });
  const errors = state.fieldErrors ?? {};
  const firstInvalid = Object.keys(errors)[0];
  const describedBy = (name: PaymentOptionField) => (errors[name] ? `${name}-error` : `${name}-hint`);
  const message = (name: PaymentOptionField, hint: string) =>
    errors[name] ? (
      <div id={`${name}-error`} className="field-error">
        {errors[name]}
      </div>
    ) : (
      <div id={`${name}-hint`} className="hint">
        {hint}
      </div>
    );

  return (
    // Remount after each submit so the fields show what was submitted (see CustomerForm).
    <form key={JSON.stringify(state)} action={formAction} noValidate className="panel panel-body customer-form payment-options-form">
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      {FIELDS.map((f) => (
        <div className="field" key={f.name}>
          <label htmlFor={f.name}>{f.label}</label>
          <input
            id={f.name}
            name={f.name}
            defaultValue={state.values[f.name]}
            placeholder={f.placeholder}
            inputMode={f.inputMode}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={f.name === firstInvalid}
            aria-invalid={errors[f.name] ? true : undefined}
            aria-describedby={describedBy(f.name)}
          />
          {message(f.name, f.hint)}
        </div>
      ))}
      <div className="field">
        <label htmlFor="payment_note">Note for customers</label>
        <textarea
          id="payment_note"
          name="payment_note"
          rows={3}
          maxLength={300}
          defaultValue={state.values.payment_note}
          placeholder="e.g. Checks payable to Green Acres Lawn Care LLC. Please put the invoice number in the memo."
          autoFocus={firstInvalid === "payment_note"}
          aria-invalid={errors.payment_note ? true : undefined}
          aria-describedby={describedBy("payment_note")}
        />
        {message("payment_note", "Shown on every invoice, under the ways to pay.")}
      </div>
      <div className="form-actions">
        <Link className="btn secondary" href="/invoices">
          Cancel
        </Link>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save payment options"}
        </button>
      </div>
    </form>
  );
}
