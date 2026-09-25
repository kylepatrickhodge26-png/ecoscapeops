"use client";

import { useActionState } from "react";

import { createBusiness, type OnboardingState } from "./actions";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(createBusiness, {});

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
          defaultValue={state.business_name}
        />
      </div>
      <button className="btn block" type="submit" disabled={pending}>
        {pending ? "Setting up…" : "Continue"}
      </button>
    </form>
  );
}
