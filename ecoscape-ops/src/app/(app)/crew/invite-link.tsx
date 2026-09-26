"use client";

import { useState } from "react";

// A one-time invite link, with copy and (on phones) share buttons.
export function InviteLink({ url, name }: { url: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <div className="invite-link" role="status">
      <p>
        Send this link to <b>{name}</b>. They&apos;ll use it to create their own login. It works once and expires in 14
        days, and it won&apos;t be shown again, so copy it now.
      </p>
      <div className="invite-link-row">
        <input readOnly value={url} aria-label={`Invite link for ${name}`} onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="btn small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {canShare && (
          <button
            type="button"
            className="btn secondary small"
            onClick={() => navigator.share({ title: "Join the crew", text: `Join the crew on EcoScape Ops: ${url}` }).catch(() => {})}
          >
            Share
          </button>
        )}
      </div>
    </div>
  );
}
