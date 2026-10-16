import { QUOTE_STATUS_LABELS, isQuoteStatus } from "@/lib/quotes/constants";

// A quote's live status (quote_status_shown from the database), as a labelled pill.
export function QuoteStatusPill({ status }: { status: string | null }) {
  const known = isQuoteStatus(status) ? status : "draft";
  return (
    <span className={`pill quote-${known}`} data-quote-status={known}>
      {QUOTE_STATUS_LABELS[known]}
    </span>
  );
}
