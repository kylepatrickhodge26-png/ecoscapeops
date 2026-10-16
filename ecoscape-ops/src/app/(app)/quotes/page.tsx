import type { Metadata } from "next";
import Link from "next/link";

import { Notice } from "@/components/notice";
import { QuoteStatusPill } from "@/components/quote-status";
import { requireOwner } from "@/lib/auth";
import { formatShortDate } from "@/lib/dates";
import { QUOTE_STATUSES, QUOTE_STATUS_LABELS, isQuoteStatus, quoteNumber } from "@/lib/quotes/constants";
import { quoteWho } from "@/lib/quotes/display";
import { formatPrice } from "@/lib/schedule/constants";

import { listQuotes } from "./queries";

export const metadata: Metadata = { title: "Quotes" };

const NOTICES: Record<string, string> = { deleted: "Draft deleted." };

export default async function QuotesPage(props: PageProps<"/quotes">) {
  const { business } = await requireOwner();
  const params = await props.searchParams;
  const status = isQuoteStatus(params.status) ? params.status : null;
  const quotes = await listQuotes(business.id, status);
  const notice = typeof params.notice === "string" ? NOTICES[params.notice] : undefined;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Quotes</h1>
          <div className="meta">Owner only — crew members never see quotes or prices</div>
        </div>
        <Link className="btn" href="/quotes/new">
          + New quote
        </Link>
      </div>

      {notice && <Notice tone="success">{notice}</Notice>}

      <nav className="tabbar" aria-label="Filter quotes">
        <Link href="/quotes" className={status === null ? "active" : undefined} aria-current={status === null ? "page" : undefined}>
          All
        </Link>
        {QUOTE_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/quotes?status=${s}`}
            className={status === s ? "active" : undefined}
            aria-current={status === s ? "page" : undefined}
          >
            {QUOTE_STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>

      <div className="panel">
        <div className="panel-body flush">
          {quotes.length === 0 ? (
            <div className="empty">
              <div className="big">{status ? `No ${QUOTE_STATUS_LABELS[status].toLowerCase()} quotes` : "No quotes yet"}</div>
              {!status && "Price a job for a customer or a new prospect, send it, and book it with one tap when they say yes."}
            </div>
          ) : (
            <table className="invoice-table">
              <thead>
                <tr>
                  <th>Quote</th>
                  <th>For</th>
                  <th>Job</th>
                  <th>Good through</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id} data-quote-number={q.number}>
                    <td>
                      <Link className="row-link" href={`/quotes/${q.id}`}>
                        <b>{quoteNumber(q.number)}</b>
                      </Link>
                    </td>
                    <td>{quoteWho(q)}</td>
                    <td>{q.title || "—"}</td>
                    <td className="nowrap">{formatShortDate(q.expires_on)}</td>
                    <td className="num">{formatPrice(q.total)}</td>
                    <td>
                      <QuoteStatusPill status={q.quote_status_shown} />
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
