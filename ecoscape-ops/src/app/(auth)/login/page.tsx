import type { Metadata } from "next";
import Link from "next/link";

import { safeNextPath } from "@/lib/redirect";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · EcoScape Ops" };

const ERRORS: Record<string, string> = {
  confirmation: "That confirmation link is invalid or has expired. Try signing in, or sign up again.",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const next = safeNextPath(typeof searchParams.next === "string" ? searchParams.next : null);
  const error = typeof searchParams.error === "string" ? ERRORS[searchParams.error] : undefined;

  return (
    <>
      <h1>Sign in</h1>
      <LoginForm next={next} initialError={error} />
      <p className="auth-switch">
        New to EcoScape Ops? <Link href="/signup">Create a business account</Link>
      </p>
    </>
  );
}
