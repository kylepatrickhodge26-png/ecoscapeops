import { verifyTwilioRequest } from "@/lib/twilio/webhook";

// Twilio's delivery updates for the texts we send (the StatusCallback on each message):
// queued → sent → delivered, or undelivered / failed with an error code.
export async function POST(request: Request) {
  const verified = await verifyTwilioRequest(request);
  if (!verified.ok) return verified.response;

  const { MessageSid, MessageStatus, ErrorCode } = verified.params;
  if (!MessageSid || !MessageStatus) return new Response("Missing MessageSid or MessageStatus", { status: 400 });

  const errorCode = Number.parseInt(ErrorCode ?? "", 10);
  const { error } = await verified.admin.rpc("twilio_message_status", {
    message_sid: MessageSid,
    message_status: MessageStatus,
    ...(Number.isFinite(errorCode) ? { error_code: errorCode } : {}),
  });
  if (error) {
    console.error("Recording a Twilio status update failed", error);
    return new Response("Could not record status", { status: 500 });
  }
  return new Response(null, { status: 204 });
}
