"use server";

import { redirect } from "next/navigation";
import Stripe from "stripe";

import { siteOrigin } from "@/lib/site-origin";
import { stripeClient } from "@/lib/stripe/client";
import { toCents } from "@/lib/stripe/events";
import { createAdminClient } from "@/lib/supabase/admin";

// A customer pressing Pay on their invoice: send them to Stripe's hosted Checkout page for
// the balance, charged directly to the business's own Stripe account. Card and bank
// details are entered on Stripe's page and never reach EcoScape Ops.
export async function startCheckout(token: string): Promise<{ error?: string }> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: "This invoice link isn't valid." };
  const stripe = stripeClient();
  const admin = createAdminClient();
  if (!stripe || !admin) return { error: "Online payment isn't available right now." };

  const { data: invoice, error } = await admin.rpc("begin_invoice_checkout", { token }).single();
  if (error || !invoice) {
    if (error?.code === "22023") return { error: "This invoice is already paid." };
    if (error?.code === "55000") return { error: "Online payment isn't set up for this business yet." };
    if (error?.code !== "P0002") console.error("Starting a checkout failed", error);
    return { error: "This invoice isn't available." };
  }
  // A checkout for the same amount is already open: go back to it rather than start another.
  if (invoice.reusable_url) redirect(invoice.reusable_url);

  const origin = await siteOrigin();
  const params = (paymentMethods: Stripe.Checkout.SessionCreateParams.PaymentMethodType[]): Stripe.Checkout.SessionCreateParams => ({
    mode: "payment",
    payment_method_types: paymentMethods,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: toCents(invoice.amount),
          product_data: { name: `Invoice #${invoice.number} from ${invoice.business_name}` },
        },
      },
    ],
    client_reference_id: invoice.invoice_id,
    metadata: { invoice_id: invoice.invoice_id, business_id: invoice.business_id },
    success_url: `${origin}/pay/${token}?paid=1`,
    cancel_url: `${origin}/pay/${token}`,
  });

  let session: Stripe.Checkout.Session;
  try {
    try {
      session = await stripe.checkout.sessions.create(params(["card", "us_bank_account"]), { stripeAccount: invoice.account_id });
    } catch (e) {
      // The business hasn't turned on bank payments in Stripe: offer card only.
      if (!(e instanceof Stripe.errors.StripeInvalidRequestError) || !e.param?.startsWith("payment_method_types")) throw e;
      session = await stripe.checkout.sessions.create(params(["card"]), { stripeAccount: invoice.account_id });
    }
  } catch (e) {
    console.error("Creating a Stripe Checkout session failed", e);
    return { error: "We couldn't reach Stripe. Please try again in a moment." };
  }
  if (!session.url) return { error: "We couldn't reach Stripe. Please try again in a moment." };

  const { error: recordError } = await admin.rpc("record_checkout_session", {
    session_id: session.id,
    invoice_id: invoice.invoice_id,
    account_id: invoice.account_id,
    amount: invoice.amount,
    url: session.url,
  });
  if (recordError) {
    // Without this record the payment couldn't be matched to the invoice, so don't send
    // the customer to pay.
    console.error("Recording a Stripe Checkout session failed", recordError);
    return { error: "We couldn't start the payment. Please try again." };
  }

  redirect(session.url);
}
