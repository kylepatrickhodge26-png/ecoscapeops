import "server-only";

import type Stripe from "stripe";

import type { Membership } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

import { ACCOUNT_INCLUDE, accountFlags } from "./accounts";
import { stripeClient } from "./client";

// Stripe Connect onboarding. Each business gets its own Stripe account with its own
// Stripe Dashboard; it pays Stripe's fees itself and is paid directly (so EcoScape Ops
// never holds anyone's money). Stripe's own hosted pages collect the business and bank
// details. Accounts are created with Stripe's Accounts v2 API: Stripe refuses v1 account
// creation for new Connect platforms.

const NOT_CONFIGURED = "Online payments aren't connected yet (the server has no Stripe keys).";

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

export async function stripeOnboardingLink(membership: Membership, origin: string): Promise<{ url: string } | { error: string }> {
  const stripe = stripeClient();
  const admin = createAdminClient();
  if (!stripe || !admin) return { error: NOT_CONFIGURED };

  try {
    const accountId = (await storedAccountId(admin, membership.business.id)) ?? (await createAccount(stripe, admin, membership));
    const link = await stripe.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          refresh_url: `${origin}/invoices/stripe/refresh`,
          return_url: `${origin}/invoices/stripe/return`,
        },
      },
    });
    return { url: link.url };
  } catch (error) {
    console.error("Starting Stripe onboarding failed", error);
    return { error: "We couldn't reach Stripe to set up online payments. Please try again." };
  }
}

async function storedAccountId(admin: Admin, businessId: string): Promise<string | null> {
  const { data, error } = await admin.from("stripe_accounts").select("account_id").eq("business_id", businessId).maybeSingle();
  if (error) throw error;
  return data?.account_id ?? null;
}

// Creates the business's Stripe account and saves it. No idempotency key of our own:
// Stripe would replay a failed attempt's error for a day, even after the problem was
// fixed. Instead, an account that wasn't saved, or that lost a race with a second click,
// is closed again, so a business only ever keeps one.
async function createAccount(stripe: Stripe, admin: Admin, { business, user }: Membership): Promise<string> {
  const account = await stripe.v2.core.accounts.create({
    display_name: business.name,
    contact_email: user.email || undefined,
    identity: { country: "us" },
    dashboard: "full",
    defaults: { currency: "usd", responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
    configuration: {
      merchant: { capabilities: { card_payments: { requested: true }, ach_debit_payments: { requested: true } } },
    },
    metadata: { business_id: business.id },
    include: ACCOUNT_INCLUDE,
  });

  const { error: saveError } = await admin
    .from("stripe_accounts")
    .upsert({ business_id: business.id, account_id: account.id, ...accountFlags(account) }, { onConflict: "business_id", ignoreDuplicates: true });
  // If this read fails we can't tell whether the account was saved, so it's kept: closing
  // the business's only account would be worse than leaving a spare.
  const saved = await storedAccountId(admin, business.id);
  if (saved !== account.id) await closeAccount(stripe, account.id);
  if (!saved) throw saveError ?? new Error("The new Stripe account wasn't saved");
  return saved;
}

async function closeAccount(stripe: Stripe, accountId: string) {
  try {
    await stripe.v2.core.accounts.close(accountId, { applied_configurations: ["merchant"] });
  } catch (error) {
    console.error(`Closing unused Stripe account ${accountId} failed`, error);
  }
}

// Refreshes whether a business's account can take payments yet, and returns the new
// state (null if it couldn't). Runs when the owner comes back from Stripe's onboarding,
// and when they open Invoices while Stripe is still reviewing the account (the
// account.updated webhook also keeps it up to date).
export async function syncStripeAccount(businessId: string): Promise<ReturnType<typeof accountFlags> | null> {
  const stripe = stripeClient();
  const admin = createAdminClient();
  if (!stripe || !admin) return null;
  try {
    const accountId = await storedAccountId(admin, businessId);
    if (!accountId) return null;
    const account = await stripe.v2.core.accounts.retrieve(accountId, { include: ACCOUNT_INCLUDE });
    const flags = accountFlags(account);
    const { error } = await admin.from("stripe_accounts").update(flags).eq("business_id", businessId);
    if (error) throw error;
    return flags;
  } catch (error) {
    console.error("Refreshing the Stripe account failed", error);
    return null;
  }
}
