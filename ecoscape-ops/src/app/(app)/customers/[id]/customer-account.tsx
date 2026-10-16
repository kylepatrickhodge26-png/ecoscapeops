"use client";

import { useState, useTransition } from "react";

import { InviteLink } from "../../crew/invite-link";

type Action = () => Promise<{ error?: string; inviteUrl?: string }>;

// Owner's controls for a customer's own login: make (or remake) an invite link.
export function CustomerInviteButton({ invite, name, label }: { invite: Action; name: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ error?: string; inviteUrl?: string }>({});
  if (state.inviteUrl) {
    return (
      <InviteLink
        url={state.inviteUrl}
        name={name}
        description={
          <>
            Send this link to <b>{name}</b>. They&apos;ll create a login to see their visits, quotes and invoices.
          </>
        }
        shareText="See your visits, quotes and invoices:"
      />
    );
  }
  return (
    <div>
      <button type="button" className="btn small" disabled={pending} onClick={() => startTransition(async () => setState(await invite()))}>
        {pending ? "Making link…" : label}
      </button>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
