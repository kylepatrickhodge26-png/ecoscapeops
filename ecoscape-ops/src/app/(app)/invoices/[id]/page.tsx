import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";

import { ConfirmButton } from "@/components/confirm-button";
import { InvoiceStatusPill } from "@/components/invoice-status";
import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers/schema";
import { formatShortDate, todayInTimeZone } from "@/lib/dates";
import { PAYMENT_METHOD_LABELS, invoiceNumber } from "@/lib/invoices/constants";
import { formatPrice } from "@/lib/schedule/constants";
import { siteOrigin } from "@/lib/site-origin";
import { smsLink, toE164 } from "@/lib/sms";

import { cancelInvoice, changeDueDate, deleteDraftInvoice, deletePayment, markInvoiceSent, recordPayment } from "../actions";
import { getInvoiceOr404 } from "../queries";
import { DueDateForm } from "./due-date-form";
import { PaymentForm } from "./payment-form";
import { SendInvoice } from "./send-invoice";

export const metadata: Metadata = { title: "Invoice · EcoScape Ops" };

const NOTICES: Record<string, string> = {
  created: "Invoice saved as a draft. Send it when you're ready.",
  updated: "Changes saved.",
  cancelled: "Invoice cancelled.",
  payment: "Payment recorded.",
  "payment-removed": "Payment removed.",
};

