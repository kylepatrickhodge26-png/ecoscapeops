import { describe, expect, it } from "vitest";

import { isValidTwilioSignature, twilioSignature, type TwilioParams } from "./signature";

// Expected signatures were computed with Twilio's official Node library
// (twilio@6.1.1, lib/webhooks/webhooks.js getExpectedTwilioSignature). The first is
// also the worked example in Twilio's webhook security docs.
const CASES: { token: string; url: string; params: TwilioParams; signature: string }[] = [
  {
    token: "12345",
    url: "https://mycompany.com/myapp.php?foo=1&bar=2",
    params: { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" },
    signature: "0/KCTR6DLpKmkAf8muzZqo1nDgQ=",
  },
  {
    token: "test-auth-token",
    url: "https://ecoscape.example.com/api/twilio/inbound",
    params: {
      AccountSid: "AC00000000000000000000000000000000",
      Body: "STOP",
      From: "+16315550142",
      MessageSid: "SM11111111111111111111111111111111",
      To: "+16315550100",
      OptOutType: "STOP",
    },
    signature: "ouihYOv47YuxuBWp9pE/EpKPEBI=",
  },
  {
    token: "test-auth-token",
    url: "http://localhost:3000/api/twilio/status",
    params: {
      AccountSid: "AC00000000000000000000000000000000",
      MessageSid: "SM22222222222222222222222222222222",
      MessageStatus: "delivered",
      ErrorCode: "",
    },
    signature: "7eNi4lkTuruyNr9GA45MatuAynI=",
  },
  {
    token: "test-auth-token",
    url: "https://ecoscape.example.com/api/twilio/inbound",
    params: { Body: "Héllo — ✓ unicode", From: "+16315550142" },
    signature: "K+exr0oNmFlTB5DJ9f5HKiI/rkQ=",
  },
];

describe("Twilio webhook signatures", () => {
  it.each(CASES)("matches Twilio's own library for $url", ({ token, url, params, signature }) => {
    expect(twilioSignature(token, url, params)).toBe(signature);
    expect(isValidTwilioSignature(token, signature, [url], params)).toBe(true);
  });

  const { token, url, params, signature } = CASES[1];

  it("rejects a missing or wrong signature", () => {
    expect(isValidTwilioSignature(token, null, [url], params)).toBe(false);
    expect(isValidTwilioSignature(token, "", [url], params)).toBe(false);
    expect(isValidTwilioSignature(token, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=", [url], params)).toBe(false);
  });

  it("rejects a request signed with a different auth token", () => {
    const forged = twilioSignature("someone-elses-token", url, params);
    expect(isValidTwilioSignature(token, forged, [url], params)).toBe(false);
  });

  it("rejects tampered parameters", () => {
    expect(isValidTwilioSignature(token, signature, [url], { ...params, From: "+16315550199" })).toBe(false);
    expect(isValidTwilioSignature(token, signature, [url], { ...params, Extra: "1" })).toBe(false);
  });

  it("rejects a signature meant for another URL", () => {
    expect(isValidTwilioSignature(token, signature, ["https://ecoscape.example.com/api/twilio/status"], params)).toBe(false);
  });

  it("accepts the URL with or without its default port, like Twilio's validator", () => {
    const withPort = twilioSignature("tok", "https://ecoscape.example.com:443/api/twilio/status", { A: "1" });
    // Also computed with twilio@6.1.1.
    expect(withPort).toBe("1tA8CQ+UKlzAEPgFRu8hIvJODR8=");
    expect(isValidTwilioSignature("tok", withPort, ["https://ecoscape.example.com/api/twilio/status"], { A: "1" })).toBe(true);

    const withoutPort = twilioSignature("tok", "https://ecoscape.example.com/api/twilio/status", { A: "1" });
    expect(isValidTwilioSignature("tok", withoutPort, ["https://ecoscape.example.com:443/api/twilio/status"], { A: "1" })).toBe(true);
  });

  it("accepts any of the candidate URLs", () => {
    expect(isValidTwilioSignature(token, signature, ["http://internal:3000/api/twilio/inbound", url], params)).toBe(true);
  });

  it("is never valid without an auth token", () => {
    expect(isValidTwilioSignature("", twilioSignature("", url, params), [url], params)).toBe(false);
  });
});
