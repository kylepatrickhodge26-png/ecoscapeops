"use client";

import { useState, useTransition } from "react";

// Sharing an invoice's pay link: in a text from the owner's own phone (only for customers
// who opted in to texts), by copying the link (to email or paste anywhere), or just
// marking it sent (e.g. handed over on paper). Each of these marks a draft as sent.
export function SendInvoice({
  payUrl,
  smsHref,
  name,
  isDraft,
  markSent,
}: {
  payUrl: string;
  smsHref: string | null;
  name: string;
  isDraft: boolean;
  markSent: () => Promise<{ error?: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = () =>
    startTransition(async () => {
      const result = await markSent();
      setError(result.error ?? null);
    });

  async function copy() {
    try {
      await navigator.clipboard.writeText(payUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the link is on screen to copy by hand.
    }
    if (isDraft) send();
  }

  return (
    <div className="send-invoice">
      <div className="pay-link">
        <label htmlFor="pay-link">Pay link</label>
        <input id="pay-link" readOnly value={payUrl} onFocus={(e) => e.target.select()} />
      </div>
      <div className="text-actions">
        {smsHref && (
          <a className="btn small" href={smsHref} aria-label={`Text invoice to ${name}`} onClick={() => isDraft && send()}>
            Open text
          </a>
        )}
        <button type="button" className="btn secondary small" onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </button>
        {isDraft && (
          <button type="button" className="btn secondary small" onClick={send} disabled={pending}>
            {pending ? "Saving…" : "Mark as sent"}
          </button>
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
