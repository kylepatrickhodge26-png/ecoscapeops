"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import type { QuoteFormValues, QuoteLineInput } from "@/lib/quotes/schema";
import { formatPrice } from "@/lib/schedule/constants";

import type { QuoteFormState } from "./actions";

type Props = {
  action: (state: QuoteFormState, formData: FormData) => Promise<QuoteFormState>;
  customers: { id: string; name: string }[];
  initialValues: QuoteFormValues;
  today: string;
  submitLabel: string;
  cancelHref: string;
};

const amountOf = (l: QuoteLineInput) => {
  const n = Number(l.quantity) * Number(l.unit_price);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export function QuoteForm(props: Props) {
  const [state, formAction, pending] = useActionState(props.action, { values: props.initialValues });
  // Remount after each failed submit so everything shows what was submitted (see CustomerForm).
  return <Fields key={JSON.stringify(state.values)} {...props} state={state} formAction={formAction} pending={pending} />;
}

function Fields({
  customers,
  today,
  submitLabel,
  cancelHref,
  state,
  formAction,
  pending,
}: Props & { state: QuoteFormState; formAction: (formData: FormData) => void; pending: boolean }) {
  const [customerId, setCustomerId] = useState(state.values.customer_id);
  const [lines, setLines] = useState<QuoteLineInput[]>(state.values.lines);
  const errors = state.fieldErrors ?? {};
  const isProspect = customerId === "";
  const total = lines.reduce((sum, l) => sum + amountOf(l), 0);
  const updateLine = (index: number, patch: Partial<QuoteLineInput>) =>
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const err = (name: keyof QuoteFormValues) =>
    errors[name] ? (
      <div id={`${name}-error`} className="field-error">
        {errors[name]}
      </div>
    ) : null;
  const invalid = (name: keyof QuoteFormValues) => ({
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });

  return (
    <form action={formAction} noValidate className="panel panel-body customer-form invoice-form">
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
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />

      <div className="field">
        <label htmlFor="customer_id">Quote for</label>
        <select id="customer_id" name="customer_id" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">A new prospect (not a customer yet)</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {isProspect && (
        <fieldset className="field prospect-fields">
          <legend>Prospect</legend>
          <div className="row2">
            <div className="field">
              <label htmlFor="prospect_name">Name</label>
              <input id="prospect_name" name="prospect_name" defaultValue={state.values.prospect_name} maxLength={200} {...invalid("prospect_name")} />
              {err("prospect_name")}
            </div>
            <div className="field">
              <label htmlFor="prospect_phone">Phone</label>
              <input id="prospect_phone" name="prospect_phone" type="tel" defaultValue={state.values.prospect_phone} maxLength={40} {...invalid("prospect_phone")} />
              {err("prospect_phone")}
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label htmlFor="prospect_email">Email</label>
              <input id="prospect_email" name="prospect_email" type="email" defaultValue={state.values.prospect_email} maxLength={254} {...invalid("prospect_email")} />
              {err("prospect_email")}
            </div>
            <div className="field">
              <label htmlFor="prospect_address">Property address</label>
              <input id="prospect_address" name="prospect_address" defaultValue={state.values.prospect_address} maxLength={300} {...invalid("prospect_address")} />
              {err("prospect_address")}
            </div>
          </div>
          <p className="hint">They become a customer when you accept the quote.</p>
        </fieldset>
      )}

      <div className="row2">
        <div className="field">
          <label htmlFor="title">What&apos;s the job?</label>
          <input id="title" name="title" defaultValue={state.values.title} maxLength={100} placeholder="e.g. Spring cleanup" {...invalid("title")} />
          {err("title")}
        </div>
        <div className="field">
          <label htmlFor="expires_on">Good through</label>
          <input id="expires_on" name="expires_on" type="date" min={today} defaultValue={state.values.expires_on} {...invalid("expires_on")} />
          {err("expires_on")}
        </div>
      </div>

      <fieldset className="field">
        <legend>Lines</legend>
        {lines.length > 0 && (
          <div className="line-editor" role="table" aria-label="Quote lines">
            <div className="line-row line-head" role="row">
              <span role="columnheader">Description</span>
              <span role="columnheader">Qty</span>
              <span role="columnheader">Price ($)</span>
              <span role="columnheader">Amount</span>
              <span role="columnheader">
                <span className="visually-hidden">Remove</span>
              </span>
            </div>
            {lines.map((line, i) => (
              <div className="line-row" role="row" key={i}>
                <input aria-label={`Line ${i + 1} description`} value={line.description} maxLength={200} onChange={(e) => updateLine(i, { description: e.target.value })} />
                <input aria-label={`Line ${i + 1} quantity`} value={line.quantity} inputMode="decimal" onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                <input aria-label={`Line ${i + 1} price`} value={line.unit_price} inputMode="decimal" placeholder="65.00" onChange={(e) => updateLine(i, { unit_price: e.target.value })} />
                <span className="amount-cell" role="cell">
                  {formatPrice(amountOf(line))}
                </span>
                <button type="button" className="linklike" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((current) => current.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="btn secondary small" onClick={() => setLines((current) => [...current, { description: "", quantity: "1", unit_price: "" }])}>
          + Add line
        </button>
        {errors.lines && (
          <div id="lines-error" className="field-error">
            {errors.lines}
          </div>
        )}
        <div className="invoice-total">
          Total <b data-testid="quote-total">{formatPrice(total)}</b>
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="notes">Notes for the customer</label>
        <textarea id="notes" name="notes" defaultValue={state.values.notes} maxLength={2000} placeholder="e.g. Price includes hauling away the debris." />
        {err("notes")}
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
