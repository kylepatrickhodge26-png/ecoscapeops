import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers/schema";
import { addDays, formatShortDate, todayInTimeZone } from "@/lib/dates";
import { DEFAULT_TERMS_DAYS } from "@/lib/invoices/constants";
import { createClient } from "@/lib/supabase/server";

import { saveInvoice } from "../actions";
import { InvoiceForm } from "../invoice-form";
import { billableVisits } from "../queries";

export const metadata: Metadata = { title: "New invoice · EcoScape Ops" };

export default async function NewInvoicePage(props: PageProps<"/invoices/new">) {
  const { business } = await requireOwner();
  const { customer: customerParam, visit: visitParam } = await props.searchParams;
  const today = todayInTimeZone(business.time_zone);
  const supabase = await createClient();

  const customerId = typeof customerParam === "string" && z.uuid().safeParse(customerParam).success ? customerParam : null;
  const { data: customer } = customerId
    ? await supabase.from("customers").select("id, first_name, last_name, phone, email").eq("id", customerId).maybeSingle()
    : { data: null };

  const head = (
    <div className="pagehead">
      <div>
        <Link className="backlink" href="/invoices">
          ← Invoices
        </Link>
        <h1>New invoice</h1>
      </div>
    </div>
  );

  // First choose who it's for.
  if (!customer) {
    const { data: customers, error } = await supabase
      .from("customers")
      .select("id, first_name, last_name, phone, email")
      .eq("business_id", business.id)
      .order("last_name")
      .order("first_name");
    if (error) throw new Error(`Could not load customers: ${error.message}`);
    return (
      <>
        {head}
        {customers.length === 0 ? (
          <div className="panel">
            <div className="empty">
              <div className="big">No customers yet</div>
              <Link href="/customers/new">Add a customer</Link> first.
            </div>
          </div>
        ) : (
          <form className="panel panel-body customer-form" method="get">
            <div className="field">
              <label htmlFor="customer">Customer</label>
              <select id="customer" name="customer" defaultValue="" required>
                <option value="" disabled>
                  Choose a customer…
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {customerDisplayName(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-actions">
              <Link className="btn secondary" href="/invoices">
                Cancel
              </Link>
              <button className="btn" type="submit">
                Continue
              </button>
            </div>
          </form>
        )}
      </>
    );
  }

  const visits = await billableVisits(customer.id, today);
  const preselected = visits.find((v) => v.id === visitParam);

  return (
    <>
      {head}
      <InvoiceForm
        action={saveInvoice.bind(null, null)}
        customer={{ id: customer.id, name: customerDisplayName(customer) }}
        visits={visits}
        today={today}
        initialValues={{
          customer_id: customer.id,
          due_date: addDays(today, DEFAULT_TERMS_DAYS),
          notes: "",
          lines: preselected
            ? [
                {
                  job_id: preselected.id,
                  description: `${preselected.service_name} (${formatShortDate(preselected.scheduled_date)})`,
                  quantity: "1",
                  unit_price: preselected.price.toFixed(2),
                },
              ]
            : [],
        }}
        submitLabel="Save draft"
        cancelHref="/invoices"
      />
    </>
  );
}
