"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { isInviteToken } from "@/lib/invite";
import { siteOrigin } from "@/lib/site-origin";
import { createClient } from "@/lib/supabase/server";

export type CustomerJoinState = { error?: string; message?: string; email?: string };

const joinSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(72, "Password must be 72 characters or fewer"),
});

// A customer creates their login through the invite link. The signup trigger links it to
// their customer record, and fails the signup if the link stopped being valid.
export async function joinAsCustomer(token: string, _prev: CustomerJoinState, formData: FormData): Promise<CustomerJoinState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = joinSchema.safeParse({ email, password: String(formData.get("password") ?? "") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email };
  if (!isInviteToken(token)) return { error: "This invite link isn't valid.", email };

  const supabase = await createClient();
  const { data: invite } = await supabase.rpc("customer_invite_details", { token });
  if (!invite?.length) return { error: "This invite link has already been used or has expired.", email };

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { customer_invite_token: token, full_name: invite[0].customer_name },
      emailRedirectTo: `${await siteOrigin()}/auth/confirm?next=/portal`,
    },
  });
  if (error) {
    if (error.code === "user_already_exists") {
      return { error: "An account with this email already exists. Sign in instead, then open this link again.", email };
    }
    if (error.code === "weak_password") return { error: error.message, email };
    console.error("Customer join failed", error);
    return { error: "We couldn't create your account. The link may have expired. Ask for a new one.", email };
  }

  if (data.session) redirect("/portal");
  return { message: `Almost done. We sent a confirmation link to ${parsed.data.email}. Open it to finish.` };
}

export type CustomerAcceptState = { error?: string };

// A signed-in login that isn't part of any business accepts the invite.
export async function acceptCustomerInvite(token: string): Promise<CustomerAcceptState> {
  if (!isInviteToken(token)) return { error: "This invite link isn't valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_customer_invite", { token });
  if (error) {
    if (error.code === "23505") return { error: `${error.message}.` };
    if (error.code === "P0002") return { error: "This invite link has already been used or has expired." };
    console.error("Accept customer invite failed", error);
    return { error: "We couldn't accept this invite. Please try again." };
  }
  redirect("/portal");
}
