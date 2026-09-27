import "server-only";

// Sends texts through Twilio's REST API (the Messages resource). The credentials are
// server-only environment variables and never reach the browser.
// https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource

export type TwilioConfig = { accountSid: string; authToken: string; apiBaseUrl: string };

// Null until TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set. TWILIO_API_BASE_URL is
// only for tests, which point it at a fake Twilio.
export function twilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken, apiBaseUrl: process.env.TWILIO_API_BASE_URL || "https://api.twilio.com" };
}

export type SmsToSend = { to: string; from: string; body: string; statusCallback?: string };

export type SendResult =
  | { ok: true; sid: string; status: string }
  | { ok: false; code: number | null; message: string };

export async function sendSms(config: TwilioConfig, sms: SmsToSend): Promise<SendResult> {
  const form = new URLSearchParams({ To: sms.to, From: sms.from, Body: sms.body });
  if (sms.statusCallback) form.set("StatusCallback", sms.statusCallback);
  const url = `${config.apiBaseUrl}/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error("Could not reach Twilio", error);
    return { ok: false, code: null, message: "Could not reach Twilio" };
  }

  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.ok && typeof json?.sid === "string") {
    return { ok: true, sid: json.sid, status: typeof json.status === "string" ? json.status : "queued" };
  }
  return {
    ok: false,
    code: typeof json?.code === "number" ? json.code : null,
    message: typeof json?.message === "string" ? json.message : `Twilio returned HTTP ${response.status}`,
  };
}
