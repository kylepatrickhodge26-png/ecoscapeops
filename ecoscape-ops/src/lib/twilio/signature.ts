import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio signs every webhook request it makes: X-Twilio-Signature is the base64
// HMAC-SHA1, keyed with the account's auth token, of the full URL it called followed by
// each POST parameter's name and value, sorted by name. Checking it is what proves a
// request really came from Twilio (and so from our own account), not from anyone who
// knows the URL. https://www.twilio.com/docs/usage/webhooks/webhooks-security

export type TwilioParams = Record<string, string>;

export function twilioSignature(authToken: string, url: string, params: TwilioParams): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

// The same URL with and without its default port (":443" / ":80"), since Twilio isn't
// consistent about which one it signs. This mirrors Twilio's own validator.
function urlVariants(url: string): string[] {
  const parsed = new URL(url);
  const rest = `${parsed.pathname}${parsed.search}`;
  // (URL parsing drops a default port, so parsed.port is empty for ":443" / ":80".)
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  return [url, `${parsed.protocol}//${parsed.hostname}${rest}`, `${parsed.protocol}//${parsed.hostname}:${port}${rest}`];
}

function sameSignature(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isValidTwilioSignature(
  authToken: string,
  signature: string | null,
  urls: string[],
  params: TwilioParams,
): boolean {
  if (!authToken || !signature) return false;
  return urls
    .flatMap(urlVariants)
    .some((url) => sameSignature(signature, twilioSignature(authToken, url, params)));
}
