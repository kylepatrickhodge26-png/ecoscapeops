import { describe, expect, it } from "vitest";

import { describeSmsError, formatPhone, isOptOutMessage } from "./messages";

describe("isOptOutMessage", () => {
  it.each(["STOP", "stop", " Stop ", "STOP!", "stopall", "UNSUBSCRIBE", "cancel", "End", "QUIT", "revoke", "OPTOUT"])(
    "treats %j as opting out",
    (body) => expect(isOptOutMessage(body)).toBe(true),
  );

  it.each(["", "Thanks!", "please stop by tomorrow", "Don't stop", "STOP IT", "START", "HELP", "yes"])(
    "doesn't treat %j as opting out",
    (body) => expect(isOptOutMessage(body)).toBe(false),
  );

  it("trusts Twilio's own opt-out flag", () => {
    expect(isOptOutMessage("arrêt", "STOP")).toBe(true);
    expect(isOptOutMessage("START", "START")).toBe(false);
    expect(isOptOutMessage(null, null)).toBe(false);
  });
});

describe("describeSmsError", () => {
  it("explains common errors in plain English", () => {
    expect(describeSmsError(21610)).toBe("Replied STOP, so they're opted out now");
    expect(describeSmsError(30034)).toMatch(/A2P 10DLC/);
  });

  it("falls back to Twilio's message, then the code", () => {
    expect(describeSmsError(12345, "Something odd")).toBe("Something odd");
    expect(describeSmsError(12345)).toBe("Twilio error 12345");
    expect(describeSmsError(null, "Could not reach Twilio")).toBe("Could not reach Twilio");
    expect(describeSmsError(null)).toBeNull();
  });
});

describe("formatPhone", () => {
  it("formats US numbers and leaves others alone", () => {
    expect(formatPhone("+16315550100")).toBe("(631) 555-0100");
    expect(formatPhone("+442079460958")).toBe("+442079460958");
  });
});
