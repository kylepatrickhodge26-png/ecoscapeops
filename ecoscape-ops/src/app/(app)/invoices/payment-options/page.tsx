import type { Metadata } from "next";
import Link from "next/link";

import { requireOwner } from "@/lib/auth";
import { formatPhone } from "@/lib/sms";

import { invoiceSettings } from "../queries";
import { PaymentOptionsForm } from "./payment-options-form";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "Payment options" };

export default async function PaymentOptionsPage() {
  const { business } = await requireOwner();
  const { paymentOptions: o } = await invoiceSettings(business.id);

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href="/invoices">
            ← Invoices
          </Link>
          <h1>How customers pay you</h1>
          <div className="meta">
            Fill in the ones you use. They appear on every invoice&apos;s pay link, with the amount filled in. Money goes straight to
            you, so {APP_NAME} never holds it and charges nothing.
          </div>
        </div>
      </div>
      <PaymentOptionsForm
        initialValues={{
          venmo: o.venmo ? `@${o.venmo}` : "",
          cash_app: o.cash_app ? `$${o.cash_app}` : "",
          paypal: o.paypal ?? "",
          zelle: o.zelle ? (o.zelle.startsWith("+") ? formatPhone(o.zelle) : o.zelle) : "",
          pay_link: o.pay_link ?? "",
          payment_note: o.payment_note,
        }}
      />
    </>
  );
}
