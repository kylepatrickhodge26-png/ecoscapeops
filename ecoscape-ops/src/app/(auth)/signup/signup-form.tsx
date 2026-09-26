"use client";

import { useActionState } from "react";

import { signUp, type AuthFormState } from "../actions";

export function SignupForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(signUp, {});

  if (state.message) {
    return (
      <div className="notice success" role="status">
        {state.message}
      </div>
    );
  }

  return (
    <form action={formAction}>
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="business_name">Business name</label>
        <input
          id="business_name"
          name="business_name"
          autoComplete="organization"
          required
          maxLength={120}
          defaultValue={state.values?.business_name}
        />
      </div>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-describedby="password-hint"
        />
        <div id="password-hint" className="hint">
          At least 8 characters.
        </div>
      </div>
      <button className="btn block" type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
