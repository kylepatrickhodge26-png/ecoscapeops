import type { Metadata } from "next";
import Link from "next/link";

import { ConfirmButton } from "@/components/confirm-button";
import { Notice } from "@/components/notice";
import { QuoteStatusPill } from "@/components/quote-status";
import { requireOwner } from "@/lib/auth";
import { assigneeOptions, getCrew, showAssignment } from "@/lib/crew";
import { formatShortDate, nextWeekdayOnOrAfter, todayInTimeZone } from "@/lib/dates";
import { quoteNumber } from "@/lib/quotes/constants";
import { quoteWho } from "@/lib/quotes/display";
import { quoteText } from "@/lib/quotes/text";
import { formatPrice } from "@/lib/schedule/constants";
import { smsLink, toE164 } from "@/lib/sms";

import { acceptQuote, declineQuote, deleteDraftQuote, duplicateQuote, markQuoteSent } from "../actions";
import { getQuoteOr404 } from "../queries";
import { AcceptForm } from "./accept-form";
import { PrintButton } from "./print-button";
import { SendQuote } from "./send-quote";

export const metadata: Metadata = { title: "Quote" };

const NOTICES: Record<string, string> = {
  created: "Quote saved as a draft. Send it when you're ready.",
  updated: "Changes saved.",
  declined: "Marked as declined.",
  copied: "Copied. This is a new draft you can change.",
  accepted: "Accepted and booked.",
};

