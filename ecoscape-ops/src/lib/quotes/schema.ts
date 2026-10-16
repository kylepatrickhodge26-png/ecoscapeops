import { z } from "zod";

import { isISODate } from "@/lib/dates";
import { FREQUENCIES } from "@/lib/schedule/constants";
import { lineSchema } from "@/lib/invoices/schema";

// Limits mirror the quotes / quote_lines constraints, so bad input gets a friendly message
// here instead of a database error.

export const quoteLineSchema = lineSchema.omit({ job_id: true });
export type QuoteLineInput = z.input<typeof quoteLineSchema>;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// A service's price tops out here (see the service_plans constraint), and a quote becomes one.
export const MAX_QUOTE_TOTAL = 99999.99;

export const quoteSchema = z
  .object({
    // "" means a prospect who isn't a customer yet.
    customer_id: z.union([z.literal(""), z.uuid()]),
    prospect_name: z.string().trim().max(200, "The name must be 200 characters or fewer"),
    prospect_phone: z.string().trim().max(40, "The phone number must be 40 characters or fewer"),
    prospect_email: z.string().trim().max(254, "The email must be 254 characters or fewer"),
    prospect_address: z.string().trim().max(300, "The address must be 300 characters or fewer"),
    title: z.string().trim().max(100, "The title must be 100 characters or fewer"),
    expires_on: z.string().refine(isISODate, "Choose an expiry date"),
    notes: z.string().trim().max(2000, "Notes must be 2000 characters or fewer"),
    lines: z.array(quoteLineSchema).min(1, "Add at least one line").max(100, "A quote can have at most 100 lines"),
  })
  .superRefine((q, ctx) => {
    if (q.customer_id === "") {
      if (q.prospect_name === "") ctx.addIssue({ code: "custom", path: ["prospect_name"], message: "Enter the prospect's name, or choose a customer" });
      if (q.prospect_email !== "" && !EMAIL.test(q.prospect_email)) {
        ctx.addIssue({ code: "custom", path: ["prospect_email"], message: "That email address doesn't look right" });
      }
    }
    const total = q.lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unit_price * 100) / 100, 0);
    if (total <= 0) ctx.addIssue({ code: "custom", path: ["lines"], message: "The quote total must be more than $0" });
    if (total > MAX_QUOTE_TOTAL) ctx.addIssue({ code: "custom", path: ["lines"], message: "The quote total can't be more than $99,999.99" });
  });

export type QuoteFormValues = {
  customer_id: string;
  prospect_name: string;
  prospect_phone: string;
  prospect_email: string;
  prospect_address: string;
  title: string;
  expires_on: string;
  notes: string;
  lines: QuoteLineInput[];
};

export const acceptSchema = z.object({
  service_name: z.string().trim().min(1, "Name the service").max(100, "The name must be 100 characters or fewer"),
  frequency: z.enum(FREQUENCIES, { error: "Choose how often" }),
  first_visit: z.string().refine(isISODate, "Choose the first visit date"),
  assigned_crew_member_id: z.union([z.literal(""), z.uuid()]),
});

export type AcceptField = keyof z.input<typeof acceptSchema>;
