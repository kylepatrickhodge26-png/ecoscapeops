import { isOptOutMessage } from "@/lib/twilio/messages";
import { verifyTwilioRequest } from "@/lib/twilio/webhook";

// Texts customers send to a business's number ("A message comes in" webhook in Twilio).
// A STOP reply turns off that customer's SMS opt-in, for the business that owns the
// number only. Twilio itself sends the "you've been unsubscribed" confirmation.
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export async function POST(request: Request) {
  const verified = await verifyTwilioRequest(request);
  if (!verified.ok) return verified.response;

  const { To, From, Body, OptOutType } = verified.params;
  if (To && From && isOptOutMessage(Body, OptOutType)) {
    const { error } = await verified.admin.rpc("twilio_opt_out", { to_number: To, from_number: From });
    if (error) {
      console.error("Recording a STOP reply failed", error);
      return new Response("Could not record opt-out", { status: 500 });
    }
  }

  // No automatic reply to anything else.
  return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}
