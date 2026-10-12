import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { accountFlags } from "./accounts";

const account = (cardStatus: string | null, awaiting: ("user" | "stripe")[]) =>
  ({
    id: "acct_1",
    object: "v2.core.account",
    configuration: cardStatus ? { merchant: { applied: true, capabilities: { card_payments: { status: cardStatus, status_details: [] } } } } : undefined,
    requirements: { entries: awaiting.map((who) => ({ awaiting_action_from: who, description: "Business details" })) },
  }) as unknown as Stripe.V2.Core.Account;

describe("accountFlags", () => {
  it("is ready once card payments are active and nothing is waiting on the business", () => {
    expect(accountFlags(account("active", []))).toEqual({ charges_enabled: true, details_submitted: true });
  });

  it("isn't ready while the business still has details to give", () => {
    expect(accountFlags(account("pending", ["user"]))).toEqual({ charges_enabled: false, details_submitted: false });
  });

  it("knows the details are in while Stripe is still reviewing them", () => {
    expect(accountFlags(account("pending", ["stripe"]))).toEqual({ charges_enabled: false, details_submitted: true });
  });

  it.each(["restricted", "unsupported", null])("can't take payments when card payments are %s", (status) => {
    expect(accountFlags(account(status, [])).charges_enabled).toBe(false);
  });
});
