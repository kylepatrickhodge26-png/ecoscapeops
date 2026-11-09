import { bookingSchema, collectFieldErrors } from "./schema";

// Booking someone's work: a repeat service (like weekly mowing) or a one-time job (like a
// patio). Add customer can book it in the same step ("Not yet" books nothing).
export const SERVICE_KINDS = ["repeat", "one_time", "none"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];
export const REPEAT_FREQUENCIES = ["weekly", "biweekly", "triweekly"] as const;

export const SERVICE_FIELDS = ["frequency", "service_name", "price", "start_date", "assigned_crew_member_id"] as const;
export type ServiceField = (typeof SERVICE_FIELDS)[number];
export type ServiceFormValues = Record<ServiceField, string> & { kind: ServiceKind };

export const kindOfFrequency = (frequency: string): ServiceKind => (frequency === "one_time" ? "one_time" : "repeat");

export function emptyServiceFormValues(startDate: string): ServiceFormValues {
  return { kind: "repeat", frequency: "weekly", service_name: "", price: "", start_date: startDate, assigned_crew_member_id: "" };
}

export function serviceFormValuesFromFormData(formData: FormData): ServiceFormValues {
  const raw = String(formData.get("service_kind") ?? "");
  const kind: ServiceKind = (SERVICE_KINDS as readonly string[]).includes(raw) ? (raw as ServiceKind) : "none";
  const text = (name: ServiceField) => {
    const v = formData.get(name);
    return typeof v === "string" ? v : "";
  };
  return {
    kind,
    frequency: text("frequency"),
    service_name: text("service_name"),
    price: text("price"),
    start_date: text("start_date"),
    assigned_crew_member_id: text("assigned_crew_member_id"),
  };
}

// The same rules as Book a job, without the customer (they're being added).
export function parseNewCustomerService(values: ServiceFormValues, today: string) {
  if (values.kind === "none") return { success: true, data: null } as const;
  const schema = bookingSchema(today).omit({ customer_id: true });
  const result = schema.safeParse({ ...values, frequency: values.kind === "one_time" ? "one_time" : values.frequency });
  return result.success
    ? ({ success: true, data: result.data } as const)
    : ({ success: false, fieldErrors: collectFieldErrors<ServiceField>(result.error) } as const);
}

export type NewCustomerService = NonNullable<Extract<ReturnType<typeof parseNewCustomerService>, { success: true }>["data"]>;
