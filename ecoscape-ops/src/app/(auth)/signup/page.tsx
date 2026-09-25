import type { Metadata } from "next";
import Link from "next/link";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create your account · EcoScape Ops" };

export default function SignupPage() {
  return (
    <>
      <h1>Create your business account</h1>
      <p className="auth-lede">You&apos;ll be the owner. Your customers and data are visible only to your business.</p>
      <SignupForm />
      <p className="auth-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
