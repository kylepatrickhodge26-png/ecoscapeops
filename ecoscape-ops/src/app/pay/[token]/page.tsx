import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InvoiceStatusPill } from "@/components/invoice-status";
import { formatShortDate } from "@/lib/dates";
import { invoiceNumber } from "@/lib/invoices/constants";
import { formatPrice } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

import { PayButton } from "./pay-button";

// A customer's invoice, opened from the pay link the business sent them. No sign-in:
// the link's secret token is the key, and it shows that one invoice and nothing else.
export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false },
  // Don't pass the pay link on to other sites (e.g. Stripe) in the Referer header.
  referrer: "no-referrer",
};

type Line = { description: string; quantity: number; unit_price: number; amount: number };

export default async function PayPage(props: PageProps<"/pay/[token]">) {
  const { token } = await props.params;
  const { paid } = await props.searchParams;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_invoice", { token });
  if (error) throw new Error("Could not load this invoice.");
  const invoice = data[0];
  if (!invoice) notFound();
  const lines = invoice.lines as Line[];
  const isPaid = invoice.status === "paid";

  return (
    <main className="pay-card">
      <div className="pay-head">
        <div>
          <div className="pay-business">{invoice.business_name}</div>
          <h1>Invoice {invoiceNumber(invoice.number)}</h1>
          <div className="meta">
            For {invoice.customer_name || "you"} · Issued {formatShortDate(invoice.issue_date)} · Due {formatShortDate(invoice.due_date)}
          </div>
        </div>
        <InvoiceStatusPill status={invoice.status} />
      </div>

      <table className="invoice-lines">
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Qty</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{l.description}</td>
              <td className="num">{l.quantity}</td>
              <td className="num">{formatPrice(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="invoice-totals">
        <div>
          <dt>Total</dt>
          <dd>{formatPrice(invoice.total)}</dd>
        </div>
        {invoice.amount_paid > 0 && (
          <div>
            <dt>Paid</dt>
            <dd>{formatPrice(invoice.amount_paid)}</dd>
          </div>
        )}
        <div className="balance">
          <dt>Balance due</dt>
          <dd data-testid="balance">{formatPrice(invoice.balance)}</dd>
        </div>
      </dl>

      <div className="pay-action">
        {isPaid ? (
          <p className="notice success" role="status">
            Paid in full. Thank you!
          </p>
        ) : invoice.payment_processing ? (
          <p className="notice" role="status">
            Your bank payment is on its way. Bank payments take a few business days to clear; there&apos;s nothing more you
            need to do.
          </p>
        ) : paid === "1" ? (
          <p className="notice" role="status">
            Thanks! Your payment is being confirmed. <a href={`/pay/${token}`}>Refresh</a> in a moment to see it.
          </p>
        ) : invoice.can_pay_online ? (
          <>
            <PayButton token={token} label={`Pay ${formatPrice(invoice.balance)}`} />
            <p className="hint">
              You&apos;ll pay on Stripe&apos;s secure page, by card or US bank account. {invoice.business_name} never sees your card
              number.
            </p>
          </>
        ) : (
          <p className="hint">To pay this invoice, please contact {invoice.business_name}.</p>
        )}
      </div>
    </main>
  );
}
