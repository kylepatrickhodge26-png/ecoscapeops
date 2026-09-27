import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { twilioConfig } from "./client";
import { isValidTwilioSignature, type TwilioParams } from "./signature";

// The URLs Twilio may have signed for this request: the one the server saw, and the
// public one rebuilt from the proxy's forwarding headers (they differ behind some hosts).
function candidateUrls(request: Request): string[] {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
  return host ? [request.url, `${proto}://${host}${url.pathname}${url.search}`] : [request.url];
}

type Verified =
  | { ok: true; params: TwilioParams; admin: NonNullable<ReturnType<typeof createAdminClient>> }
  | { ok: false; response: Response };

// Accepts a webhook only if Twilio signed it with our auth token and it's about our own
// Twilio account. Everything else gets a 403 and changes nothing.
export async function verifyTwilioRequest(request: Request): Promise<Verified> {
  const config = twilioConfig();
  const admin = createAdminClient();
  if (!config || !admin) {
    console.error("Twilio webhook received, but Twilio or SUPABASE_SECRET_KEY isn't configured");
    return { ok: false, response: new Response("Not configured", { status: 503 }) };
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, response: new Response("Bad request", { status: 400 }) };
  }
  const params: TwilioParams = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });

  const signature = request.headers.get("x-twilio-signature");
  if (!isValidTwilioSignature(config.authToken, signature, candidateUrls(request), params)) {
    return { ok: false, response: new Response("Invalid signature", { status: 403 }) };
  }
  if (params.AccountSid !== config.accountSid) {
    return { ok: false, response: new Response("Wrong account", { status: 403 }) };
  }
  return { ok: true, params, admin };
}
