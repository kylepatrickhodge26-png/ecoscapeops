import { z } from "zod";

import { isISODate } from "@/lib/dates";

import { MANUAL_PAYMENT_METHODS } from "./constants";

// Limits mirror the invoice_lines / invoices / payments constraints, so bad input gets a
// friendly message here instead of a database error.

const money = (label: string, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, `Enter ${label} like 65 or 65.50`)
    .transform(Number)
    .refine((n) => n <= max, `${label[0].toUpperCase()}${label.slice(1)} is too large`);

export const lineSchema = z.object({
  job_id: z.uuid().nullable(),
  description: z.string().trim().min(1, "Describe each line").max(200, "Descriptions must be 200 characters or fewer"),
  quantity: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter a quantity like 1 or 2.5")
    .transform(Number)
    .refine((n) => n > 0 && n <= 9999, "Enter a quantity between 0 and 9999"),
  unit_price: money("a price", 99999.99),
});

export type LineInput = z.input<typeof lineSchema>;

export const invoiceSchema = z
  .object({
    customer_id: z.uuid({ error: "Choose a customer" }),
    due_date: z.string().refine(isISODate, "Choose a due date"),
    notes: z.string().trim().max(1000, "Notes must be 1000 characters or fewer"),
    lines: z.array(lineSchema).min(1, "Add at least one line").max(100, "An invoice can have at most 100 lines"),
  })
  .refine((inv) => inv.lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0) > 0, {
    message: "The invoice total must be more than $0",
    path: ["lines"],
  });

export type InvoiceFormValues = {
  customer_id: string;
  due_date: string;
  notes: string;
  lines: LineInput[];
};

export const paymentSchema = z.object({
  amount: money("an amount", 999999.99).refine((n) => n > 0, "Enter an amount more than $0"),
  method: z.enum(MANUAL_PAYMENT_METHODS, { error: "Choose how it was paid" }),
  received_on: z.string().refine(isISODate, "Choose the date it was received"),
  note: z.string().trim().max(200, "Notes must be 200 characters or fewer"),
  request_id: z.uuid(),
});

// Sum of a set of lines, in dollars, rounded to the cent per line like the database.
export function linesTotal(lines: { quantity: number; unit_price: number }[]): number {
  return lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unit_price * 100) / 100, 0);
}
