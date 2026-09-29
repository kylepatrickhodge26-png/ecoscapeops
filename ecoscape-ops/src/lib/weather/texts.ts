// Weather texts are sent from the owner's own phone: an sms: link opens their Messages
// app with the customer's number and message already filled in.

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
