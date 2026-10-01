import { redirect } from "next/navigation";

import { requireOwner } from "@/lib/auth";
import { siteOrigin } from "@/lib/site-origin";
import { stripeOnboardingLink } from "@/lib/stripe/connect";

// Stripe sends the owner here when an onboarding link has expired: make a fresh one.
export async function GET() {
  const membership = await requireOwner();
  const result = await stripeOnboardingLink(membership, await siteOrigin());
  redirect("url" in result ? result.url : "/invoices?notice=stripe-error");
}
