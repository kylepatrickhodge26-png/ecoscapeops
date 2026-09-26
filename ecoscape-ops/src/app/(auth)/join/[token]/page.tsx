import type { Metadata } from "next";
import Link from "next/link";

import { getUser } from "@/lib/auth";
import { isInviteToken } from "@/lib/invite";
import { createClient } from "@/lib/supabase/server";

import { signOut } from "../../actions";
import { AcceptInviteButton, JoinForm } from "./join-forms";

export const metadata: Metadata = { title: "Join the crew · EcoScape Ops" };

export default async function JoinPage(props: PageProps<"/join/[token]">) {
  const { token } = await props.params;
  const supabase = await createClient();
  const { data } = isInviteToken(token) ? await supabase.rpc("crew_invite_details", { token }) : { data: null };
  const invite = data?.[0];

  if (!invite) {
    return (
      <>
        <h1>This invite link isn&apos;t valid</h1>
        <p className="auth-lede">
          It may have already been used, or it expired. Ask the business owner to send you a new link.
        </p>
        <p className="auth-switch">
          Already joined? <Link href="/login">Sign in</Link>
        </p>
      </>
    );
  }

  const user = await getUser();
  if (user) {
    const { data: membership } = await supabase
      .from("business_members")
      .select("business_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (membership) {
      return (
        <>
          <h1>Join {invite.business_name}</h1>
          <p className="auth-lede">
            You&apos;re signed in as {user.email}, which already belongs to a business. To join{" "}
            {invite.business_name}, sign out and open this link again to create a separate login.
          </p>
          <form action={signOut} className="auth-switch">
            <button type="submit" className="linklike">
              Sign out
            </button>
          </form>
        </>
      );
    }
    return (
      <>
        <h1>Join {invite.business_name}</h1>
        <p className="auth-lede">
          You&apos;ve been added to the crew as <b>{invite.crew_member_name}</b>. Signed in as {user.email}.
        </p>
        <AcceptInviteButton token={token} businessName={invite.business_name} />
      </>
    );
  }

  return (
    <>
      <h1>Join {invite.business_name}</h1>
      <p className="auth-lede">
        You&apos;ve been added to the crew as <b>{invite.crew_member_name}</b>. Create your login to see the jobs
        assigned to you.
      </p>
      <JoinForm token={token} />
      <p className="auth-switch">
        Already have a login without a business? <Link href={`/login?next=/join/${token}`}>Sign in</Link>
      </p>
    </>
  );
}
