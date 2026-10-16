import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getUser, requireMembership } from "@/lib/auth";

export const metadata: Metadata = { title: "Welcome · EcoScape Ops" };

// Signed in: everyone goes to their own place (owners and crew to the dashboard, customers to
// their account). Signed out: a welcome screen that asks who you are.
export default async function Home() {
  if (await getUser()) {
    await requireMembership(); // sends customers to /portal, logins with nothing to /onboarding
    redirect("/dashboard");
  }

  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <div className="name">EcoScape Ops</div>
        <div className="sub">Who are you?</div>
      </div>
      <div className="welcome-choices">
        <section className="auth-card welcome-card" aria-labelledby="who-owner">
          <h2 id="who-owner">I run a landscaping business</h2>
          <p className="auth-lede">Schedule visits, manage your crew, send quotes and invoices.</p>
          <div className="welcome-actions">
            <Link className="btn block" href="/signup">
              Create a business account
            </Link>
            <Link className="btn secondary block" href="/login">
              Sign in
            </Link>
          </div>
        </section>
        <section className="auth-card welcome-card" aria-labelledby="who-crew">
          <h2 id="who-crew">I&apos;m on a crew</h2>
          <p className="auth-lede">See the jobs assigned to you. New? Open the invite link your boss sent you.</p>
          <div className="welcome-actions">
            <Link className="btn secondary block" href="/login">
              Sign in
            </Link>
          </div>
        </section>
        <section className="auth-card welcome-card" aria-labelledby="who-customer">
          <h2 id="who-customer">I&apos;m a customer</h2>
          <p className="auth-lede">
            See your upcoming visits, quotes and invoices. New? Open the invite link your landscaper sent you, or ask them for one.
          </p>
          <div className="welcome-actions">
            <Link className="btn secondary block" href="/login?next=/portal">
              Sign in
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
