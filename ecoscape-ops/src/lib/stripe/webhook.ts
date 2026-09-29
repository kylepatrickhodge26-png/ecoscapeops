import "server-only";

import type Stripe from "stripe";

import type { createAdminClient } from "@/lib/supabase/admin";

import { checkoutOutcome } from "./events";

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

// Applies a verified Stripe event. Only events from connected accounts matter here (our
// Checkout sessions are direct charges on each business's own account). Throws on a
// database error so the webhook answers 500 and Stripe tries again; handling an event
// twice is harmless, because a checkout records at most one payment.
export async function handleStripeEvent(event: Stripe.Event, admin: Admin): Promise<string> {
  if (!event.account) return "ignored: not from a connected account";

  if (event.type.startsWith("checkout.session.")) {
    const session = event.data.object as Stripe.Checkout.Session;
    const outcome = checkoutOutcome(event.type, session.payment_status);
    if (!outcome) return "ignored";
    const { data, error } = await admin.rpc("apply_checkout_event", {
      session_id: session.id,
      account_id: event.account,
      outcome,
      ...(session.amount_total != null ? { amount_cents: session.amount_total } : {}),
    });
    if (error) throw new Error(`Could not apply ${event.type}: ${error.message}`);
    return data;
  }

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const { error } = await admin
      .from("stripe_accounts")
      .update({ charges_enabled: account.charges_enabled ?? false, details_submitted: account.details_submitted ?? false })
      .eq("account_id", account.id);
    if (error) throw new Error(`Could not update the Stripe account: ${error.message}`);
    return "account updated";
  }

  return "ignored";
}
