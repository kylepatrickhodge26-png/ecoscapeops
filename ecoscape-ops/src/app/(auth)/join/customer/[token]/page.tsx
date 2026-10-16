import type { Metadata } from "next";
import Link from "next/link";

import { getCustomerAccount, getUser } from "@/lib/auth";
import { isInviteToken } from "@/lib/invite";
import { createClient } from "@/lib/supabase/server";

import { signOut } from "../../../actions";
import { AcceptCustomerInviteButton, CustomerJoinForm } from "./forms";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// A customer's invite link. Shows only the business's name and the customer's first name.
export default async function CustomerJoinPage(props: PageProps<"/join/customer/[token]">) {
  const { token } = await props.params;
  const supabase = await createClient();
  const { data } = isInviteToken(token) ? await supabase.rpc("customer_invite_details", { token }) : { data: null };
  const invite = data?.[0];

  if (!invite) {
    return (
      <>
        <h1>This link isn&apos;t valid</h1>
        <p className="auth-lede">It may have already been used, or it expired. Ask your landscaper to send you a new one.</p>
        <p className="auth-switch">
          Already have an account? <Link href="/login?next=/portal">Sign in</Link>
        </p>
      </>
    );
  }

  const user = await getUser();
  if (user) {
    const { data: member } = await supabase.from("business_members").select("business_id").eq("user_id", user.id).maybeSingle();
    const already = await getCustomerAccount();
    if (member || already) {
      return (
        <>
          <h1>Hi {invite.customer_name}</h1>
          <p className="auth-lede">
            You&apos;re signed in as {user.email}, which {member ? "belongs to a business" : "already has a customer account"}. Sign out and
            open this link again to create your account with a different email.
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
        <h1>Hi {invite.customer_name}</h1>
        <p className="auth-lede">
          {invite.business_name} invited you to see your visits, quotes and invoices. Signed in as {user.email}.
        </p>
        <AcceptCustomerInviteButton token={token} />
      </>
    );
  }

  return (
    <>
      <h1>Hi {invite.customer_name}</h1>
      <p className="auth-lede">
        {invite.business_name} invited you to see your upcoming visits, quotes and invoices, and pay online. Create your login to get
        started.
      </p>
      <CustomerJoinForm token={token} />
      <p className="auth-switch">
        Already have a login? <Link href={`/login?next=/join/customer/${token}`}>Sign in</Link>
      </p>
    </>
  );
}
