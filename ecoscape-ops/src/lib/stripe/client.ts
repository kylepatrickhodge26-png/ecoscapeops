import "server-only";

import Stripe from "stripe";

// The Stripe API client, using the platform's secret key (a server-only environment
// variable). Null until STRIPE_SECRET_KEY is set. STRIPE_API_BASE_URL is only for tests,
// which point it at a fake Stripe.
export function stripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  const config: Stripe.StripeConfig = { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "EcoScape Ops" } };
  const base = process.env.STRIPE_API_BASE_URL;
  if (base) {
    const url = new URL(base);
    config.host = url.hostname;
    config.port = url.port || (url.protocol === "https:" ? "443" : "80");
    config.protocol = url.protocol === "https:" ? "https" : "http";
  }
  return new Stripe(secretKey, config);
}

// Checks the signature on Stripe's webhook requests. Null until STRIPE_WEBHOOK_SECRET is set.
export const stripeWebhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET || null;

export const isStripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);
