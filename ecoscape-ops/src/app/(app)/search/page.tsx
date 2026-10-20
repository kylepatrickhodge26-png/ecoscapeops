import type { Metadata } from "next";
import Link from "next/link";

import { InvoiceStatusPill } from "@/components/invoice-status";
import { StatusPill } from "@/components/job-status";
import { QuoteStatusPill } from "@/components/quote-status";
import { requireOwner } from "@/lib/auth";
import { formatShortDate } from "@/lib/dates";
import { searchHelp } from "@/lib/help";
import { invoiceNumber } from "@/lib/invoices/constants";
import { quoteNumber } from "@/lib/quotes/constants";
import { formatPrice, type JobStatus } from "@/lib/schedule/constants";
import { SEARCH_MIN_LENGTH, cleanSearchTerm, groupHits, hitHref, type SearchHit } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Search" };

const REQUEST_LABELS: Record<string, string> = { new: "New", converted: "Added", dismissed: "Dismissed" };

function HitLine({ hit }: { hit: SearchHit }) {
  const date = hit.on_date ? formatShortDate(hit.on_date) : null;
  switch (hit.kind) {
    case "customer":
      return (
        <>
          <b>{hit.title}</b>
          {hit.status === "inactive" && <span className="pill cancelled">Inactive</span>}
          {hit.detail && <span className="subtext">{hit.detail}</span>}
        </>
      );
    case "visit":
      return (
        <>
          <b>
            {date} · {hit.title}
          </b>
          <span className="subtext">
            {hit.detail}
            {hit.amount !== null && ` · ${formatPrice(hit.amount)}`}
          </span>
          {hit.status && <StatusPill status={hit.status as JobStatus} />}
        </>
      );
    case "quote":
      return (
        <>
          <b>
            Quote {quoteNumber(hit.number ?? 0)} · {hit.title}
          </b>
          <span className="subtext">
            {[hit.detail, hit.amount !== null ? formatPrice(hit.amount) : null, date].filter(Boolean).join(" · ")}
          </span>
          <QuoteStatusPill status={hit.status} />
        </>
      );
    case "invoice":
      return (
        <>
          <b>
            Invoice {invoiceNumber(hit.number ?? 0)} · {hit.title}
          </b>
          <span className="subtext">{[hit.amount !== null ? formatPrice(hit.amount) : null, date].filter(Boolean).join(" · ")}</span>
          <InvoiceStatusPill status={hit.status} />
        </>
      );
    default:
      return (
        <>
          <b>{hit.title}</b>
          <span className="subtext">{[hit.detail, date && `asked ${date}`].filter(Boolean).join(" · ")}</span>
          {hit.status && <span className={`pill ${hit.status === "new" ? "invoice-sent" : "completed"}`}>{REQUEST_LABELS[hit.status] ?? hit.status}</span>}
        </>
      );
  }
}

// The owner's search: one box finds customers, visits, quotes, invoices, requests and help.
// Everything comes from search_everything, which only ever looks in the owner's business.
export default async function SearchPage(props: PageProps<"/search">) {
  await requireOwner();
  const term = cleanSearchTerm((await props.searchParams).q);

  if (term.length < SEARCH_MIN_LENGTH) {
    return (
      <>
        <div className="pagehead">
          <div>
            <h1>Search</h1>
            <div className="meta">Find anything in a couple of letters</div>
          </div>
        </div>
        <div className="panel">
          <div className="empty" data-testid="search-hint">
            <div className="big">What are you looking for?</div>
            Type part of a name, a phone number, a street, a service, or an invoice or quote number (#1001, Q-1001) in the search box.
          </div>
        </div>
      </>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_everything", { q: term });
  if (error) throw new Error(`Search failed: ${error.message}`);
  const groups = groupHits(data as SearchHit[]);
  const help = searchHelp(term, "owner");
  const total = groups.reduce((n, g) => n + g.hits.length, 0) + help.length;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Search</h1>
          <div className="meta" data-testid="search-summary">
            {total === 0 ? "No matches" : `${total} ${total === 1 ? "match" : "matches"}`} for &ldquo;{term}&rdquo;
          </div>
        </div>
      </div>

      {total === 0 && (
        <div className="panel">
          <div className="empty">
            <div className="big">Nothing found</div>
            Try fewer letters, part of a name, a phone number or a street.
          </div>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.kind} className="panel" aria-labelledby={`search-${g.kind}`} data-testid={`search-${g.kind}`}>
          <div className="panel-head">
            <h3 id={`search-${g.kind}`}>
              {g.label} <span className="subtext">({g.hits.length})</span>
            </h3>
          </div>
          <ul className="search-results">
            {g.hits.map((hit) => (
              <li key={hit.id}>
                <Link href={hitHref(hit)} className="search-hit">
                  <HitLine hit={hit} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {help.length > 0 && (
        <section className="panel" aria-labelledby="search-help" data-testid="search-help">
          <div className="panel-head">
            <h3 id="search-help">
              Help <span className="subtext">({help.length})</span>
            </h3>
          </div>
          <ul className="search-results">
            {help.map((t) => (
              <li key={t.id}>
                <Link href={`/help#${t.id}`} className="search-hit">
                  <b>{t.question}</b>
                  <span className="subtext">{t.answer[0]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
