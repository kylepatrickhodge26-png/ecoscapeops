"use client";

import { useActionState } from "react";

import { startCheckout } from "./actions";

export function PayButton({ token, label }: { token: string; label: string }) {
  const [state, formAction, pending] = useActionState(async () => startCheckout(token), {});
  return (
    <form action={formAction}>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <button className="btn pay-button" type="submit" disabled={pending}>
        {pending ? "Opening secure checkout…" : label}
      </button>
    </form>
  );
}
