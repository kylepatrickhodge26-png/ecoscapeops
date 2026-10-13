import type { Enums } from "@/lib/supabase/database.types";

// What an invoice shows as: draft, sent and cancelled are set by the owner; partial, paid
// and overdue are worked out live by the database (display_status).
export const INVOICE_STATUSES = ["draft", "sent", "partial", "overdue", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partial: "Partly paid",
  overdue: "Overdue",
  paid: "Paid",
  cancelled: "Cancelled",
};

export const isInvoiceStatus = (value: unknown): value is InvoiceStatus =>
  typeof value === "string" && (INVOICE_STATUSES as readonly string[]).includes(value);

export type PaymentMethod = Enums<"payment_method">;

// Every payment is recorded by the owner once the money arrives, in this order in the form.
export const PAYMENT_METHODS = [
  "cash",
  "check",
  "venmo",
  "cash_app",
  "paypal",
  "zelle",
  "card",
  "bank_transfer",
  "other",
] as const satisfies readonly PaymentMethod[];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  venmo: "Venmo",
  cash_app: "Cash App",
  paypal: "PayPal",
  zelle: "Zelle",
  card: "Card",
  bank_transfer: "Bank transfer",
  other: "Other",
};

export const DEFAULT_TERMS_DAYS = 14;

export const invoiceNumber = (n: number) => `#${n}`;
