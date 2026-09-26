"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { safeNextPath } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = {
  error?: string;
  message?: string;
  values?: { email?: string; business_name?: string };
};

const signUpSchema = z.object({
  business_name: z
    .string()
    .trim()
    .min(1, "Enter your business name")
    .max(120, "Business name must be 120 characters or fewer"),
  email: z.email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be 72 characters or fewer"),
});

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const values = {
    business_name: String(formData.get("business_name") ?? ""),
    email: String(formData.get("email") ?? "").trim(),
  };
  const parsed = signUpSchema.safeParse({ ...values, password: String(formData.get("password") ?? "") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // The on_auth_user_created trigger creates the business from this and makes
      // this user its owner.
      data: { business_name: parsed.data.business_name },
      emailRedirectTo: `${await siteOrigin()}/auth/confirm?next=/customers`,
    },
  });

  if (error) {
    if (error.code === "user_already_exists") {
      return { error: "An account with this email already exists. Try signing in instead.", values };
    }
    if (error.code === "weak_password") {
      return { error: error.message, values };
    }
    console.error("Sign up failed", error);
    return { error: "We couldn't create your account. Please try again.", values };
  }

  // With email confirmation turned off there's a session right away.
  if (data.session) redirect("/customers");

  return {
    message: `Almost done — we sent a confirmation link to ${parsed.data.email}. Open it to finish setting up your account.`,
  };
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const values = { email };
  if (!email || !password) return { error: "Enter your email and password.", values };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { error: "Please confirm your email first — check your inbox for the link we sent.", values };
    }
    return { error: "Incorrect email or password.", values };
  }

  redirect(safeNextPath(formData.get("next")) ?? "/customers");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

async function siteOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}
