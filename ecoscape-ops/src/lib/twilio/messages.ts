import type { Enums } from "@/lib/supabase/database.types";

export type SmsStatus = Enums<"sms_status">;

export const SMS_STATUS_LABELS: Record<SmsStatus, string> = {
  sending: "Sending…",
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  undelivered: "Not delivered",
  failed: "Failed",
};

export const SMS_STATUS_TONES: Record<SmsStatus, "ok" | "pending" | "bad"> = {
  sending: "pending",
  queued: "pending",
  sent: "ok",
  delivered: "ok",
  undelivered: "bad",
  failed: "bad",
};

// Twilio's standard opt-out keywords. Carriers and Twilio treat a reply that is exactly
// one of these as "stop texting me".
// https://help.twilio.com/articles/223134027-Twilio-support-for-opt-out-keywords-SMS-STOP-filtering-
const OPT_OUT_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"]);

// Whether an incoming text asks us to stop. Twilio also flags these itself (OptOutType)
// when Advanced Opt-Out is on for the number.
export function isOptOutMessage(body: string | null | undefined, optOutType?: string | null): boolean {
  if (optOutType?.toUpperCase() === "STOP") return true;
  const word = (body ?? "").trim().replace(/[.!]+$/, "").toUpperCase();
  return OPT_OUT_KEYWORDS.has(word);
}

// Plain-English reasons for the Twilio errors a landscaping business is most likely to
// see. https://www.twilio.com/docs/api/errors
const ERROR_DESCRIPTIONS: Record<number, string> = {
  21211: "Not a valid phone number",
  21408: "Texting to this country isn't enabled",
  21610: "Replied STOP, so they're opted out now",
  21612: "This number can't receive texts",
  21614: "Not a mobile number",
  21608: "Trial account: this number isn't verified in Twilio",
  30003: "Phone unreachable (off or out of service)",
  30004: "Blocked by the recipient",
  30005: "Unknown number",
  30006: "Landline or unreachable carrier",
  30007: "Blocked by the carrier's spam filter",
  30008: "Unknown carrier error",
  30032: "Toll-free number isn't verified yet",
  30034: "Blocked: the texting number's US registration (A2P 10DLC) isn't approved yet",
};

export function describeSmsError(code: number | null, fallback?: string | null): string | null {
  if (code != null && ERROR_DESCRIPTIONS[code]) return ERROR_DESCRIPTIONS[code];
  if (fallback) return fallback;
  return code != null ? `Twilio error ${code}` : null;
}

// "+16315550100" → "(631) 555-0100"; other countries stay as they are.
export function formatPhone(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}
