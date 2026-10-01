import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { handleStripeEvent } from "./webhook";

// A stand-in for the service-role client that records what it's asked to do.
function fakeAdmin(rpcResult: { data?: unknown; error?: unknown } = { data: "recorded", error: null }) {
  const calls: { rpc?: [string, unknown]; update?: [string, unknown, unknown] }[] = [];
  const admin = {
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.push({ rpc: [name, args] });
      return rpcResult;
    }),
    from: vi.fn((table: string) => ({
      update: (values: unknown) => ({
        eq: async (column: string, value: unknown) => {
          calls.push({ update: [table, values, { [column]: value }] });
          return { error: null };
        },
      }),
    })),
  };
  return { admin: admin as never, calls };
}

const event = (type: string, object: Record<string, unknown>, account: string | null = "acct_123") =>
  ({ id: "evt_1", object: "event", type, account, data: { object } }) as unknown as Stripe.Event;

describe("handleStripeEvent", () => {
  it("records a paid checkout on the account it came from, for the amount Stripe charged", async () => {
    const { admin, calls } = fakeAdmin();
    const result = await handleStripeEvent(
      event("checkout.session.completed", { id: "cs_test_1", payment_status: "paid", amount_total: 6500, metadata: { invoice_id: "ignored" } }),
      admin,
    );
    expect(result).toBe("recorded");
    // The invoice is found from our own record of the checkout, never from the event's metadata.
    expect(calls).toEqual([
      { rpc: ["apply_checkout_event", { session_id: "cs_test_1", account_id: "acct_123", outcome: "paid", amount_cents: 6500 }] },
    ]);
  });

  it("follows a bank payment through processing and clearing", async () => {
    const { admin, calls } = fakeAdmin({ data: "processing", error: null });
    await handleStripeEvent(event("checkout.session.completed", { id: "cs_1", payment_status: "unpaid", amount_total: 100 }), admin);
    await handleStripeEvent(event("checkout.session.async_payment_succeeded", { id: "cs_1", payment_status: "paid", amount_total: 100 }), admin);
    expect(calls.map((c) => (c.rpc![1] as { outcome: string }).outcome)).toEqual(["processing", "paid_later"]);
  });

  it("updates whether a connected account can take payments", async () => {
    const { admin, calls } = fakeAdmin();
    await handleStripeEvent(event("account.updated", { id: "acct_123", charges_enabled: true, details_submitted: true }), admin);
    expect(calls).toEqual([{ update: ["stripe_accounts", { charges_enabled: true, details_submitted: true }, { account_id: "acct_123" }] }]);
  });

  it("ignores events that aren't from a connected account, or that don't matter", async () => {
    const { admin, calls } = fakeAdmin();
    expect(await handleStripeEvent(event("checkout.session.completed", { id: "cs_1", payment_status: "paid" }, null), admin)).toMatch(/^ignored/);
    expect(await handleStripeEvent(event("customer.created", { id: "cus_1" }), admin)).toBe("ignored");
    expect(await handleStripeEvent(event("checkout.session.completed", { id: "cs_1", payment_status: "no_payment_required" }), admin)).toBe("ignored");
    expect(calls).toEqual([]);
  });

  it("fails loudly on a database error, so Stripe sends the event again", async () => {
    const { admin } = fakeAdmin({ data: null, error: { message: "connection lost" } });
    await expect(
      handleStripeEvent(event("checkout.session.completed", { id: "cs_1", payment_status: "paid", amount_total: 100 }), admin),
    ).rejects.toThrow(/connection lost/);
  });
});
