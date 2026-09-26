import type { Metadata } from "next";
import Link from "next/link";

import { requireOwner } from "@/lib/auth";
import { customerDisplayName, preferredDayLabel, type Customer } from "@/lib/customers/schema";
import { createClient } from "@/lib/supabase/server";

import { Notice } from "@/components/notice";

export const metadata: Metadata = { title: "Customers · EcoScape Ops" };

type ListCustomer = Pick<
  Customer,
  "id" | "first_name" | "last_name" | "phone" | "email" | "property_address" | "preferred_day" | "status"
>;

// Last name, then first name; customers without a name sort by phone/email.
const sortKey = (c: ListCustomer) => `${c.last_name} ${c.first_name}`.trim() || c.phone || c.email;

export default async function CustomersPage(props: PageProps<"/customers">) {
  const { business } = await requireOwner();
  const { notice } = await props.searchParams;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, phone, email, property_address, preferred_day, status")
    .eq("business_id", business.id);
  if (error) throw new Error(`Could not load customers: ${error.message}`);

  const customers = [...data].sort((a, b) =>
    sortKey(a).localeCompare(sortKey(b), undefined, { sensitivity: "base" }),
  );

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Customers</h1>
          <div className="meta">
            {customers.length} {customers.length === 1 ? "customer" : "customers"}
          </div>
        </div>
        <Link className="btn" href="/customers/new">
          + Add customer
        </Link>
      </div>

      {notice === "deleted" && <Notice tone="success">Customer deleted.</Notice>}

      <div className="panel">
        <div className="panel-body flush">
          {customers.length === 0 ? (
            <div className="empty">
              <div className="big">No customers yet</div>
              Add your first customer to get started.
            </div>
          ) : (
            <table className="customer-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Property address</th>
                  <th>Preferred day</th>
                  <th>Status</th>
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td className="name-cell">
                      <Link className="row-link" href={`/customers/${c.id}`}>
                        <b>{customerDisplayName(c)}</b>
                      </Link>
                      {c.phone && <div className="subtext nowrap">{c.phone}</div>}
                    </td>
                    <td className="address-cell">{c.property_address || "—"}</td>
                    <td className="day-cell">{preferredDayLabel(c.preferred_day)}</td>
                    <td className="status-cell">
                      <span className={`pill ${c.status === "active" ? "completed" : "cancelled"}`}>{c.status}</span>
                    </td>
                    <td className="actions-cell">
                      <Link className="btn secondary small" href={`/customers/${c.id}`}>
                        View
                      </Link>
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
