import { describe, expect, it } from "vitest";

import { EMPTY_REQUEST, parseRequest, requestValuesFromFormData } from "./schema";

const ok = { name: " Jo Smith ", phone: "631-555-0100", email: "", address: "12 Oak St", details: "Mow my lawn" };

describe("request form", () => {
  it("accepts a valid request and trims it", () => {
    const r = parseRequest(ok);
    expect(r.success && r.data.name).toBe("Jo Smith");
  });
  it("needs a name, details, and a phone or email", () => {
    expect(parseRequest({ ...ok, name: " " })).toMatchObject({ success: false, fieldErrors: { name: "Enter your name" } });
    expect(parseRequest({ ...ok, details: "" })).toMatchObject({ success: false, fieldErrors: { details: "Tell us what you need" } });
    expect(parseRequest({ ...ok, phone: "", email: "" })).toMatchObject({ success: false, fieldErrors: { phone: expect.stringContaining("phone number or an email") } });
    expect(parseRequest({ ...ok, phone: "", email: "jo@example.com" }).success).toBe(true);
  });
  it("checks the email and every length", () => {
    expect(parseRequest({ ...ok, email: "nope" }).success).toBe(false);
    expect(parseRequest({ ...ok, name: "n".repeat(101) }).success).toBe(false);
    expect(parseRequest({ ...ok, phone: "5".repeat(41) }).success).toBe(false);
    expect(parseRequest({ ...ok, address: "a".repeat(201) }).success).toBe(false);
    expect(parseRequest({ ...ok, details: "d".repeat(1501) }).success).toBe(false);
    expect(parseRequest({ ...ok, details: "d".repeat(1500) }).success).toBe(true);
  });
  it("keeps markup and formulas as plain text", () => {
    const r = parseRequest({ ...ok, name: "=1+1", details: "<script>alert(1)</script>" });
    expect(r.success && [r.data.name, r.data.details]).toEqual(["=1+1", "<script>alert(1)</script>"]);
  });
  it("reads form data, ignoring anything that isn't text", () => {
    const fd = new FormData();
    fd.set("name", "Jo");
    fd.set("details", new File(["x"], "x.txt"));
    expect(requestValuesFromFormData(fd)).toEqual({ ...EMPTY_REQUEST, name: "Jo" });
  });
});
