"use client";

import { useActionState, useState } from "react";

import { addCrewMember, newInviteLink, type AddCrewState, type InviteLinkState, type RenameState } from "./actions";
import { InviteLink } from "./invite-link";

export function AddCrewForm() {
  const [state, formAction, pending] = useActionState<AddCrewState, FormData>(addCrewMember, {});
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Add a crew member</h3>
      </div>
      <div className="panel-body">
        {state.inviteUrl && state.name && <InviteLink url={state.inviteUrl} name={state.name} />}
        <form action={formAction} className="inline-form">
          <div className="field">
            <label htmlFor="crew-name">Name</label>
            <input
              id="crew-name"
              name="name"
              maxLength={80}
              placeholder="e.g. Maria"
              aria-invalid={state.error ? true : undefined}
              aria-describedby={state.error ? "crew-name-error" : undefined}
            />
            {state.error && (
              <div id="crew-name-error" className="field-error">
                {state.error}
              </div>
            )}
          </div>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add and get invite link"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function NewInviteLinkButton({ crewMemberId, name }: { crewMemberId: string; name: string }) {
  const [state, formAction, pending] = useActionState<InviteLinkState>(newInviteLink.bind(null, crewMemberId), {});
  return (
    <div className="crew-invite">
      {state.inviteUrl ? (
        <InviteLink url={state.inviteUrl} name={name} />
      ) : (
        <form action={formAction}>
          <button className="btn secondary small" type="submit" disabled={pending}>
            {pending ? "Making link…" : "New invite link"}
          </button>
        </form>
      )}
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}

export function RenameCrewMember({
  action,
  current,
}: {
  action: (state: RenameState, formData: FormData) => Promise<RenameState>;
  current: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  if (!open) {
    return (
      <button type="button" className="btn secondary small" onClick={() => setOpen(true)}>
        Rename
      </button>
    );
  }
  return (
    <form action={formAction} className="inline-form rename-form">
      <input name="name" defaultValue={state.value ?? current} maxLength={80} aria-label="New name" autoFocus />
      <button className="btn small" type="submit" disabled={pending}>
        Save
      </button>
      <button type="button" className="btn secondary small" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {state.error && <div className="field-error">{state.error}</div>}
    </form>
  );
}
