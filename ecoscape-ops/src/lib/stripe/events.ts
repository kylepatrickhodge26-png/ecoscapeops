// What a Stripe event means for an invoice payment. Plain data in, plain data out, so it
// can be tested without Stripe.

export type CheckoutOutcome = "paid" | "paid_later" | "processing" | "failed" | "expired";

// Checkout events about a payment. A card payment arrives paid with
// checkout.session.completed; a US bank payment arrives unpaid (processing), then clears
// days later with checkout.session.async_payment_succeeded (or fails).
export function checkoutOutcome(eventType: string, paymentStatus: string | null | undefined): CheckoutOutcome | null {
  switch (eventType) {
    case "checkout.session.completed":
      return paymentStatus === "paid" ? "paid" : paymentStatus === "unpaid" ? "processing" : null;
    case "checkout.session.async_payment_succeeded":
      return "paid_later";
    case "checkout.session.async_payment_failed":
      return "failed";
    case "checkout.session.expired":
      return "expired";
    default:
      return null;
  }
}

// Dollars → cents for Stripe, without floating-point surprises (e.g. 19.99 * 100).
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}
