"use client";

import Link from "next/link";
import { useActionState } from "react";

import { setServiceArea, type AreaFormState } from "./actions";

export function AreaForm({ current, cancelHref }: { current: string; cancelHref?: string }) {
  const [state, formAction, pending] = useActionState<AreaFormState, FormData>(setServiceArea, {
    values: { postal_code: current },
  });

  return (
    // Remount after each submit so the field shows what was submitted (see CustomerForm).
    <form key={JSON.stringify(state)} action={formAction} noValidate className="panel panel-body customer-form">
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <div className="field area-field">
        <label htmlFor="postal_code">Service area ZIP code</label>
        <input
          id="postal_code"
          name="postal_code"
          defaultValue={state.values.postal_code}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          placeholder="11779"
          autoFocus={Boolean(state.fieldError)}
          aria-invalid={state.fieldError ? true : undefined}
          aria-describedby={state.fieldError ? "postal_code-error" : "postal_code-hint"}
        />
        {state.fieldError ? (
          <div id="postal_code-error" className="field-error">
            {state.fieldError}
          </div>
        ) : (
          <div id="postal_code-hint" className="hint">
            The forecast is for this ZIP code. Use the middle of where you work.
          </div>
        )}
      </div>
      <div className="form-actions">
        {cancelHref && (
          <Link className="btn secondary" href={cancelHref}>
            Cancel
          </Link>
        )}
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save service area"}
        </button>
      </div>
    </form>
  );
}