export default async function QuotePage(props: PageProps<"/quotes/[id]">) {
  const { business, user } = await requireOwner();
  const { id } = await props.params;
  const { notice } = await props.searchParams;
  const quote = await getQuoteOr404(id);
  const today = todayInTimeZone(business.time_zone);
  const customer = quote.customer;
  const name = quoteWho(quote);
  const shown = quote.quote_status_shown;
  const sendable = quote.status === "draft" || quote.status === "sent";
  const canAccept = quote.status !== "accepted";
  const crew = await getCrew(business.id, user.id);
  const assignees = showAssignment(crew) ? assigneeOptions(crew, user.id) : undefined;

  // Prospects haven't opted in to texts, so only existing customers who have get a text button.
  const phone = customer?.sms_opt_in ? toE164(customer.phone) : null;
  const greeting = (customer ? customer.first_name : quote.prospect_name.split(" ")[0]) || null;
  const message = quoteText(
    { ...quote, lines: quote.quote_lines },
    { greeting, businessName: business.name },
  );
  const firstVisit = customer ? nextWeekdayOnOrAfter(today, 1) : today;

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink no-print" href="/quotes">
            ← Quotes
          </Link>
          <h1>Quote {quoteNumber(quote.number)}</h1>
          <div className="meta">
            {customer ? <Link href={`/customers/${customer.id}`}>{name}</Link> : `${name} (prospect)`} · Dated {formatShortDate(quote.issue_date)} ·
            Good through {formatShortDate(quote.expires_on)}
          </div>
          <div className="job-status-row">
            <QuoteStatusPill status={shown} />
            {quote.customer_response && (
              <span className={`pill ${quote.customer_response === "accepted" ? "completed" : "cancelled"}`} data-testid="customer-response">
                Customer {quote.customer_response === "accepted" ? "said yes" : "said no"}
                {quote.customer_responded_at && ` · ${formatShortDate(quote.customer_responded_at.slice(0, 10))}`}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="job-actions no-print">
        {quote.status === "draft" && (
          <Link className="btn secondary small" href={`/quotes/${quote.id}/edit`}>
            Edit
          </Link>
        )}
        <PrintButton />
        <ConfirmButton
          action={duplicateQuote.bind(null, quote.id)}
          label="Copy to a new draft"
          confirmLabel="Yes, copy it"
          pendingLabel="Copying…"
          danger={false}
          confirmText={<>Make a new draft from quote {quoteNumber(quote.number)}? Use it to revise a price or send it again.</>}
        />
        {quote.status === "draft" && (
          <ConfirmButton
            action={deleteDraftQuote.bind(null, quote.id)}
            label="Delete draft"
            confirmLabel="Yes, delete"
            pendingLabel="Deleting…"
            confirmText={<>Delete draft quote {quoteNumber(quote.number)}?</>}
          />
        )}
        {sendable && (
          <ConfirmButton
            action={declineQuote.bind(null, quote.id)}
            label="They said no"
            confirmLabel="Mark declined"
            pendingLabel="Saving…"
            confirmText={<>Mark quote {quoteNumber(quote.number)} as declined? You can still accept it later if they change their mind.</>}
          />
        )}
      </div>

      {typeof notice === "string" && NOTICES[notice] && <Notice tone="success">{NOTICES[notice]}</Notice>}
      {shown === "expired" && (
        <Notice tone="warn">This quote is past its &ldquo;good through&rdquo; date. You can still accept it, or copy it to a new draft with fresh dates.</Notice>
      )}
      {quote.customer_response === "accepted" && quote.status === "sent" && (
        <Notice tone="success">{name} accepted this quote from their account. Book the work below to confirm the dates.</Notice>
      )}
      {quote.status === "accepted" && (
        <Notice tone="success">
          Booked
          {customer && (
            <>
              {" "}
              for <Link href={`/customers/${customer.id}`}>{name}</Link>
            </>
          )}
          . <Link href="/schedule">See it on the schedule</Link>.
        </Notice>
      )}

      <div className="panel">
        <div className="panel-head">
          <h3>{quote.title || `Quote for ${name}`}</h3>
        </div>
        <div className="panel-body">
          {customer && (customer.billing_address || customer.property_address) && (
            <p className="subtext">{customer.property_address || customer.billing_address}</p>
          )}
          {!customer && (
            <p className="subtext">
              {[quote.prospect_phone, quote.prospect_email, quote.prospect_address].filter(Boolean).join(" · ") || "No contact details yet"}
            </p>
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
              {quote.quote_lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{formatPrice(l.unit_price)}</td>
                  <td className="num">{formatPrice(l.amount ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="invoice-totals">
            <div className="balance">
              <dt>Total</dt>
              <dd data-testid="total">{formatPrice(quote.total)}</dd>
            </div>
          </dl>
          {quote.notes && <p className="pre-line">{quote.notes}</p>}
        </div>
      </div>

      {sendable && (
        <div className="panel no-print">
          <div className="panel-head">
            <h3>{quote.status === "draft" ? "Send to customer" : "Send again"}</h3>
          </div>
          <div className="panel-body">
            <p className="hint">
              Copy the quote as text to paste into a message or email.
              {!phone && customer && " They haven't opted in to texts (or have no mobile number), so there's no text button."}
              {!customer && " Prospects haven't opted in to texts, so copy it to send yourself."}
            </p>
            <SendQuote
              text={message}
              smsHref={phone ? smsLink(phone, message) : null}
              name={name}
              isDraft={quote.status === "draft"}
              markSent={markQuoteSent.bind(null, quote.id)}
            />
          </div>
        </div>
      )}

      {canAccept && (
        <div className="panel no-print">
          <div className="panel-head">
            <h3>They said yes</h3>
          </div>
          <div className="panel-body">
            <p className="hint">
              Books the work at {formatPrice(quote.total)}: a recurring service or a one-time visit on your schedule.
            </p>
            <AcceptForm
              action={acceptQuote.bind(null, quote.id)}
              initialValues={{
                service_name: quote.title || quote.quote_lines[0]?.description || "",
                frequency: "one_time",
                first_visit: firstVisit,
                assigned_crew_member_id: "",
              }}
              assignees={assignees}
              today={today}
              isProspect={!customer}
            />
          </div>
        </div>
      )}
    </>
  );
}
