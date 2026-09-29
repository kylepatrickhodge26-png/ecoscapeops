import { describe, expect, it } from "vitest";

import { formatPhone, smsLink } from "./texts";

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
