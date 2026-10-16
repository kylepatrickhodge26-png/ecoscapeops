"use client";

import { useActionState } from "react";

import { acceptCustomerInvite, joinAsCustomer, type CustomerAcceptState, type CustomerJoinState } from "../actions";

export function CustomerJoinForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<CustomerJoinState, FormData>(joinAsCustomer.bind(null, token), {});
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
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} aria-describedby="password-hint" />
        <div id="password-hint" className="hint">
          At least 8 characters.
        </div>
      </div>
      <button className="btn block" type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create my account"}
      </button>
    </form>
  );
}

export function AcceptCustomerInviteButton({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<CustomerAcceptState>(acceptCustomerInvite.bind(null, token), {});
  return (
    <form action={formAction}>
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <button className="btn block" type="submit" disabled={pending}>
        {pending ? "Linking…" : "Use this login for my account"}
      </button>
    </form>
  );
}
