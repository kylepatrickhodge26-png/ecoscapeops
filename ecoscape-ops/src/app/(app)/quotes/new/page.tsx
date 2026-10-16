import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers/schema";
import { addDays, todayInTimeZone } from "@/lib/dates";
import { DEFAULT_QUOTE_DAYS } from "@/lib/quotes/constants";

import { saveQuote } from "../actions";
import { quoteCustomers } from "../queries";
import { QuoteForm } from "../quote-form";

export const metadata: Metadata = { title: "New quote · EcoScape Ops" };

export default async function NewQuotePage(props: PageProps<"/quotes/new">) {
  const { business } = await requireOwner();
  const { customer: customerParam } = await props.searchParams;
  const today = todayInTimeZone(business.time_zone);
  const customers = (await quoteCustomers(business.id)).map((c) => ({ id: c.id, name: customerDisplayName(c) }));
  const preset = typeof customerParam === "string" && z.uuid().safeParse(customerParam).success && customers.some((c) => c.id === customerParam) ? customerParam : "";

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href="/quotes">
            ← Quotes
          </Link>
          <h1>New quote</h1>
        </div>
      </div>
      <QuoteForm
        action={saveQuote.bind(null, null)}
        customers={customers}
        today={today}
        initialValues={{
          customer_id: preset,
          prospect_name: "",
          prospect_phone: "",
          prospect_email: "",
          prospect_address: "",
          title: "",
          expires_on: addDays(today, DEFAULT_QUOTE_DAYS),
          notes: "",
          lines: [{ description: "", quantity: "1", unit_price: "" }],
        }}
        submitLabel="Save draft"
        cancelHref="/quotes"
      />
    </>
  );
}
