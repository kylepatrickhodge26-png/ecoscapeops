"use client";

import Link from "next/link";
import { useActionState } from "react";

import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, type ExpenseField, type ExpenseFormValues } from "@/lib/expenses/schema";

import type { ExpenseFormState } from "./actions";

type Props = {
  action: (state: ExpenseFormState, formData: FormData) => Promise<ExpenseFormState>;
  initialValues: ExpenseFormValues;
  submitLabel: string;
  cancelHref: string;
};

export function ExpenseForm({ action, initialValues, submitLabel, cancelHref }: Props) {
  const [state, formAction, pending] = useActionState(action, { values: initialValues });
  const values = state.values;
  const errors = state.fieldErrors ?? {};
  const firstInvalid = Object.keys(errors)[0];

  const field = (name: ExpenseField) => ({
    id: name,
    name,
    autoFocus: name === firstInvalid,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });
  const error = (name: ExpenseField) =>
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
          <label htmlFor="spent_on">Date</label>
          <input {...field("spent_on")} type="date" defaultValue={values.spent_on} />
          {error("spent_on")}
        </div>
        <div className="field">
          <label htmlFor="category">Category</label>
          <select {...field("category")} defaultValue={values.category}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          {error("category")}
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="amount">Amount ($)</label>
          <input {...field("amount")} defaultValue={values.amount} inputMode="decimal" placeholder="62.40" />
          {error("amount")}
        </div>
        <div className="field">
          <label htmlFor="vendor">Vendor</label>
          <input {...field("vendor")} defaultValue={values.vendor} maxLength={120} placeholder="e.g. Speedway" />
          {error("vendor")}
        </div>
      </div>
      <div className="field">
        <label htmlFor="notes">Notes</label>
        <textarea {...field("notes")} defaultValue={values.notes} maxLength={1000} />
        {error("notes")}
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
