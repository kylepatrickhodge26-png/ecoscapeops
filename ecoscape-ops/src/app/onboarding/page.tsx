import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { signOut } from "../(auth)/actions";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your business · EcoScape Ops" };

// Only reached by a signed-in user who has no business yet (normally the business is
// created at signup).
export default async function OnboardingPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership) redirect("/customers");

  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <div className="name">EcoScape Ops</div>
      </div>
      <div className="auth-card">
        <h1>Set up your business</h1>
        <p className="auth-lede">Signed in as {user.email}. What&apos;s your business called?</p>
        <OnboardingForm />
        <form action={signOut} className="auth-switch">
          <button type="submit" className="linklike">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
