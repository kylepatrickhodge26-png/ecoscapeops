"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import type { AssigneeOption } from "@/lib/crew";
import { PREFERRED_DAYS } from "@/lib/customers/schema";
import { nextWeekdayOnOrAfter } from "@/lib/dates";
import { VISITS_AHEAD } from "@/lib/schedule/constants";
import type { BookingField } from "@/lib/schedule/schema";
import { kindOfFrequency, type ServiceKind } from "@/lib/schedule/service";

import { bookService, type BookingFormState } from "../actions";
import { ServiceFields } from "../service-fields";

export type BookingCustomer = { id: string; name: string; preferredDay: string; inactive: boolean };

// Like the prototype: the first visit defaults to the customer's preferred day.
function firstVisitFor(customer: BookingCustomer | undefined, today: string) {
  const weekday = customer ? PREFERRED_DAYS.indexOf(customer.preferredDay as (typeof PREFERRED_DAYS)[number]) + 1 : 0;
  return weekday > 0 ? nextWeekdayOnOrAfter(today, weekday) : today;
}

type Props = {
  customers: BookingCustomer[];
  // Only given once the business has more than one crew member.
  assignees?: AssigneeOption[];
  today: string;
  presetCustomer: string;
  presetDate: string;
};

export function BookingForm({ customers, assignees, today, presetCustomer, presetDate }: Props) {
  const initialCustomer = customers.find((c) => c.id === presetCustomer);
  const [state, formAction, pending] = useActionState<BookingFormState, FormData>(bookService, {
    values: {
      customer_id: presetCustomer,
      service_name: "",
      price: "",
      frequency: "weekly",
      start_date: presetDate || (initialCustomer ? firstVisitFor(initialCustomer, today) : today),
      assigned_crew_member_id: "",
    },
  });
  const values = state.values;
  const errors = state.fieldErrors ?? {};
  const firstInvalid = Object.keys(errors)[0];

  // Follow the chosen customer's preferred day until the owner picks a date themselves.
  const [startDate, setStartDate] = useState(values.start_date);
  const [dateTouched, setDateTouched] = useState(Boolean(presetDate));
  const [kind, setKind] = useState<ServiceKind>(kindOfFrequency(values.frequency));

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
      <ServiceFields
        kind={kind}
        onKindChange={setKind}
        startDate={startDate}
        onStartDateChange={(date) => {
          setStartDate(date);
          setDateTouched(true);
        }}
        defaults={values}
        errors={errors}
        firstInvalid={firstInvalid}
        today={today}
        assignees={assignees}
      />

      <div className="form-actions">
        <Link className="btn secondary" href="/schedule">
          Cancel
        </Link>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Booking…" : kind === "one_time" ? "Book visit" : `Book ${VISITS_AHEAD} visits`}
        </button>
      </div>
    </form>
  );
}