export default async function InvoicePage(props: PageProps<"/invoices/[id]">) {
  const { business } = await requireOwner();
  const { id } = await props.params;
  const { notice } = await props.searchParams;
  const invoice = await getInvoiceOr404(id);
  const today = todayInTimeZone(business.time_zone);
  const customer = invoice.customer;
  const name = customer ? customerDisplayName(customer) : "Deleted customer";
  const balance = invoice.balance ?? invoice.total - invoice.amount_paid;
  const payUrl = `${await siteOrigin()}/pay/${invoice.pay_token}`;
  const isDraft = invoice.status === "draft";
  const isOpen = invoice.status === "sent" && balance > 0;
  const processing = invoice.checkout_sessions.filter((s) => s.status === "processing");

  const phone = customer?.sms_opt_in ? toE164(customer.phone) : null;
  const message =
    `Hi${customer?.first_name ? ` ${customer.first_name}` : ""}, here's invoice ${invoiceNumber(invoice.number)} from ${business.name} ` +
    `for ${formatPrice(balance)}, due ${formatShortDate(invoice.due_date)}: ${payUrl}`;

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href="/invoices">
            ← Invoices
          </Link>
          <h1>Invoice {invoiceNumber(invoice.number)}</h1>
          <div className="meta">
            {customer ? <Link href={`/customers/${customer.id}`}>{name}</Link> : name} · Issued {formatShortDate(invoice.issue_date)} · Due{" "}
            {formatShortDate(invoice.due_date)}
          </div>
          <div className="job-status-row">
            <InvoiceStatusPill status={invoice.display_status} />
          </div>
        </div>
      </div>

      <div className="job-actions">
        {isDraft && (
          <Link className="btn secondary small" href={`/invoices/${invoice.id}/edit`}>
            Edit
          </Link>
        )}
        {isDraft && (
          <ConfirmButton
            action={deleteDraftInvoice.bind(null, invoice.id)}
            label="Delete draft"
            confirmLabel="Yes, delete"
            pendingLabel="Deleting…"
            confirmText={<>Delete draft invoice {invoiceNumber(invoice.number)}? Its visits can go on another invoice.</>}
          />
        )}
        {invoice.status === "sent" && invoice.payments.length === 0 && (
          <ConfirmButton
            action={cancelInvoice.bind(null, invoice.id)}
            label="Cancel invoice"
            confirmLabel="Yes, cancel it"
            pendingLabel="Cancelling…"
            confirmText={
              <>
                Cancel invoice {invoiceNumber(invoice.number)}? Its pay link stops working, and its visits can go on another
                invoice.
              </>
            }
          />
        )}
      </div>

      {typeof notice === "string" && NOTICES[notice] && <Notice tone="success">{NOTICES[notice]}</Notice>}
      {processing.map((s) => (
        <Notice key={s.id} tone="warn">
          A bank payment of {formatPrice(s.amount)} is on its way (started {formatShortDate(s.created_at.slice(0, 10))}). Bank payments
          take a few business days to clear.
        </Notice>
      ))}
      {balance < 0 && (
        <Notice tone="warn">Overpaid by {formatPrice(-balance)}. Refund the difference in Stripe or to the customer directly.</Notice>
      )}

      <div className="panel">
        <div className="panel-head">
          <h3>Bill to {name}</h3>
        </div>
        <div className="panel-body">
          {customer && (customer.billing_address || customer.property_address) && (
            <p className="subtext">{customer.billing_address || customer.property_address}</p>
          )}
          <table className="invoice-lines">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">Qty</th>
                <th className="num">Price</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.invoice_lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.job_id ? <Link href={`/schedule/jobs/${l.job_id}`}>{l.description}</Link> : l.description}
                  </td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{formatPrice(l.unit_price)}</td>
                  <td className="num">{formatPrice(l.amount ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="invoice-totals">
            <div>
              <dt>Total</dt>
              <dd data-testid="total">{formatPrice(invoice.total)}</dd>
            </div>
            <div>
              <dt>Paid</dt>
              <dd data-testid="paid">{formatPrice(invoice.amount_paid)}</dd>
            </div>
            <div className="balance">
              <dt>Balance due</dt>
              <dd data-testid="balance">{formatPrice(Math.max(balance, 0))}</dd>
            </div>
          </dl>
          {invoice.notes && <p className="pre-line">{invoice.notes}</p>}
        </div>
      </div>

      {(isDraft || isOpen) && (
        <div className="panel">
          <div className="panel-head">
            <h3>{isDraft ? "Send to customer" : "Resend to customer"}</h3>
          </div>
          <div className="panel-body">
            <p className="hint">
              The customer can see this invoice and pay it online with their pay link.
              {!phone && " They haven't opted in to texts (or have no mobile number), so copy the link to email it."}
            </p>
            <SendInvoice
              payUrl={payUrl}
              smsHref={phone ? smsLink(phone, message) : null}
              name={name}
              isDraft={isDraft}
              markSent={markInvoiceSent.bind(null, invoice.id)}
            />
          </div>
        </div>
      )}

      {invoice.status === "sent" && (
        <div className="panel">
          <div className="panel-head">
            <h3>Payments</h3>
          </div>
          <div className="panel-body">
            {invoice.payments.length === 0 ? (
              <p className="hint">No payments yet.</p>
            ) : (
              <ul className="payment-list">
                {invoice.payments.map((p) => (
                  <li key={p.id} className="payment-row" data-payment-method={p.method}>
                    <span>
                      <b>{formatPrice(p.amount)}</b> · {PAYMENT_METHOD_LABELS[p.method]} · {formatShortDate(p.received_on)}
                      {p.note && p.method !== "online" && p.method !== "bank_transfer" && <span className="subtext"> · {p.note}</span>}
                    </span>
                    {(p.method === "cash" || p.method === "check" || p.method === "other") && (
                      <ConfirmButton
                        action={deletePayment.bind(null, invoice.id, p.id)}
                        label="Remove"
                        confirmLabel="Remove"
                        pendingLabel="Removing…"
                        confirmText={<>Remove this {formatPrice(p.amount)} payment? Only do this if it was recorded by mistake.</>}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {isOpen && (
              <>
                <h4 className="subhead">Record a cash or check payment</h4>
                <PaymentForm
                  action={recordPayment.bind(null, invoice.id)}
                  today={today}
                  initialValues={{ amount: balance.toFixed(2), method: "cash", received_on: today, note: "", request_id: randomUUID() }}
                />
                <DueDateForm action={changeDueDate.bind(null, invoice.id)} current={invoice.due_date} min={invoice.issue_date} />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
