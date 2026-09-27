import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sendSms, twilioConfig, type TwilioConfig } from "./client";

const config: TwilioConfig = { accountSid: "AC123", authToken: "secret-token", apiBaseUrl: "https://api.twilio.com" };
const sms = {
  to: "+16315550142",
  from: "+16315550100",
  body: "Hi Jane, this is Acme Lawn Care.",
  statusCallback: "https://app.example.com/api/twilio/status",
};

function mockFetch(status: number, json: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(json), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sendSms", () => {
  it("posts the text to Twilio's Messages API with basic auth", async () => {
    const fetchMock = mockFetch(201, { sid: "SM123", status: "queued" });
    expect(await sendSms(config, sms)).toEqual({ ok: true, sid: "SM123", status: "queued" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("AC123:secret-token").toString("base64")}`);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      To: sms.to,
      From: sms.from,
      Body: sms.body,
      StatusCallback: sms.statusCallback,
    });
  });

  it("returns Twilio's error code and message when it refuses a text", async () => {
    mockFetch(400, { code: 21610, message: "Attempt to send to unsubscribed recipient", status: 400 });
    expect(await sendSms(config, sms)).toEqual({
      ok: false,
      code: 21610,
      message: "Attempt to send to unsubscribed recipient",
    });
  });

  it("copes with a non-JSON error and with Twilio being unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })));
    expect(await sendSms(config, sms)).toEqual({ ok: false, code: null, message: "Twilio returned HTTP 502" });

    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await sendSms(config, sms)).toEqual({ ok: false, code: null, message: "Could not reach Twilio" });
  });
});

describe("twilioConfig", () => {
  it("is null until both credentials are set", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    expect(twilioConfig()).toBeNull();
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    expect(twilioConfig()).toBeNull();
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret-token");
    vi.stubEnv("TWILIO_API_BASE_URL", "");
    expect(twilioConfig()).toEqual(config);
  });
});
