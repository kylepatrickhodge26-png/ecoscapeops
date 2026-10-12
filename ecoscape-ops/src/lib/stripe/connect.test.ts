import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// An in-memory stripe_accounts table behind a stand-in for the service-role client.
const table = new Map<string, { account_id: string; charges_enabled: boolean; details_submitted: boolean }>();
let failUpsert = false;
let failRead = false; // reads fail once something has been saved
let raceWinner: string | null = null; // another click's account, saved just before ours
const admin = {
  from: () => ({
    select: () => ({
      eq: (_: string, businessId: string) => ({
        maybeSingle: async () =>
          failRead && table.size > 0 ? { data: null, error: new Error("connection reset") } : { data: table.get(businessId) ?? null, error: null },
      }),
    }),
    upsert: async ({ business_id, ...row }: { business_id: string; account_id: string; charges_enabled: boolean; details_submitted: boolean }) => {
      if (failUpsert) return { error: new Error("database unavailable") };
      if (raceWinner) table.set(business_id, { account_id: raceWinner, charges_enabled: false, details_submitted: false });
      if (!table.has(business_id)) table.set(business_id, row);
      return { error: null };
    },
    update: (values: { charges_enabled: boolean; details_submitted: boolean }) => ({
      eq: async (_: string, businessId: string) => {
        Object.assign(table.get(businessId)!, values);
        return { error: null };
      },
    }),
  }),
};

// A stand-in Stripe client: Accounts v2 only. v1 account creation throws, as Stripe now refuses it.
let created = 0;
const stripe = {
  accounts: {
    create: vi.fn(async () => {
      throw new Error("Stripe no longer recommends Accounts v1 for new Connect integrations.");
    }),
  },
  v2: {
    core: {
      accounts: {
        create: vi.fn<(params: unknown) => Promise<object>>(async () => ({
          id: `acct_new${++created}`,
          configuration: { merchant: { capabilities: { card_payments: { status: "pending" } } } },
          requirements: { entries: [{ awaiting_action_from: "user" }] },
        })),
        retrieve: vi.fn(async (id: string) => ({
          id,
          configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } },
          requirements: { entries: [] },
        })),
        close: vi.fn<(id: string, params: unknown) => Promise<object>>(async () => ({})),
      },
      accountLinks: {
        create: vi.fn(async ({ account }: { account: string }) => ({ url: `https://connect.stripe.test/setup/${account}` })),
      },
    },
  },
};

vi.mock("./client", () => ({ stripeClient: () => stripe }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

const { stripeOnboardingLink, syncStripeAccount } = await import("./connect");

const membership = {
  user: { id: "u1", email: "owner@example.com" },
  role: "owner" as const,
  business: { id: "biz-1", name: "Green Acres Lawn Care", time_zone: "America/New_York" },
};
const ORIGIN = "https://app.example.com";

beforeEach(() => {
  table.clear();
  failUpsert = false;
  failRead = false;
  raceWinner = null;
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("stripeOnboardingLink", () => {
  it("creates an Accounts v2 account with its own Stripe Dashboard that pays its own fees, then links to Stripe's onboarding", async () => {
    const result = await stripeOnboardingLink(membership, ORIGIN);

    expect(stripe.accounts.create).not.toHaveBeenCalled();
    expect(stripe.v2.core.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: "Green Acres Lawn Care",
        contact_email: "owner@example.com",
        identity: { country: "us" },
        dashboard: "full",
        defaults: { currency: "usd", responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
        configuration: { merchant: { capabilities: { card_payments: { requested: true }, ach_debit_payments: { requested: true } } } },
        metadata: { business_id: "biz-1" },
      }),
    );
    const accountId = table.get("biz-1")!.account_id;
    expect(table.get("biz-1")).toEqual({ account_id: accountId, charges_enabled: false, details_submitted: false });
    expect(stripe.v2.core.accountLinks.create).toHaveBeenCalledWith({
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          refresh_url: `${ORIGIN}/invoices/stripe/refresh`,
          return_url: `${ORIGIN}/invoices/stripe/return`,
        },
      },
    });
    expect(result).toEqual({ url: `https://connect.stripe.test/setup/${accountId}` });
  });

  it("continues with the business's existing account instead of making another", async () => {
    table.set("biz-1", { account_id: "acct_existing", charges_enabled: false, details_submitted: false });
    expect(await stripeOnboardingLink(membership, ORIGIN)).toEqual({ url: "https://connect.stripe.test/setup/acct_existing" });
    expect(stripe.v2.core.accounts.create).not.toHaveBeenCalled();
  });

  it("closes the new account again when it can't be saved, so a retry doesn't leave two", async () => {
    failUpsert = true;
    expect(await stripeOnboardingLink(membership, ORIGIN)).toEqual({ error: expect.stringContaining("couldn't reach Stripe") });
    const [[newId]] = stripe.v2.core.accounts.close.mock.calls;
    expect(newId).toMatch(/^acct_new/);
    expect(stripe.v2.core.accountLinks.create).not.toHaveBeenCalled();
  });

  it("keeps the new account when it can't tell whether it was saved", async () => {
    failRead = true;
    expect(await stripeOnboardingLink(membership, ORIGIN)).toEqual({ error: expect.stringContaining("couldn't reach Stripe") });
    expect(table.get("biz-1")!.account_id).toMatch(/^acct_new/);
    expect(stripe.v2.core.accounts.close).not.toHaveBeenCalled();
  });

  it("uses the account a second click saved first, and closes its own", async () => {
    raceWinner = "acct_first_click";
    expect(await stripeOnboardingLink(membership, ORIGIN)).toEqual({ url: "https://connect.stripe.test/setup/acct_first_click" });
    expect(stripe.v2.core.accounts.close).toHaveBeenCalledTimes(1);
    expect(stripe.v2.core.accounts.close.mock.calls[0][0]).not.toBe("acct_first_click");
  });

  it("explains instead of crashing when Stripe refuses", async () => {
    stripe.v2.core.accounts.create.mockRejectedValueOnce(new Error("You must sign up for Connect first"));
    expect(await stripeOnboardingLink(membership, ORIGIN)).toEqual({
      error: "We couldn't reach Stripe to set up online payments. Please try again.",
    });
    expect(table.size).toBe(0);
  });
});

describe("syncStripeAccount", () => {
  it("reads the account with the fields it needs and saves whether it can take payments", async () => {
    table.set("biz-1", { account_id: "acct_existing", charges_enabled: false, details_submitted: false });
    expect(await syncStripeAccount("biz-1")).toEqual({ charges_enabled: true, details_submitted: true });
    expect(stripe.v2.core.accounts.retrieve).toHaveBeenCalledWith("acct_existing", { include: ["configuration.merchant", "requirements"] });
    expect(table.get("biz-1")).toEqual({ account_id: "acct_existing", charges_enabled: true, details_submitted: true });
  });

  it("does nothing for a business that hasn't connected Stripe", async () => {
    expect(await syncStripeAccount("biz-1")).toBeNull();
    expect(stripe.v2.core.accounts.retrieve).not.toHaveBeenCalled();
  });
});
