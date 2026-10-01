import { redirect } from "next/navigation";

import { requireOwner } from "@/lib/auth";
import { syncStripeAccount } from "@/lib/stripe/connect";

// Stripe sends the owner back here after onboarding.
export async function GET() {
  const { business } = await requireOwner();
  await syncStripeAccount(business.id);
  redirect("/invoices?notice=stripe");
}
