import { describe, expect, it } from "vitest";

import {
  customerDisplayName,
  customerFormValuesFromFormData,
  emptyCustomerFormValues,
  parseCustomer,
  phoneDigits,
  type CustomerFormValues,
} from "./schema";

const valid = (overrides: Partial<CustomerFormValues> = {}): CustomerFormValues => ({
  ...emptyCustomerFormValues(),
  first_name: "John",
  last_name: "Smith",
  ...overrides,
});

describe("parseCustomer", () => {
  it("accepts a customer with every field filled in", () => {
    const result = parseCustomer(
      valid({
        phone: "(631) 555-0142",
        email: "jsmith@example.com",
        property_address: "123 Example Street, Lake Ronkonkoma, NY",
        billing_address: "PO Box 12",
        access_instructions: "Side gate, code 4471",
        service_notes: "Dog in backyard on weekends — call ahead.",
        preferred_day: "tuesday",
        status: "inactive",
        notification_preference: "email",
        sms_opt_in: true,
        customer_since: "2026-04-01",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("trims whitespace", () => {
    const result = parseCustomer(valid({ first_name: "  John  ", email: " a@b.co " }));
    expect(result.success && result.data.first_name).toBe("John");
    expect(result.success && result.data.email).toBe("a@b.co");
  });

  it("requires at least a name, phone, or email", () => {
    const result = parseCustomer(valid({ first_name: " ", last_name: "" }));
    expect(result).toEqual({
      success: false,
      fieldErrors: { first_name: "Enter at least a name, phone number, or email" },
    });
  });

  it.each([
    ["only a phone number", { phone: "631-555-0142" }],
    ["only an email", { email: "x@example.com" }],
    ["only a last name", { last_name: "Reyes" }],
  ])("accepts a customer identified by %s", (_label, overrides) => {
    expect(parseCustomer(valid({ first_name: "", last_name: "", ...overrides })).success).toBe(true);
  });

  it("rejects a malformed email", () => {
    const result = parseCustomer(valid({ email: "not-an-email" }));
    expect(result.success).toBe(false);
    expect(!result.success && result.fieldErrors.email).toBe("Enter a valid email address");
  });

  it("rejects values outside the allowed choices", () => {
    const result = parseCustomer(
      valid({ preferred_day: "sunday", status: "archived", notification_preference: "fax" }),
    );
    expect(result.success).toBe(false);
    expect(!result.success && Object.keys(result.fieldErrors).sort()).toEqual([
      "notification_preference",
      "preferred_day",
      "status",
    ]);
  });

  it("rejects an invalid customer-since date", () => {
    expect(parseCustomer(valid({ customer_since: "2026-02-30" })).success).toBe(false);
    expect(parseCustomer(valid({ customer_since: "last spring" })).success).toBe(false);
  });

  it("leaves an empty customer-since date out, so the database default applies", () => {
    const result = parseCustomer(valid({ customer_since: "" }));
    expect(result.success).toBe(true);
    // supabase-js sends JSON, where an undefined field disappears.
    expect(JSON.parse(JSON.stringify(result.success && result.data))).not.toHaveProperty("customer_since");
  });

  it("enforces the same length limits as the database", () => {
    const result = parseCustomer(valid({ first_name: "x".repeat(101), service_notes: "y".repeat(2001) }));
    expect(!result.success && result.fieldErrors).toEqual({
      first_name: "First name must be 100 characters or fewer",
      service_notes: "Service notes must be 2000 characters or fewer",
    });
  });
});

describe("customerFormValuesFromFormData", () => {
  it("reads text fields and treats a missing checkbox as unchecked", () => {
    const fd = new FormData();
    fd.set("first_name", "Dana");
    fd.set("preferred_day", "wednesday");
    const values = customerFormValuesFromFormData(fd);
    expect(values.first_name).toBe("Dana");
    expect(values.last_name).toBe("");
    expect(values.preferred_day).toBe("wednesday");
    expect(values.sms_opt_in).toBe(false);

    fd.set("sms_opt_in", "on");
    expect(customerFormValuesFromFormData(fd).sms_opt_in).toBe(true);
  });
});

describe("customerDisplayName", () => {
  const base = { first_name: "", last_name: "", phone: "", email: "" };
  it("falls back from name to phone to email, like the prototype", () => {
    expect(customerDisplayName({ ...base, first_name: "Mike", last_name: "Jones", phone: "1" })).toBe("Mike Jones");
    expect(customerDisplayName({ ...base, last_name: "Jones" })).toBe("Jones");
    expect(customerDisplayName({ ...base, phone: "(631) 555-0198", email: "m@x.com" })).toBe("(631) 555-0198");
    expect(customerDisplayName({ ...base, email: "m@x.com" })).toBe("m@x.com");
    expect(customerDisplayName(base)).toBe("Unnamed customer");
  });
});

describe("phoneDigits", () => {
  it("strips everything but digits so formats compare equal", () => {
    expect(phoneDigits("(631) 555-0142")).toBe("6315550142");
    expect(phoneDigits("631.555.0142")).toBe("6315550142");
    expect(phoneDigits("")).toBe("");
  });
});
