import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireOwner } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers/schema";
import { todayInTimeZone } from "@/lib/dates";
import { invoiceNumber } from "@/lib/invoices/constants";

import { saveInvoice } from "../../actions";
import { InvoiceForm } from "../../invoice-form";
import { billableVisits, getInvoiceOr404 } from "../../queries";

export const metadata: Metadata = { title: "Edit invoice · EcoScape Ops" };

export default async function EditInvoicePage(props: PageProps<"/invoices/[id]/edit">) {
  const { business } = await requireOwner();
  const { id } = await props.params;
  const invoice = await getInvoiceOr404(id);
  // Only drafts can be changed.
  if (invoice.status !== "draft" || !invoice.customer) redirect(`/invoices/${invoice.id}`);
  const today = todayInTimeZone(business.time_zone);
  const visits = await billableVisits(invoice.customer.id, today, invoice.id);

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href={`/invoices/${invoice.id}`}>
            ← Invoice {invoiceNumber(invoice.number)}
          </Link>
          <h1>Edit invoice {invoiceNumber(invoice.number)}</h1>
        </div>
      </div>
      <InvoiceForm
        action={saveInvoice.bind(null, invoice.id)}
        customer={{ id: invoice.customer.id, name: customerDisplayName(invoice.customer) }}
        visits={visits}
        today={invoice.issue_date}
        initialValues={{
          customer_id: invoice.customer.id,
          due_date: invoice.due_date,
          notes: invoice.notes,
          lines: invoice.invoice_lines.map((l) => ({
            job_id: l.job_id,
            description: l.description,
            quantity: String(l.quantity),
            unit_price: l.unit_price.toFixed(2),
          })),
        }}
        submitLabel="Save draft"
        cancelHref={`/invoices/${invoice.id}`}
      />
    </>
  );
}
