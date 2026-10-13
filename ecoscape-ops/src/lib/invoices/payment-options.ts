import { z } from "zod";

import { formatPhone, toE164 } from "@/lib/sms";

// How a business's customers can pay it: the payment apps it already uses, a payment link
// of its own, and a note. Customers see these on an invoice's pay page; the money goes
// straight to the business, and the owner records the payment when it arrives.

export type PaymentOptions = {
  venmo: string | null;
  cash_app: string | null;
  paypal: string | null;
  zelle: string | null;
  pay_link: string | null;
  payment_note: string;
};

export type PaymentOptionField = keyof PaymentOptions;

// Formats mirror the invoice_settings constraints, so bad input gets a friendly message
// here instead of a database error. Blank means "not used".
const optional = (clean: (value: string) => string, valid: (value: string) => boolean, message: string) =>
  z
    .string()
    .transform((value) => clean(value.trim()))
    .refine((value) => value === "" || valid(value), message)
    .transform((value) => value || null);

export const paymentOptionsSchema = z.object({
  venmo: optional(
    (v) => v.replace(/^@/, ""),
    (v) => /^[A-Za-z0-9_-]{5,30}$/.test(v),
    "Enter your Venmo username, like @Green-Acres-Lawn (5 to 30 letters, numbers, - or _)",
  ),
  cash_app: optional(
    (v) => v.replace(/^\$/, ""),
    (v) => /^[A-Za-z0-9_]{1,20}$/.test(v) && /[A-Za-z]/.test(v),
    "Enter your $cashtag, like $GreenAcresLawn (up to 20 letters and numbers)",
  ),
  paypal: optional(
    // People often paste the whole PayPal.Me link.
    (v) => v.replace(/^(https?:\/\/)?(www\.)?(paypal\.me\/|paypal\.com\/paypalme\/)/i, "").replace(/\/+$/, ""),
    (v) => /^[A-Za-z0-9]{1,20}$/.test(v),
    "Enter your PayPal.Me name, the part after paypal.me/ (up to 20 letters and numbers)",
  ),
  zelle: optional(
    (v) => (v.includes("@") ? v.toLowerCase() : (toE164(v) ?? v)),
    (v) => (v.includes("@") ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && v.length <= 254 : /^\+1[2-9]\d{9}$/.test(v)),
    "Enter the email address or US phone number you use with Zelle",
  ),
  pay_link: optional(
    (v) => v,
    (v) => isSecureLink(v) && v.length <= 500,
    "Enter a full link starting with https://",
  ),
  payment_note: z.string().trim().max(300, "Keep the note to 300 characters or fewer"),
});

// A link that's safe to show customers as a button: https only, nothing that could break
// out of the address. The database enforces the same.
export function isSecureLink(value: string): boolean {
  if (!/^https:\/\/[^\s"<>\\]+$/.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export type PayOption =
  | { app: "venmo" | "cash_app" | "paypal" | "pay_link"; label: string; href: string; detail: string }
  | { app: "zelle"; label: string; send_to: string; detail: string };

// The ways to pay an amount, in the order the pay page shows them. Venmo, Cash App and
// PayPal links open the app (or website) with the amount filled in; Zelle has no such
// link, so it shows who to send the money to.
export function payOptions(options: PaymentOptions, amount: number, reference: string): PayOption[] {
  const dollars = amount.toFixed(2);
  const list: PayOption[] = [];
  if (options.venmo) {
    const query = new URLSearchParams({ txn: "pay", amount: dollars, note: reference });
    list.push({ app: "venmo", label: "Venmo", href: `https://venmo.com/${encodeURIComponent(options.venmo)}?${query}`, detail: `@${options.venmo}` });
  }
  if (options.cash_app) {
    list.push({ app: "cash_app", label: "Cash App", href: `https://cash.app/$${encodeURIComponent(options.cash_app)}/${dollars}`, detail: `$${options.cash_app}` });
  }
  if (options.paypal) {
    list.push({ app: "paypal", label: "PayPal", href: `https://paypal.me/${encodeURIComponent(options.paypal)}/${dollars}USD`, detail: `paypal.me/${options.paypal}` });
  }
  if (options.zelle) {
    const sendTo = options.zelle.startsWith("+") ? formatPhone(options.zelle) : options.zelle;
    list.push({ app: "zelle", label: "Zelle", send_to: sendTo, detail: sendTo });
  }
  if (options.pay_link && isSecureLink(options.pay_link)) {
    list.push({ app: "pay_link", label: "Pay online", href: options.pay_link, detail: new URL(options.pay_link).hostname });
  }
  return list;
}

// What the owner sees in settings: "Venmo, Cash App and Zelle".
export function paymentOptionsSummary(options: PaymentOptions): string | null {
  const names = [
    options.venmo && "Venmo",
    options.cash_app && "Cash App",
    options.paypal && "PayPal",
    options.zelle && "Zelle",
    options.pay_link && "your payment link",
  ].filter((n): n is string => Boolean(n));
  if (names.length === 0) return null;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
