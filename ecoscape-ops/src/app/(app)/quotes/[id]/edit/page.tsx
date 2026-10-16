import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireOwner } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers/schema";
import { quoteNumber } from "@/lib/quotes/constants";

import { saveQuote } from "../../actions";
import { getQuoteOr404, quoteCustomers } from "../../queries";
import { QuoteForm } from "../../quote-form";

export const metadata: Metadata = { title: "Edit quote" };

export default async function EditQuotePage(props: PageProps<"/quotes/[id]/edit">) {
  const { business } = await requireOwner();
  const { id } = await props.params;
  const quote = await getQuoteOr404(id);
  // Only drafts can be changed; copy a sent quote to revise it.
  if (quote.status !== "draft") redirect(`/quotes/${quote.id}`);
  const customers = (await quoteCustomers(business.id)).map((c) => ({ id: c.id, name: customerDisplayName(c) }));

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href={`/quotes/${quote.id}`}>
            ← Quote {quoteNumber(quote.number)}
          </Link>
          <h1>Edit quote {quoteNumber(quote.number)}</h1>
        </div>
      </div>
      <QuoteForm
        action={saveQuote.bind(null, quote.id)}
        customers={customers}
        today={quote.issue_date}
        initialValues={{
          customer_id: quote.customer_id ?? "",
          prospect_name: quote.prospect_name,
          prospect_phone: quote.prospect_phone,
          prospect_email: quote.prospect_email,
          prospect_address: quote.prospect_address,
          title: quote.title,
          expires_on: quote.expires_on,
          notes: quote.notes,
          lines: quote.quote_lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unit_price: l.unit_price.toFixed(2) })),
        }}
        submitLabel="Save draft"
        cancelHref={`/quotes/${quote.id}`}
      />
    </>
  );
}
