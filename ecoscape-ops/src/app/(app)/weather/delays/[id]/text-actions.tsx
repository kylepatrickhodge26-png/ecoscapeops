"use client";

import { useState, useTransition } from "react";

// "Open text" hands the message to the phone's Messages app (sending it is up to the
// owner) and records that it was opened, so the list shows who's been texted.
export function TextActions({
  href,
  body,
  name,
  markOpened,
}: {
  href: string;
  body: string;
  name: string;
  markOpened: () => Promise<void>;
}) {
  const [, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (e.g. not a secure context): the message is on screen to copy.
    }
  }

  return (
    <div className="text-actions">
      <a
        className="btn small"
        href={href}
        aria-label={`Open text to ${name}`}
        onClick={() => startTransition(() => markOpened())}
      >
        Open text
      </a>
      <button type="button" className="btn secondary small" onClick={copy} aria-label={`Copy message for ${name}`}>
        {copied ? "Copied" : "Copy message"}
      </button>
    </div>
  );
}
