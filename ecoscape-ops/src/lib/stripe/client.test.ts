import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isStripeConfigured, stripeClient, stripeWebhookSecret } from "./client";

afterEach(() => vi.unstubAllEnvs());

describe("stripeClient", () => {
  it("is null until the secret key is set", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(stripeClient()).toBeNull();
    expect(isStripeConfigured()).toBe(false);
  });

  it("talks to Stripe by default, or to a fake Stripe in tests", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("STRIPE_API_BASE_URL", "");
    expect(isStripeConfigured()).toBe(true);
    const real = stripeClient() as unknown as { _api: { host: string } };
    expect(real._api.host).toBe("api.stripe.com");

    vi.stubEnv("STRIPE_API_BASE_URL", "http://127.0.0.1:4010");
    const fake = stripeClient() as unknown as { _api: { host: string; port: string; protocol: string } };
    expect(fake._api).toMatchObject({ host: "127.0.0.1", port: "4010", protocol: "http" });
  });

  it("verifies webhooks only once the signing secret is set", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(stripeWebhookSecret()).toBeNull();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_123");
    expect(stripeWebhookSecret()).toBe("whsec_123");
  });
});
