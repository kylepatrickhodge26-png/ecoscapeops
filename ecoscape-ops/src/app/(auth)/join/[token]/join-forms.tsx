"use client";

import { useActionState } from "react";

import { acceptInvite, joinCrew, type AcceptState, type JoinState } from "../actions";

export function JoinForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<JoinState, FormData>(joinCrew.bind(null, token), {});

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
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
      </div>
      <div className="field">
        <label htmlFor="password">Choose a password</label>
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
        {pending ? "Joining…" : "Create login and join"}
      </button>
    </form>
  );
}

export function AcceptInviteButton({ token, businessName }: { token: string; businessName: string }) {
  const [state, formAction, pending] = useActionState<AcceptState>(acceptInvite.bind(null, token), {});
  return (
    <form action={formAction}>
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <button className="btn block" type="submit" disabled={pending}>
        {pending ? "Joining…" : `Join ${businessName}`}
      </button>
    </form>
  );
}
