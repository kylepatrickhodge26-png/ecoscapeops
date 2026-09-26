import { z } from "zod";

import { formatShortDate, isISODate } from "@/lib/dates";

import { FREQUENCIES, JOB_STATUSES } from "./constants";

// Limits mirror the service_plans / jobs table constraints.
const serviceName = z
  .string()
  .trim()
  .min(1, "Enter the service, e.g. Mowing")
  .max(100, "Service must be 100 characters or fewer");

const price = z
  .string()
  .trim()
  .regex(/^\d{1,5}(\.\d{1,2})?$/, "Enter a price like 65 or 65.50")
  .transform(Number);

const date = (message: string) => z.string().refine(isISODate, message);

const onOrAfter = (today: string) => (value: string) => value >= today;

type FieldErrors<K extends string> = Partial<Record<K, string>>;

function collectFieldErrors<K extends string>(error: z.ZodError): FieldErrors<K> {
  const fieldErrors: FieldErrors<K> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as K | undefined;
    if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  return fieldErrors;
}

function stringValues<K extends string>(formData: FormData, fields: readonly K[]): Record<K, string> {
  return Object.fromEntries(
    fields.map((field) => {
      const raw = formData.get(field);
      return [field, typeof raw === "string" ? raw : ""];
    }),
  ) as Record<K, string>;
}

// ---------------------------------------------------------------------------
// Booking a service
// ---------------------------------------------------------------------------
export const BOOKING_FIELDS = ["customer_id", "service_name", "price", "frequency", "start_date"] as const;
export type BookingField = (typeof BOOKING_FIELDS)[number];
export type BookingFormValues = Record<BookingField, string>;

export function bookingSchema(today: string) {
  return z.object({
    customer_id: z.uuid({ error: "Choose a customer" }),
    service_name: serviceName,
    price,
    frequency: z.enum(FREQUENCIES, { error: "Choose how often" }),
    start_date: date("Enter the first visit date").refine(
      onOrAfter(today),
      `The first visit can't be before today (${formatShortDate(today)})`,
    ),
  });
}

export type BookingInput = z.infer<ReturnType<typeof bookingSchema>>;

export const bookingFormValuesFromFormData = (formData: FormData) => stringValues(formData, BOOKING_FIELDS);

export function parseBooking(values: BookingFormValues, today: string) {
  const result = bookingSchema(today).safeParse(values);
  return result.success
    ? ({ success: true, data: result.data } as const)
    : ({ success: false, fieldErrors: collectFieldErrors<BookingField>(result.error) } as const);
}

// ---------------------------------------------------------------------------
// Editing a visit
// ---------------------------------------------------------------------------
export const JOB_FIELDS = ["service_name", "price", "scheduled_date", "status", "notes"] as const;
export type JobField = (typeof JOB_FIELDS)[number];
export type JobFormValues = Record<JobField, string>;

export const jobSchema = z.object({
  service_name: serviceName,
  price,
  scheduled_date: date("Enter a valid date"),
  status: z.enum(JOB_STATUSES, { error: "Choose a status" }),
  notes: z.string().trim().max(4000, "Notes must be 4000 characters or fewer"),
});

export const jobFormValuesFromFormData = (formData: FormData) => stringValues(formData, JOB_FIELDS);

export function parseJob(values: JobFormValues) {
  const result = jobSchema.safeParse(values);
  return result.success
    ? ({ success: true, data: result.data } as const)
    : ({ success: false, fieldErrors: collectFieldErrors<JobField>(result.error) } as const);
}

// ---------------------------------------------------------------------------
// "Could not service": reschedule or cancel, never just a dead-end status
// ---------------------------------------------------------------------------
export const COULD_NOT_SERVICE_FIELDS = ["choice", "new_date", "reason"] as const;
export type CouldNotServiceField = (typeof COULD_NOT_SERVICE_FIELDS)[number];
export type CouldNotServiceValues = Record<CouldNotServiceField, string>;

export function couldNotServiceSchema(today: string) {
  const reason = z.string().trim().max(300, "Keep the reason under 300 characters");
  return z.discriminatedUnion(
    "choice",
    [
      z.object({
        choice: z.literal("reschedule"),
        new_date: date("Pick the new date").refine(
          onOrAfter(today),
          `The new date can't be before today (${formatShortDate(today)})`,
        ),
        reason,
      }),
      z.object({ choice: z.literal("cancel"), new_date: z.string(), reason }),
    ],
    { error: "Choose whether to reschedule or cancel" },
  );
}

export const couldNotServiceValuesFromFormData = (formData: FormData) =>
  stringValues(formData, COULD_NOT_SERVICE_FIELDS);

export function parseCouldNotService(values: CouldNotServiceValues, today: string) {
  const result = couldNotServiceSchema(today).safeParse(values);
  return result.success
    ? ({ success: true, data: result.data } as const)
    : ({ success: false, fieldErrors: collectFieldErrors<CouldNotServiceField>(result.error) } as const);
}

// The line added to a visit's notes when it couldn't be serviced, e.g.
// "Couldn't service on Tue, Sep 29 (gate locked) — rescheduled to Wed, Sep 30."
export function couldNotServiceNote(
  originalDate: string,
  outcome: { choice: "reschedule"; newDate: string } | { choice: "cancel" },
  reason: string,
): string {
  const why = reason ? ` (${reason})` : "";
  const what = outcome.choice === "reschedule" ? `rescheduled to ${formatShortDate(outcome.newDate)}` : "cancelled";
  return `Couldn't service on ${formatShortDate(originalDate)}${why} — ${what}.`;
}

export function appendNote(existing: string, line: string): string {
  return existing.trim() ? `${existing.trim()}\n${line}` : line;
}
