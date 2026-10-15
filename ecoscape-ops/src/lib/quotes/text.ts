import { formatShortDate } from "@/lib/dates";
import { formatPrice } from "@/lib/schedule/constants";

import { quoteNumber } from "./constants";

type TextQuote = {
  number: number;
  title: string;
  expires_on: string;
  notes: string;
  total: number;
  lines: { description: string; quantity: number; unit_price: number; amount: number | null }[];
};

// A quote as plain text to paste into a text message or email. No links, no formatting
// that a messaging app would mangle.
export function quoteText(quote: TextQuote, who: { greeting: string | null; businessName: string }): string {
  const lines = quote.lines.map((l) => {
    const amount = formatPrice(l.amount ?? Math.round(l.quantity * l.unit_price * 100) / 100);
    return l.quantity === 1 ? `- ${l.description}: ${amount}` : `- ${l.description} (${l.quantity} x ${formatPrice(l.unit_price)}): ${amount}`;
  });
  return [
    `${who.greeting ? `Hi ${who.greeting}, h` : "H"}ere's your quote ${quoteNumber(quote.number)} from ${who.businessName}${quote.title ? ` for ${quote.title}` : ""}:`,
    "",
    ...lines,
    "",
    `Total: ${formatPrice(quote.total)}`,
    `Good through ${formatShortDate(quote.expires_on)}.`,
    ...(quote.notes ? ["", quote.notes] : []),
    "",
    "Reply to accept or with any questions. Thanks!",
  ].join("\n");
}
