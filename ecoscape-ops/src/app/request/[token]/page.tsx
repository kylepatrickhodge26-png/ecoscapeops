import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicFaq } from "@/components/public-faq";
import { createClient } from "@/lib/supabase/server";

import { RequestForm } from "./request-form";

// A potential customer's way to ask a business for work. No sign-in: the link's secret token
// is the key. It shows the business's name and the form, nothing else about the business.
export const metadata: Metadata = {
  title: "Request service",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function RequestPage(props: PageProps<"/request/[token]">) {
  const { token } = await props.params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();

  const supabase = await createClient();
  const [{ data, error }, faq] = await Promise.all([supabase.rpc("public_request_form", { token }), supabase.rpc("public_request_faq", { token })]);
  if (error || faq.error) throw new Error("Could not load this form.");
  const form = data[0];
  if (!form) notFound();

  return (
    <main className="pay-card">
      <h1>{form.business_name}</h1>
      <p className="hint">Tell us what you need and we&apos;ll get back to you.</p>
      <RequestForm token={token} businessName={form.business_name} />
      <PublicFaq items={faq.data} heading="Common questions" />
    </main>
  );
}
