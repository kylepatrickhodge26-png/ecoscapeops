"use client";

import { useActionState } from "react";

import { signIn, type AuthFormState } from "../actions";

export function LoginForm({ next, initialError }: { next: string | null; initialError?: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(signIn, {
    error: initialError,
  });

  return (
    <form action={formAction}>
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      {next && <input type="hidden" name="next" value={next} />}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="btn block" type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
