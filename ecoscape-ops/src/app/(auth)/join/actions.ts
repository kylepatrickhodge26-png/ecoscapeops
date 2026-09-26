"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { isInviteToken } from "@/lib/invite";
import { siteOrigin } from "@/lib/site-origin";
import { createClient } from "@/lib/supabase/server";

export type JoinState = { error?: string; message?: string; email?: string };

const joinSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be 72 characters or fewer"),
});

// New login through an invite link. The signup trigger joins the crew atomically, and
// fails the signup if the link stopped being valid in the meantime.
export async function joinCrew(token: string, _prev: JoinState, formData: FormData): Promise<JoinState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = joinSchema.safeParse({ email, password: String(formData.get("password") ?? "") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email };
  if (!isInviteToken(token)) return { error: "This invite link isn't valid.", email };

  const supabase = await createClient();
  const { data: invite } = await supabase.rpc("crew_invite_details", { token });
  if (!invite?.length) return { error: "This invite link has already been used or has expired.", email };

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { crew_invite_token: token, full_name: invite[0].crew_member_name },
      emailRedirectTo: `${await siteOrigin()}/auth/confirm?next=/my-jobs`,
    },
  });
  if (error) {
    if (error.code === "user_already_exists") {
      return { error: "An account with this email already exists. Sign in instead, then open this link again.", email };
    }
    if (error.code === "weak_password") return { error: error.message, email };
    console.error("Crew join failed", error);
    return { error: "We couldn't create your login. The invite link may have expired — ask for a new one.", email };
  }

  if (data.session) redirect("/my-jobs");
  return { message: `Almost done — we sent a confirmation link to ${parsed.data.email}. Open it to finish joining.` };
}

export type AcceptState = { error?: string };

// An existing login with no business accepts the invite.
export async function acceptInvite(token: string): Promise<AcceptState> {
  if (!isInviteToken(token)) return { error: "This invite link isn't valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_crew_invite", { token });
  if (error) {
    if (error.code === "23505") return { error: "This login already belongs to a business." };
    if (error.code === "P0002") return { error: "This invite link has already been used or has expired." };
    console.error("Accept invite failed", error);
    return { error: "We couldn't accept this invite. Please try again." };
  }
  redirect("/my-jobs");
}
