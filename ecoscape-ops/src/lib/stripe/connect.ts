import "server-only";

import type { Membership } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

import { stripeClient } from "./client";

// Stripe Connect onboarding. Each business gets its own Stripe account with its own
// Stripe Dashboard; it pays Stripe's fees itself and is paid directly (so EcoScape Ops
// never holds anyone's money). Stripe's own hosted pages collect the business and bank
// details.

const NOT_CONFIGURED = "Online payments aren't connected yet (the server has no Stripe keys).";

export async function stripeOnboardingLink(membership: Membership, origin: string): Promise<{ url: string } | { error: string }> {
  const stripe = stripeClient();
  const admin = createAdminClient();
  if (!stripe || !admin) return { error: NOT_CONFIGURED };
  const { business, user } = membership;

  try {
    const { data: existing, error } = await admin
      .from("stripe_accounts")
      .select("account_id")
      .eq("business_id", business.id)
      .maybeSingle();
    if (error) throw error;

    let accountId = existing?.account_id;
    if (!accountId) {
      const account = await stripe.accounts.create(
        {
          country: "US",
          email: user.email || undefined,
          business_profile: { name: business.name },
          controller: {
            stripe_dashboard: { type: "full" },
            fees: { payer: "account" },
            losses: { payments: "stripe" },
            requirement_collection: "stripe",
          },
          metadata: { business_id: business.id },
        },
        // Retrying (e.g. after a failure below) gets the same account back, not a second one.
        { idempotencyKey: `ecoscape-connect-${business.id}` },
      );
      const { error: saveError } = await admin.from("stripe_accounts").upsert(
        {
          business_id: business.id,
          account_id: account.id,
          charges_enabled: account.charges_enabled ?? false,
          details_submitted: account.details_submitted ?? false,
        },
        { onConflict: "business_id", ignoreDuplicates: true },
      );
      if (saveError) throw saveError;
      accountId = account.id;
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${origin}/invoices/stripe/refresh`,
      return_url: `${origin}/invoices/stripe/return`,
    });
    return { url: link.url };
  } catch (error) {
    console.error("Starting Stripe onboarding failed", error);
    return { error: "We couldn't reach Stripe to set up online payments. Please try again." };
  }
}

// Refreshes whether a business's account can take payments yet (also kept up to date by
// the account.updated webhook).
export async function syncStripeAccount(businessId: string): Promise<void> {
  const stripe = stripeClient();
  const admin = createAdminClient();
  if (!stripe || !admin) return;
  const { data } = await admin.from("stripe_accounts").select("account_id").eq("business_id", businessId).maybeSingle();
  if (!data) return;
  try {
    const account = await stripe.accounts.retrieve(data.account_id);
    await admin
      .from("stripe_accounts")
      .update({ charges_enabled: account.charges_enabled ?? false, details_submitted: account.details_submitted ?? false })
      .eq("business_id", businessId);
  } catch (error) {
    console.error("Refreshing the Stripe account failed", error);
  }
}
