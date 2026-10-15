"use client";

import { useActionState } from "react";

import { REQUEST_LIMITS } from "@/lib/requests/schema";

import { submitRequest, type RequestFormState } from "./actions";

export function RequestForm({ token, businessName }: { token: string; businessName: string }) {
  const [state, formAction, pending] = useActionState(submitRequest.bind(null, token), { values: { name: "", phone: "", email: "", address: "", details: "" } } as RequestFormState);

  if (state.sent) {
    return (
      <div className="notice success" role="status" data-testid="request-sent">
        Thank you! {businessName} has your request and will get back to you soon.
      </div>
    );
  }

  const err = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate className="customer-form" data-testid="request-form">
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="name">Your name</label>
        <input id="name" name="name" autoComplete="name" defaultValue={state.values.name} maxLength={REQUEST_LIMITS.name} aria-invalid={Boolean(err.name)} />
        {err.name && <p className="field-error">{err.name}</p>}
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="phone">Phone</label>
          <input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={state.values.phone} maxLength={REQUEST_LIMITS.phone} aria-invalid={Boolean(err.phone)} />
          {err.phone && <p className="field-error">{err.phone}</p>}
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" defaultValue={state.values.email} maxLength={REQUEST_LIMITS.email} aria-invalid={Boolean(err.email)} />
          {err.email && <p className="field-error">{err.email}</p>}
        </div>
      </div>
      <div className="field">
        <label htmlFor="address">Property address</label>
        <input id="address" name="address" autoComplete="street-address" defaultValue={state.values.address} maxLength={REQUEST_LIMITS.address} />
      </div>
      <div className="field">
        <label htmlFor="details">What do you need?</label>
        <textarea id="details" name="details" rows={5} defaultValue={state.values.details} maxLength={REQUEST_LIMITS.details} aria-invalid={Boolean(err.details)} />
        {err.details && <p className="field-error">{err.details}</p>}
      </div>
      {/* Honeypot: hidden from people, tempting to bots. */}
      <div className="visually-hidden" aria-hidden="true">
        <label htmlFor="website">Leave this empty</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send request"}
        </button>
      </div>
    </form>
  );
}
