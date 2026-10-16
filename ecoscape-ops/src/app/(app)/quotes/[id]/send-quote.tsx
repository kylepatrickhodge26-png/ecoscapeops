"use client";

import { useState, useTransition } from "react";

// Sharing a quote: copy it as plain text to paste anywhere, open a text from the owner's own
// phone (only for customers who opted in to texts), or just mark it sent (e.g. handed over
// in person). Each of these marks a draft as sent.
export function SendQuote({
  text,
  smsHref,
  name,
  isDraft,
  markSent,
}: {
  text: string;
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
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the text is on screen to copy by hand.
    }
    if (isDraft) send();
  }

  return (
    <div className="send-invoice">
      <div className="pay-link">
        <label htmlFor="quote-text">Message</label>
        <textarea id="quote-text" readOnly rows={Math.min(14, text.split("\n").length + 1)} value={text} onFocus={(e) => e.target.select()} />
      </div>
      <div className="text-actions">
        {smsHref && (
          <a className="btn small" href={smsHref} aria-label={`Text quote to ${name}`} onClick={() => isDraft && send()}>
            Open text
          </a>
        )}
        <button type="button" className="btn secondary small" onClick={copy}>
          {copied ? "Copied" : "Copy as text"}
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
