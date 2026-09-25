import { z } from "zod";

import type { Tables } from "@/lib/supabase/database.types";

export type Customer = Tables<"customers">;

export const PREFERRED_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type PreferredDay = (typeof PREFERRED_DAYS)[number];
export const PREFERRED_DAY_LABELS: Record<PreferredDay, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
};

export const CUSTOMER_STATUSES = ["active", "inactive"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  active: "Active",
  inactive: "Inactive",
};

export const NOTIFICATION_PREFERENCES = ["text", "email"] as const;
export type NotificationPreference = (typeof NOTIFICATION_PREFERENCES)[number];
export const NOTIFICATION_PREFERENCE_LABELS: Record<NotificationPreference, string> = {
  text: "Text",
  email: "Email",
};

// Mirrors the customers_email_format constraint in the database.
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;

const text = (label: string, max: number) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer`);

// Limits mirror the customers table constraints, so bad input gets a friendly message
// here instead of a database error.
export const customerSchema = z
  .object({
    first_name: text("First name", 100),
    last_name: text("Last name", 100),
    phone: text("Phone", 40),
    email: text("Email", 254).refine((v) => v === "" || EMAIL_PATTERN.test(v), "Enter a valid email address"),
    property_address: text("Property address", 300),
    billing_address: text("Billing address", 300),
    access_instructions: text("Gate / access instructions", 1000),
    service_notes: text("Service notes", 2000),
    preferred_day: z.enum(PREFERRED_DAYS, { error: "Choose a preferred day" }),
    status: z.enum(CUSTOMER_STATUSES, { error: "Choose a status" }),
    notification_preference: z.enum(NOTIFICATION_PREFERENCES, { error: "Choose a notification preference" }),
    sms_opt_in: z.boolean(),
    // Empty means "today": omitted from the insert so the database default applies,
    // or left unchanged on an edit.
    customer_since: z
      .union([z.literal(""), z.iso.date({ error: "Enter a valid date" })], { error: "Enter a valid date" })
      .transform((v) => v || undefined),
  })
  .refine((c) => [c.first_name, c.last_name, c.phone, c.email].some((v) => v !== ""), {
    message: "Enter at least a name, phone number, or email",
    path: ["first_name"],
  });

export type CustomerInput = z.infer<typeof customerSchema>;
export type CustomerField = keyof CustomerInput;

// Raw form values, echoed back to the form so nothing typed is lost on an error.
export type CustomerFormValues = Omit<Record<CustomerField, string>, "sms_opt_in"> & { sms_opt_in: boolean };

const TEXT_FIELDS = [
  "first_name",
  "last_name",
  "phone",
  "email",
  "property_address",
  "billing_address",
  "access_instructions",
  "service_notes",
  "preferred_day",
  "status",
  "notification_preference",
  "customer_since",
] as const satisfies readonly Exclude<CustomerField, "sms_opt_in">[];

export function customerFormValuesFromFormData(formData: FormData): CustomerFormValues {
  const values = Object.fromEntries(
    TEXT_FIELDS.map((field) => {
      const raw = formData.get(field);
      return [field, typeof raw === "string" ? raw : ""];
    }),
  ) as Omit<CustomerFormValues, "sms_opt_in">;
  return { ...values, sms_opt_in: formData.get("sms_opt_in") === "on" };
}

export function customerFormValuesFromCustomer(customer: Customer): CustomerFormValues {
  return {
    first_name: customer.first_name,
    last_name: customer.last_name,
    phone: customer.phone,
    email: customer.email,
    property_address: customer.property_address,
    billing_address: customer.billing_address,
    access_instructions: customer.access_instructions,
    service_notes: customer.service_notes,
    preferred_day: customer.preferred_day,
    status: customer.status,
    notification_preference: customer.notification_preference,
    sms_opt_in: customer.sms_opt_in,
    customer_since: customer.customer_since,
  };
}

// Defaults match the prototype's Add Customer form. customer_since starts empty and the
// form fills in today's date in the browser, where the owner's time zone is known.
export function emptyCustomerFormValues(): CustomerFormValues {
  return {
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    property_address: "",
    billing_address: "",
    access_instructions: "",
    service_notes: "",
    preferred_day: "monday",
    status: "active",
    notification_preference: "text",
    sms_opt_in: false,
    customer_since: "",
  };
}

export type ParsedCustomer =
  | { success: true; data: CustomerInput }
  | { success: false; fieldErrors: Partial<Record<CustomerField, string>> };

export function parseCustomer(values: CustomerFormValues): ParsedCustomer {
  const result = customerSchema.safeParse(values);
  if (result.success) return { success: true, data: result.data };

  const fieldErrors: Partial<Record<CustomerField, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as CustomerField | undefined;
    if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  return { success: false, fieldErrors };
}

// How the prototype names a customer: full name, else phone, else email.
export function customerDisplayName(c: Pick<Customer, "first_name" | "last_name" | "phone" | "email">): string {
  const name = `${c.first_name} ${c.last_name}`.trim();
  return name || c.phone || c.email || "Unnamed customer";
}

// Matches the phone_digits generated column in the database.
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function preferredDayLabel(day: string): string {
  return PREFERRED_DAY_LABELS[day as PreferredDay] ?? day;
}
