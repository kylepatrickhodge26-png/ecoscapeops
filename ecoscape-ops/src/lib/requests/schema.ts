import { z } from "zod";

// Limits for the public request form. The database enforces the same limits; these give the
// person a friendly message first. Keep the two in step (see 20261018000000_requests.sql).
export const REQUEST_LIMITS = { name: 100, phone: 40, email: 200, address: 200, details: 1500 } as const;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type RequestFormValues = { name: string; phone: string; email: string; address: string; details: string };
export type RequestField = keyof RequestFormValues;

export const EMPTY_REQUEST: RequestFormValues = { name: "", phone: "", email: "", address: "", details: "" };

const text = (max: number, label: string) => z.string().trim().max(max, `${label} must be ${max} characters or fewer`);

export const requestSchema = z
  .object({
    name: text(REQUEST_LIMITS.name, "Your name").min(1, "Enter your name"),
    phone: text(REQUEST_LIMITS.phone, "The phone number"),
    email: text(REQUEST_LIMITS.email, "The email").refine((v) => v === "" || EMAIL.test(v), "Enter a valid email address"),
    address: text(REQUEST_LIMITS.address, "The address"),
    details: text(REQUEST_LIMITS.details, "This").min(1, "Tell us what you need"),
  })
  .refine((v) => v.phone !== "" || v.email !== "", { path: ["phone"], message: "Enter a phone number or an email so we can reach you" });

export function requestValuesFromFormData(formData: FormData): RequestFormValues {
  const get = (key: RequestField) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return { name: get("name"), phone: get("phone"), email: get("email"), address: get("address"), details: get("details") };
}

export function parseRequest(values: RequestFormValues) {
  const result = requestSchema.safeParse(values);
  if (result.success) return { success: true as const, data: result.data };
  const fieldErrors: Partial<Record<RequestField, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as RequestField;
    fieldErrors[field] ??= issue.message;
  }
  return { success: false as const, fieldErrors };
}
