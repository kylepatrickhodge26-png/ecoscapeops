"use client";

import { ConfirmButton } from "@/components/confirm-button";

import { regenerateRequestLink } from "./actions";

export function RegenerateButton() {
  return (
    <ConfirmButton
      action={regenerateRequestLink}
      label="Make a new link"
      confirmLabel="Make a new link"
      pendingLabel="Working…"
      danger={false}
      confirmText="The current link will stop working right away. Anywhere you shared it (your website, flyers, texts) needs the new one."
    />
  );
}
