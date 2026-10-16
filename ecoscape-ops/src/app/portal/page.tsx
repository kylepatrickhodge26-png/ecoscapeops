import type { Metadata } from "next";

import { StatusPill } from "@/components/job-status";
import { requireCustomer } from "@/lib/auth";
import { formatShortDate } from "@/lib/dates";
import { invoiceNumber } from "@/lib/invoices/constants";
import { quoteNumber } from "@/lib/quotes/constants";
import { formatPrice } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

import { QuoteAnswer, RequestServiceForm } from "./portal-forms";

export const metadata: Metadata = { title: "Your account", robots: { index: false, follow: false } };

type Line = { description: string; quantity: number; unit_price: number; amount: number };

const QUOTE_LABELS: Record<string, string> = { sent: "Waiting for your answer", accepted: "Accepted", declined: "Declined", expired: "Expired" };
const INVOICE_LABELS: Record<string, string> = { sent: "Due", partial: "Partly paid", overdue: "Overdue", paid: "Paid" };

// A customer's own account: everything here comes from portal_* functions that only ever
// return this customer's records. Text from the business is shown as plain text.
export default async function PortalPage() {
  const account = await requireCustomer();
  if (!account) {
    return (
      <div className="panel">
        <div className="panel-body">
          <h1>No account linked</h1>
          <p>This login isn&apos;t linked to a customer account any more. Ask your landscaper for a new invite link.</p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const [visits, quotes, invoices] = await Promise.all([
    supabase.rpc("portal_visits"),
    supabase.rpc("portal_quotes"),
    supabase.rpc("portal_invoices"),
  ]);
  const failed = [visits, quotes, invoices].find((r) => r.error);
  if (failed?.error) throw new Error(`Could not load your account: ${failed.error.message}`);

  const upcoming = visits.data!.filter((v) => v.upcoming && v.status !== "cancelled");
  const past = visits.data!.filter((v) => !v.upcoming).reverse();
  const name = account.first_name || account.last_name || "there";

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Hi {name}</h1>
          <div className="meta">
            Your account with {account.business_name}
            {account.property_address && ` · ${account.property_address}`}
          </div>
        </div>
      </div>

      {account.amount_owed > 0 && (
        <div className="notice warn" role="status">
          You have {formatPrice(account.amount_owed)} due. See Invoices below to pay.
        </div>
      )}

      <section className="panel" aria-labelledby="p-visits" data-testid="portal-visits">
        <div className="panel-head">
          <h3 id="p-visits">Upcoming visits</h3>
        </div>
        <div className="panel-body">
          {upcoming.length === 0 ? (
            <p className="hint">Nothing scheduled right now.</p>
          ) : (
            <ul className="time-list">
              {upcoming.map((v) => (
                <li key={v.id}>
                  <b>{formatShortDate(v.scheduled_date)}</b> · {v.service_name} · <StatusPill status={v.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="p-quotes" data-testid="portal-quotes">
        <div className="panel-head">
          <h3 id="p-quotes">Quotes</h3>
        </div>
        <div className="panel-body">
          {quotes.data!.length === 0 ? (
            <p className="hint">No quotes yet.</p>
          ) : (
            <ul className="request-list">
              {quotes.data!.map((q) => {
                const lines = (Array.isArray(q.lines) ? q.lines : []) as unknown as Line[];
                const waiting = q.status === "sent" && !q.customer_response;
                return (
                  <li key={q.id} data-quote={q.number}>
                    <div>
                      <b>
                        Quote {quoteNumber(q.number)}
                        {q.title && `: ${q.title}`}
                      </b>{" "}
                      · {formatPrice(q.total)} ·{" "}
                      <span className="subtext">
                        {q.customer_response === "accepted" && q.status === "sent" ? "You accepted. We'll confirm the dates." : QUOTE_LABELS[q.status] ?? q.status}
                        {waiting && ` · good through ${formatShortDate(q.expires_on)}`}
                      </span>
                    </div>
                    <ul className="quote-lines-plain">
                      {lines.map((l, i) => (
                        <li key={i}>
                          {l.description}
                          {Number(l.quantity) !== 1 && ` × ${l.quantity}`} · {formatPrice(Number(l.amount))}
                        </li>
                      ))}
                    </ul>
                    {q.notes && <p className="pre-line subtext">{q.notes}</p>}
                    {waiting && <QuoteAnswer quoteId={q.id} businessName={account.business_name} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="p-invoices" data-testid="portal-invoices">
        <div className="panel-head">
          <h3 id="p-invoices">Invoices</h3>
        </div>
        <div className="panel-body">
          {invoices.data!.length === 0 ? (
            <p className="hint">No invoices yet.</p>
          ) : (
            <ul className="time-list">
              {invoices.data!.map((i) => (
                <li key={i.id}>
                  <b>Invoice {invoiceNumber(i.number)}</b> · {formatShortDate(i.issue_date)} · {formatPrice(i.total)} ·{" "}
                  <span className="subtext">{INVOICE_LABELS[i.status] ?? i.status}</span>
                  {i.balance > 0 && (
                    <>
                      {" "}
                      ·{" "}
                      <a className="btn small" href={`/pay/${i.pay_token}`}>
                        Pay {formatPrice(i.balance)}
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="p-request">
        <div className="panel-head">
          <h3 id="p-request">Ask for more work</h3>
        </div>
        <div className="panel-body">
          <RequestServiceForm />
        </div>
      </section>

      {past.length > 0 && (
        <section className="panel" aria-labelledby="p-past">
          <div className="panel-head">
            <h3 id="p-past">Recent visits</h3>
          </div>
          <div className="panel-body">
            <ul className="time-list">
              {past.map((v) => (
                <li key={v.id}>
                  {formatShortDate(v.scheduled_date)} · {v.service_name} · <StatusPill status={v.status} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
