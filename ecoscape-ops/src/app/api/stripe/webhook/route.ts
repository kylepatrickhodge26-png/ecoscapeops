import { stripeClient, stripeWebhookSecret } from "@/lib/stripe/client";
import { handleStripeEvent } from "@/lib/stripe/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe's webhook (a Connect endpoint listening to connected accounts): payments on
// invoices, and connected accounts finishing their setup. Nothing is trusted unless
// Stripe's signature checks out.
export async function POST(request: Request) {
  const stripe = stripeClient();
  const secret = stripeWebhookSecret();
  const admin = createAdminClient();
  if (!stripe || !secret || !admin) {
    console.error("Stripe webhook received, but Stripe or SUPABASE_SECRET_KEY isn't configured");
    return new Response("Not configured", { status: 503 });
  }

  const payload = await request.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event, admin);
    await admin.rpc("record_stripe_event", { event_id: event.id, event_type: event.type });
    return Response.json({ received: true, result });
  } catch (error) {
    console.error("Handling a Stripe event failed", error);
    return new Response("Could not handle event", { status: 500 });
  }
}
