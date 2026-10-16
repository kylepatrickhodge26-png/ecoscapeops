// What a quote shows as: draft, sent, accepted and declined are set by the owner; "expired"
// is worked out live by the database (quote_status_shown) for a sent quote past its expiry.
export const QUOTE_STATUSES = ["draft", "sent", "accepted", "declined", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

export const isQuoteStatus = (value: unknown): value is QuoteStatus =>
  typeof value === "string" && (QUOTE_STATUSES as readonly string[]).includes(value);

// A new quote is good for this many days unless the owner picks another date.
export const DEFAULT_QUOTE_DAYS = 30;

export const quoteNumber = (n: number) => `Q-${n}`;
