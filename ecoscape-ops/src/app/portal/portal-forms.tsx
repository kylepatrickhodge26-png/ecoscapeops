"use client";

import { useActionState, useState, useTransition } from "react";

import { requestService, respondToQuote, type ServiceRequestState } from "./actions";

export function QuoteAnswer({ quoteId, businessName }: { quoteId: string; businessName: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmNo, setConfirmNo] = useState(false);
  const answer = (accept: boolean) =>
    startTransition(async () => {
      const r = await respondToQuote(quoteId, accept);
      setError(r.error ?? null);
    });
  return (
    <div className="quote-answer">
      {confirmNo ? (
        <>
          <span>Turn down this quote?</span>
          <button type="button" className="btn small secondary" disabled={pending} onClick={() => setConfirmNo(false)}>
            Cancel
          </button>
          <button type="button" className="btn small danger" disabled={pending} onClick={() => answer(false)}>
            {pending ? "Sending…" : "Yes, decline"}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="btn small" disabled={pending} onClick={() => answer(true)}>
            {pending ? "Sending…" : "Accept"}
          </button>
          <button type="button" className="btn small secondary" disabled={pending} onClick={() => setConfirmNo(true)}>
            Decline
          </button>
          <span className="hint">Accepting lets {businessName} know. They&apos;ll confirm the dates with you.</span>
        </>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function RequestServiceForm() {
  const [state, formAction, pending] = useActionState<ServiceRequestState, FormData>(requestService, {});
  if (state.sent) {
    return (
      <div className="notice success" role="status">
        Sent. We&apos;ll get back to you soon.
      </div>
    );
  }
  return (
    <form action={formAction} className="customer-form">
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="details">What do you need?</label>
        <textarea id="details" name="details" rows={4} maxLength={1500} defaultValue={state.details} placeholder="e.g. Fall leaf cleanup, or add hedge trimming" />
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send request"}
        </button>
      </div>
    </form>
  );
}
