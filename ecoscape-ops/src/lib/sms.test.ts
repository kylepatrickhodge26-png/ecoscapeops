import { describe, expect, it } from "vitest";

import { formatPhone, smsLink, toE164 } from "./sms";

describe("smsLink", () => {
  it("opens a text to the number with the message filled in", () => {
    const body = "Hi Jane, this is Acme Lawn Care. Due to the weather, we're moving your Tue, Sep 29 visit to Wed, Sep 30. Thanks! Reply STOP to opt out.";
    const link = smsLink("+16315550142", body);
    expect(link.startsWith("sms:+16315550142?&body=")).toBe(true);
    expect(decodeURIComponent(link.split("&body=")[1])).toBe(body);
  });

  it("encodes characters that would otherwise break the link", () => {
    const link = smsLink("+16315550142", "A & B? 100% #1\nnew line");
    expect(link).toBe("sms:+16315550142?&body=A%20%26%20B%3F%20100%25%20%231%0Anew%20line");
  });
});

describe("formatPhone", () => {
  it("formats US numbers and leaves others alone", () => {
    expect(formatPhone("+16315550100")).toBe("(631) 555-0100");
    expect(formatPhone("+442079460958")).toBe("+442079460958");
  });
});

describe("toE164", () => {
  // The same cases as private.to_e164() in the database.
  it.each([
    ["(631) 555-0142", "+16315550142"],
    ["1-631-555-0142", "+16315550142"],
    ["631.555.0142", "+16315550142"],
    ["+44 20 7946 0958", "+442079460958"],
    ["+1 (631) 555-0142", "+16315550142"],
    ["555-0142", null],
    ["0631555014", null],
    ["", null],
    ["631-555-0142 x12", null],
    ["11631555014", null],
  ])("%j → %j", (phone, e164) => {
    expect(toE164(phone)).toBe(e164);
  });
});
