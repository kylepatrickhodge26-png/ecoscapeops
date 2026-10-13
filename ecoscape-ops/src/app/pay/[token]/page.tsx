import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InvoiceStatusPill } from "@/components/invoice-status";
import { formatShortDate } from "@/lib/dates";
import { invoiceNumber } from "@/lib/invoices/constants";
import { payOptions } from "@/lib/invoices/payment-options";
import { formatPrice } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

import { CopyButton } from "./copy-button";

// A customer's invoice, opened from the pay link the business sent them. No sign-in:
// the link's secret token is the key, and it shows that one invoice and nothing else,
// with the ways that business takes payment. The money goes straight to the business.
export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false },
  // Don't pass the pay link on to other sites (e.g. Venmo) in the Referer header.
  referrer: "no-referrer",
};

type Line = { description: string; quantity: number; unit_price: number; amount: number };

export default async function PayPage(props: PageProps<"/pay/[token]">) {
  const { token } = await props.params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_invoice", { token });
  if (error) throw new Error("Could not load this invoice.");
  const invoice = data[0];
  if (!invoice) notFound();
  const lines = invoice.lines as Line[];
  const isPaid = invoice.status === "paid";
  const reference = `Invoice ${invoiceNumber(invoice.number)}`;
  const options = payOptions(
    {
      venmo: invoice.venmo || null,
      cash_app: invoice.cash_app || null,
      paypal: invoice.paypal || null,
      zelle: invoice.zelle || null,
      pay_link: invoice.pay_link || null,
      payment_note: invoice.payment_note,
    },
    invoice.balance,
    reference,
  );

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
        ) : (
          <>
            {options.length > 0 && (
              <>
                <h2>Pay {formatPrice(invoice.balance)}</h2>
                <ul className="pay-options">
                  {options.map((o) => (
                    <li key={o.app} className={`pay-option ${o.app}`}>
                      {o.app === "zelle" ? (
                        <>
                          <div>
                            <b>Zelle</b>
                            <span className="subtext">
                              {" "}
                              · Send {formatPrice(invoice.balance)} to <b data-testid="zelle-to">{o.send_to}</b> from your bank&apos;s app
                            </span>
                          </div>
                          <CopyButton text={o.send_to} label="Copy" />
                        </>
                      ) : (
                        <a className="btn pay-button" href={o.href} target="_blank" rel="noopener noreferrer">
                          {o.app === "pay_link" ? `Pay online` : `Pay with ${o.label}`}
                          <span className="pay-detail">{o.detail}</span>
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {invoice.payment_note && <p className="pay-note">{invoice.payment_note}</p>}
            {options.length > 0 ? (
              <p className="hint">
                Please include &ldquo;{reference}&rdquo; with your payment. Your payment goes straight to {invoice.business_name}; this
                invoice will show as paid once they&apos;ve received it.
              </p>
            ) : (
              !invoice.payment_note && <p className="hint">To pay this invoice, please contact {invoice.business_name}.</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
