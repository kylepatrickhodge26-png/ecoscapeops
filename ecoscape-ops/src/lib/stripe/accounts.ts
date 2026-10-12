import type Stripe from "stripe";

// What EcoScape Ops keeps about a business's connected Stripe account (an Accounts v2
// account): whether it can take card payments yet, and whether Stripe is still waiting
// on the business for anything.
export function accountFlags(account: Stripe.V2.Core.Account) {
  return {
    charges_enabled: account.configuration?.merchant?.capabilities?.card_payments?.status === "active",
    details_submitted: !(account.requirements?.entries ?? []).some((entry) => entry.awaiting_action_from === "user"),
  };
}

// The account fields accountFlags reads, which Accounts v2 only returns when asked.
export const ACCOUNT_INCLUDE: Stripe.V2.Core.AccountRetrieveParams.Include[] = ["configuration.merchant", "requirements"];
