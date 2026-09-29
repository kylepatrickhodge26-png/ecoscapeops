"use client";

import Link from "next/link";
import { useActionState } from "react";

import { moveDay, type MoveDayState, type MoveDayValues } from "./actions";

export function MoveDayForm({ initialValues, today }: { initialValues: MoveDayValues; today: string }) {
  const [state, formAction, pending] = useActionState<MoveDayState, FormData>(moveDay, { values: initialValues });
  const errors = state.fieldErrors ?? {};
  const firstInvalid = Object.keys(errors)[0];

  const field = (name: keyof MoveDayValues) => ({
    id: name,
    name,
    type: "date",
    min: today,
    defaultValue: state.values[name],
    autoFocus: name === firstInvalid,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });
  const error = (name: keyof MoveDayValues) =>
    errors[name] ? (
      <div id={`${name}-error`} className="field-error">
        {errors[name]}
      </div>
    ) : null;

  return (
    <form key={JSON.stringify(state)} action={formAction} noValidate className="panel panel-body customer-form">
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <div className="row2">
        <div className="field">
          <label htmlFor="from_date">Move visits from</label>
          <input {...field("from_date")} />
          {error("from_date")}
        </div>
        <div className="field">
          <label htmlFor="to_date">To</label>
          <input {...field("to_date")} />
          {error("to_date")}
        </div>
      </div>
      <p className="hint">
        Moves every visit on that day that isn&apos;t completed or cancelled, and marks it <b>Weather delay</b> so
        it&apos;s easy to spot on the schedule. Crew assignments stay the same. Next, you can text the affected customers
        who have opted in to texts.
      </p>
      <div className="form-actions">
        <Link className="btn secondary" href="/weather">
          Cancel
        </Link>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Moving…" : "Move visits"}
        </button>
      </div>
    </form>
  );
}
