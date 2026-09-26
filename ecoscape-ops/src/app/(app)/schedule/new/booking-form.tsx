"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { PREFERRED_DAYS } from "@/lib/customers/schema";
import { nextWeekdayOnOrAfter } from "@/lib/dates";
import { FREQUENCIES, FREQUENCY_LABELS, VISITS_AHEAD } from "@/lib/schedule/constants";
import type { BookingField } from "@/lib/schedule/schema";

import { bookService, type BookingFormState } from "../actions";

export type BookingCustomer = { id: string; name: string; preferredDay: string; inactive: boolean };

// Like the prototype: the first visit defaults to the customer's preferred day.
function firstVisitFor(customer: BookingCustomer | undefined, today: string) {
  const weekday = customer ? PREFERRED_DAYS.indexOf(customer.preferredDay as (typeof PREFERRED_DAYS)[number]) + 1 : 0;
  return weekday > 0 ? nextWeekdayOnOrAfter(today, weekday) : today;
}

type Props = { customers: BookingCustomer[]; today: string; presetCustomer: string; presetDate: string };

export function BookingForm({ customers, today, presetCustomer, presetDate }: Props) {
  const initialCustomer = customers.find((c) => c.id === presetCustomer);
  const [state, formAction, pending] = useActionState<BookingFormState, FormData>(bookService, {
    values: {
      customer_id: presetCustomer,
      service_name: "",
      price: "",
      frequency: "weekly",
      start_date: presetDate || (initialCustomer ? firstVisitFor(initialCustomer, today) : today),
    },
  });
  const values = state.values;
  const errors = state.fieldErrors ?? {};
  const firstInvalid = Object.keys(errors)[0];

  // Follow the chosen customer's preferred day until the owner picks a date themselves.
  const [startDate, setStartDate] = useState(values.start_date);
  const [dateTouched, setDateTouched] = useState(Boolean(presetDate));
  const [frequency, setFrequency] = useState(values.frequency);

  const field = (name: BookingField) => ({
    id: name,
    name,
    autoFocus: name === firstInvalid,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });
  const error = (name: BookingField) =>
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

      <div className="field">
        <label htmlFor="customer_id">Customer</label>
        <select
          {...field("customer_id")}
          defaultValue={values.customer_id}
          onChange={(e) => {
            if (!dateTouched) setStartDate(firstVisitFor(customers.find((c) => c.id === e.target.value), today));
          }}
        >
          <option value="" disabled>
            Choose a customer…
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.inactive ? " (inactive)" : ""}
            </option>
          ))}
        </select>
        {error("customer_id")}
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="service_name">Service</label>
          <input {...field("service_name")} defaultValue={values.service_name} placeholder="Mowing" maxLength={100} />
          {error("service_name")}
        </div>
        <div className="field">
          <label htmlFor="price">Price ($)</label>
          <input {...field("price")} defaultValue={values.price} inputMode="decimal" placeholder="65" />
          {error("price")}
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="frequency">How often</label>
          <select {...field("frequency")} defaultValue={values.frequency} onChange={(e) => setFrequency(e.target.value)}>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </option>
            ))}
          </select>
          {error("frequency")}
        </div>
        <div className="field">
          <label htmlFor="start_date">{frequency === "one_time" ? "Visit date" : "First visit"}</label>
          <input
            {...field("start_date")}
            type="date"
            min={today}
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setDateTouched(true);
            }}
          />
          {error("start_date")}
        </div>
      </div>

      <div className="notice">
        {frequency === "one_time"
          ? "This books a single visit."
          : `This books the next ${VISITS_AHEAD} visits. As each one is completed or cancelled, the next is added automatically, so there are always ${VISITS_AHEAD} on the schedule until you stop the service.`}
      </div>

      <div className="form-actions">
        <Link className="btn secondary" href="/schedule">
          Cancel
        </Link>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Booking…" : frequency === "one_time" ? "Book visit" : `Book ${VISITS_AHEAD} visits`}
        </button>
      </div>
    </form>
  );
}
