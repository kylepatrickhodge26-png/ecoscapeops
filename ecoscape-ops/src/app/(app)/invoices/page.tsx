import type { Metadata } from "next";
import Link from "next/link";

import { InvoiceStatusPill } from "@/components/invoice-status";
import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers/schema";
import { formatShortDate } from "@/lib/dates";
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS, invoiceNumber, isInvoiceStatus } from "@/lib/invoices/constants";
import { paymentOptionsSummary } from "@/lib/invoices/payment-options";
import { formatPrice } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

import { setAutoInvoice } from "./actions";
import { invoiceSettings, listInvoices } from "./queries";
import { AutoInvoiceToggle } from "./settings-controls";

export const metadata: Metadata = { title: "Invoices · EcoScape Ops" };

const NOTICES: Record<string, { tone: "success" | "error"; text: string }> = {
  deleted: { tone: "success", text: "Draft deleted." },
  "payment-options": { tone: "success", text: "Payment options saved." },
};

export default async function InvoicesPage(props: PageProps<"/invoices">) {
  const { business } = await requireOwner();
  const params = await props.searchParams;
  const status = isInvoiceStatus(params.status) ? params.status : null;
  const supabase = await createClient();
  const [invoices, settings, { data: summary }] = await Promise.all([
    listInvoices(business.id, status),
    invoiceSettings(business.id),
    supabase.rpc("dashboard_summary"),
  ]);
  const ways = paymentOptionsSummary(settings.paymentOptions);
  const totals = summary?.[0];
  const notice = typeof params.notice === "string" ? NOTICES[params.notice] : undefined;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Invoices</h1>
          <div className="meta">Owner only — crew members never see invoices</div>
        </div>
        <Link className="btn" href="/invoices/new">
          + New invoice
        </Link>
      </div>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <div className="grid" aria-label="Invoice totals">
        <div className="card accent-sun" data-card="outstanding">
          <div className="label">OUTSTANDING</div>
          <div className="big">{formatPrice(totals?.outstanding ?? 0)}</div>
          <div className="sub">owed on sent invoices</div>
        </div>
        <div className="card accent-clay" data-card="overdue">
          <div className="label">OVERDUE</div>
          <div className="big">{formatPrice(totals?.overdue ?? 0)}</div>
          <div className="sub">past the due date</div>
        </div>
        <div className="card accent-sage" data-card="collected">
          <div className="label">COLLECTED</div>
          <div className="big">{formatPrice(totals?.month_collected ?? 0)}</div>
          <div className="sub">paid this month</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Getting paid</h3>
        </div>
        <div className="panel-body invoice-settings">
          <AutoInvoiceToggle enabled={settings.autoInvoice} save={setAutoInvoice} />
          <div className="payment-options-status" data-testid="payment-options-status">
            {ways ? (
              <p>
                Customers can pay you with <b>{ways}</b> from their invoice link. The money goes straight to you; record each payment
                when it arrives.
              </p>
            ) : (
              <p>
                Add the payment apps you already use (Venmo, Cash App, PayPal, Zelle) so customers can pay from their invoice link.
                It&apos;s free, and the money goes straight to you.
              </p>
            )}
            <Link className="btn small" href="/invoices/payment-options">
              {ways ? "Edit payment options" : "Set up payment options"}
            </Link>
          </div>
        </div>
      </div>

      <nav className="tabbar" aria-label="Filter invoices">
        <Link href="/invoices" className={status === null ? "active" : undefined} aria-current={status === null ? "page" : undefined}>
          All
        </Link>
        {INVOICE_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/invoices?status=${s}`}
            className={status === s ? "active" : undefined}
            aria-current={status === s ? "page" : undefined}
          >
            {INVOICE_STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>

      <div className="panel">
        <div className="panel-body flush">
          {invoices.length === 0 ? (
            <div className="empty">
              <div className="big">{status ? `No ${INVOICE_STATUS_LABELS[status].toLowerCase()} invoices` : "No invoices yet"}</div>
              {!status && "Create one, or turn on auto-invoicing to get a draft for every completed visit."}
            </div>
          ) : (
            <table className="invoice-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th className="num">Total</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} data-invoice-number={inv.number}>
                    <td>
                      <Link className="row-link" href={`/invoices/${inv.id}`}>
                        <b>{invoiceNumber(inv.number)}</b>
                      </Link>
                    </td>
                    <td>{inv.customer ? customerDisplayName(inv.customer) : "—"}</td>
                    <td className="nowrap">{formatShortDate(inv.issue_date)}</td>
                    <td className="nowrap">{formatShortDate(inv.due_date)}</td>
                    <td className="num">{formatPrice(inv.total)}</td>
                    <td className="num">{formatPrice(Math.max(inv.balance ?? 0, 0))}</td>
                    <td>
                      <InvoiceStatusPill status={inv.display_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
