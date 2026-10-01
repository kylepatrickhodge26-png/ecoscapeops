"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { formatShortDate } from "@/lib/dates";
import type { InvoiceFormValues, LineInput } from "@/lib/invoices/schema";
import { formatPrice } from "@/lib/schedule/constants";

import type { InvoiceFormState } from "./actions";
import type { BillableVisit } from "./queries";

type Props = {
  action: (state: InvoiceFormState, formData: FormData) => Promise<InvoiceFormState>;
  customer: { id: string; name: string };
  visits: BillableVisit[];
  initialValues: InvoiceFormValues;
  today: string;
  submitLabel: string;
  cancelHref: string;
};

const visitLine = (v: BillableVisit): LineInput => ({
  job_id: v.id,
  description: `${v.service_name} (${formatShortDate(v.scheduled_date)})`,
  quantity: "1",
  unit_price: v.price.toFixed(2),
});

const amountOf = (l: LineInput) => {
  const n = Number(l.quantity) * Number(l.unit_price);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export function InvoiceForm(props: Props) {
  const [state, formAction, pending] = useActionState(props.action, { values: props.initialValues });
  // Remount after each failed submit so everything shows what was submitted (see CustomerForm).
  return <Fields key={JSON.stringify(state.values)} {...props} state={state} formAction={formAction} pending={pending} />;
}

function Fields({
  customer,
  visits,
  today,
  submitLabel,
  cancelHref,
  state,
  formAction,
  pending,
}: Props & { state: InvoiceFormState; formAction: (formData: FormData) => void; pending: boolean }) {
  const [lines, setLines] = useState<LineInput[]>(state.values.lines);
  const errors = state.fieldErrors ?? {};
  const onInvoice = new Set(lines.map((l) => l.job_id).filter(Boolean));

  const toggleVisit = (visit: BillableVisit, checked: boolean) =>
    setLines((current) => (checked ? [...current, visitLine(visit)] : current.filter((l) => l.job_id !== visit.id)));
  const updateLine = (index: number, patch: Partial<LineInput>) =>
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const total = lines.reduce((sum, l) => sum + amountOf(l), 0);

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
      <input type="hidden" name="customer_id" value={customer.id} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />

      <div className="field">
        <div className="label">Bill to</div>
        <div className="bill-to">
          <b>{customer.name}</b>
        </div>
      </div>

      <fieldset className="field visit-picker">
        <legend>Visits to bill</legend>
        {visits.length === 0 ? (
          <p className="hint">No visits to bill for this customer. Add lines below instead.</p>
        ) : (
          <ul>
            {visits.map((v) => (
              <li key={v.id}>
                <label>
                  <input type="checkbox" checked={onInvoice.has(v.id)} onChange={(e) => toggleVisit(v, e.target.checked)} />
                  <span>
                    {formatShortDate(v.scheduled_date)} · {v.service_name} · {formatPrice(v.price)}
                    {v.status === "completed" ? " · completed" : v.scheduled_date > today ? " · upcoming" : ""}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>Lines</legend>
        {lines.length > 0 && (
          <div className="line-editor" role="table" aria-label="Invoice lines">
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
                <input
                  aria-label={`Line ${i + 1} description`}
                  value={line.description}
                  maxLength={200}
                  onChange={(e) => updateLine(i, { description: e.target.value })}
                />
                <input
                  aria-label={`Line ${i + 1} quantity`}
                  value={line.quantity}
                  inputMode="decimal"
                  onChange={(e) => updateLine(i, { quantity: e.target.value })}
                />
                <input
                  aria-label={`Line ${i + 1} price`}
                  value={line.unit_price}
                  inputMode="decimal"
                  placeholder="65.00"
                  onChange={(e) => updateLine(i, { unit_price: e.target.value })}
                />
                <span className="amount-cell" role="cell">
                  {formatPrice(amountOf(line))}
                </span>
                <button
                  type="button"
                  className="linklike"
                  aria-label={`Remove line ${i + 1}`}
                  onClick={() => setLines((current) => current.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn secondary small"
          onClick={() => setLines((current) => [...current, { job_id: null, description: "", quantity: "1", unit_price: "" }])}
        >
          + Add line
        </button>
        {errors.lines && (
          <div id="lines-error" className="field-error">
            {errors.lines}
          </div>
        )}
        <div className="invoice-total">
          Total <b data-testid="invoice-total">{formatPrice(total)}</b>
        </div>
      </fieldset>

      <div className="row2">
        <div className="field">
          <label htmlFor="due_date">Due date</label>
          <input
            id="due_date"
            name="due_date"
            type="date"
            min={today}
            defaultValue={state.values.due_date}
            aria-invalid={errors.due_date ? true : undefined}
            aria-describedby={errors.due_date ? "due_date-error" : undefined}
          />
          {errors.due_date && (
            <div id="due_date-error" className="field-error">
              {errors.due_date}
            </div>
          )}
        </div>
      </div>
      <div className="field">
        <label htmlFor="notes">Notes for the customer</label>
        <textarea id="notes" name="notes" defaultValue={state.values.notes} maxLength={1000} placeholder="e.g. Thanks for your business!" />
        {errors.notes && <div className="field-error">{errors.notes}</div>}
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
