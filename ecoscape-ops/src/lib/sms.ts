// Texts to customers (weather delays, invoices) are sent from the owner's own phone: an
// sms: link opens their Messages app with the number and message already filled in.

// "?&body=" works on both iPhone (which reads "&body=") and Android (which reads the
// query string), so one link suits either phone.
export function smsLink(e164: string, body: string): string {
  return `sms:${e164}?&body=${encodeURIComponent(body)}`;
}

// "+16315550100" → "(631) 555-0100"; other countries stay as they are.
export function formatPhone(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}

// A phone number as typed on a customer record, in +15551234567 form, or null if it can't
// be a mobile number. Mirrors private.to_e164() in the database: US/Canada numbers may be
// written any way; other countries need a leading +.
export function toE164(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if ((phone ?? "").trim().startsWith("+")) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  if (/^[2-9]\d{9}$/.test(digits)) return `+1${digits}`;
  if (/^1[2-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}
