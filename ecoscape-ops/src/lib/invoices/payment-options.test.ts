import { describe, expect, it } from "vitest";

import { isSecureLink, payOptions, paymentOptionsSchema, paymentOptionsSummary, type PaymentOptions } from "./payment-options";

const blank = { venmo: "", cash_app: "", paypal: "", zelle: "", pay_link: "", payment_note: "" };
const parse = (input: Partial<typeof blank>) => paymentOptionsSchema.safeParse({ ...blank, ...input });
const none: PaymentOptions = { venmo: null, cash_app: null, paypal: null, zelle: null, pay_link: null, payment_note: "" };

describe("paymentOptionsSchema", () => {
  it("treats blank fields as not used", () => {
    expect(parse({}).data).toEqual(none);
  });

  it("drops the @ and $ people type, and the PayPal.Me address people paste", () => {
    expect(parse({ venmo: " @Green-Acres_1 ", cash_app: "$GreenAcres", paypal: "https://www.paypal.me/GreenAcres/" }).data).toMatchObject({
      venmo: "Green-Acres_1",
      cash_app: "GreenAcres",
      paypal: "GreenAcres",
    });
  });

  it("keeps a Zelle email in lower case and a Zelle phone in +1 form", () => {
    expect(parse({ zelle: "Pay@GreenAcres.com" }).data?.zelle).toBe("pay@greenacres.com");
    expect(parse({ zelle: "(631) 555-0100" }).data?.zelle).toBe("+16315550100");
  });

  it.each([
    ["venmo", "abc", "Venmo username"],
    ["venmo", "green acres", "Venmo username"],
    ["venmo", "x".repeat(31), "Venmo username"],
    ["cash_app", "$12345", "$cashtag"],
    ["cash_app", "green-acres", "$cashtag"],
    ["paypal", "green.acres", "PayPal.Me"],
    ["zelle", "not an email", "Zelle"],
    ["zelle", "+44 20 7946 0958", "Zelle"],
    ["pay_link", "http://square.link/u/abc", "https://"],
    ["pay_link", "javascript:alert(1)", "https://"],
    ["pay_link", 'https://example.com/"><script>', "https://"],
    ["payment_note", "x".repeat(301), "300 characters"],
  ] as const)("refuses %s %j", (field, value, message) => {
    const result = parse({ [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain(message);
  });
});

describe("isSecureLink", () => {
  it.each([
    ["https://square.link/u/AbC123", true],
    ["https://checkout.square.site/merchant/ML1/checkout/X?src=sms", true],
    ["http://square.link/u/AbC123", false],
    ["javascript:alert(1)", false],
    ["https://", false],
    ["https://ex ample.com", false],
  ])("%s → %s", (link, ok) => {
    expect(isSecureLink(link)).toBe(ok);
  });
});

describe("payOptions", () => {
  const all: PaymentOptions = {
    venmo: "Green-Acres",
    cash_app: "GreenAcres",
    paypal: "GreenAcres",
    zelle: "+16315550100",
    pay_link: "https://square.link/u/AbC123",
    payment_note: "Checks payable to Green Acres LLC",
  };

  it("offers each app with the amount filled in, and Zelle with who to send it to", () => {
    expect(payOptions(all, 65, "Invoice #1001")).toEqual([
      { app: "venmo", label: "Venmo", href: "https://venmo.com/Green-Acres?txn=pay&amount=65.00&note=Invoice+%231001", detail: "@Green-Acres" },
      { app: "cash_app", label: "Cash App", href: "https://cash.app/$GreenAcres/65.00", detail: "$GreenAcres" },
      { app: "paypal", label: "PayPal", href: "https://paypal.me/GreenAcres/65.00USD", detail: "paypal.me/GreenAcres" },
      { app: "zelle", label: "Zelle", send_to: "(631) 555-0100", detail: "(631) 555-0100" },
      { app: "pay_link", label: "Pay online", href: "https://square.link/u/AbC123", detail: "square.link" },
    ]);
  });

  it("asks for what's still owed, to the cent", () => {
    const [venmo, cashApp] = payOptions({ ...none, venmo: "Green-Acres", cash_app: "GreenAcres" }, 32.5, "Invoice #1002");
    expect(venmo).toMatchObject({ href: expect.stringContaining("amount=32.50") });
    expect(cashApp).toMatchObject({ href: "https://cash.app/$GreenAcres/32.50" });
  });

  it("shows a Zelle email as it is", () => {
    expect(payOptions({ ...none, zelle: "pay@greenacres.com" }, 10, "Invoice #1")).toEqual([
      { app: "zelle", label: "Zelle", send_to: "pay@greenacres.com", detail: "pay@greenacres.com" },
    ]);
  });

  it("never turns an unsafe link into a button", () => {
    expect(payOptions({ ...none, pay_link: "javascript:alert(1)" }, 10, "Invoice #1")).toEqual([]);
  });

  it("is empty when the business hasn't set anything up", () => {
    expect(payOptions(none, 65, "Invoice #1001")).toEqual([]);
  });
});

describe("paymentOptionsSummary", () => {
  it("lists what's set up", () => {
    expect(paymentOptionsSummary(none)).toBeNull();
    expect(paymentOptionsSummary({ ...none, zelle: "a@b.co" })).toBe("Zelle");
    expect(paymentOptionsSummary({ ...none, venmo: "Green-Acres", cash_app: "GA", pay_link: "https://x.co" })).toBe(
      "Venmo, Cash App and your payment link",
    );
  });
});
