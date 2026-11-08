import type { Metadata } from "next";
import Link from "next/link";

import { requireOwner } from "@/lib/auth";
import { customerDisplayName, preferredDayLabel, type Customer } from "@/lib/customers/schema";
import { getShop } from "@/lib/geo/customers";
import { createClient } from "@/lib/supabase/server";

import { MoreMenu } from "@/components/more-menu";
import { Notice } from "@/components/notice";

import { LocateProgress } from "./locate-progress";

export const metadata: Metadata = { title: "Customers" };

type ListCustomer = Pick<
  Customer,
  "id" | "first_name" | "last_name" | "phone" | "email" | "property_address" | "preferred_day" | "status" | "geo_status"
>;

// A count from the address (after an import); anything else is 0.
const count = (v: string | string[] | undefined) => (typeof v === "string" && /^\d{1,4}$/.test(v) ? Number(v) : 0);

// Last name, then first name; customers without a name sort by phone/email.
const sortKey = (c: ListCustomer) => `${c.last_name} ${c.first_name}`.trim() || c.phone || c.email;

export default async function CustomersPage(props: PageProps<"/customers">) {
  const { business } = await requireOwner();
  const { notice, added, same, bad } = await props.searchParams;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, phone, email, property_address, preferred_day, status, geo_status")
    .eq("business_id", business.id);
  if (error) throw new Error(`Could not load customers: ${error.message}`);

  // Addresses still to look up, e.g. right after an import.
  const waiting = data.filter((c) => c.geo_status === "pending").length;
  const shop = waiting > 0 ? await getShop(business.id) : null;

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
        <div className="head-actions">
          <Link className="btn" href="/customers/new">
            + Add customer
          </Link>
          <MoreMenu>
            <Link href="/customers/import">Import a list</Link>
          </MoreMenu>
        </div>
      </div>

      {notice === "deleted" && <Notice tone="success">Customer deleted.</Notice>}
      {notice === "imported" && (
        <Notice tone="success">
          Added {count(added)} {count(added) === 1 ? "customer" : "customers"} from your list.
          {count(same) > 0 && ` ${count(same)} ${count(same) === 1 ? "was" : "were"} already in your customers.`}
          {count(bad) > 0 && ` ${count(bad)} ${count(bad) === 1 ? "row was" : "rows were"} left out.`} Open each one to book
          their work.
        </Notice>
      )}
      {waiting > 0 &&
        (shop ? (
          <LocateProgress waiting={waiting} />
        ) : (
          <Notice tone="warn">
            <Link href="/settings">Set your shop address</Link> so your customers&apos; addresses can be looked up and their
            visits put in route order.
          </Notice>
        ))}

      <div className="panel">
        <div className="panel-body flush">
          {customers.length === 0 ? (
            <div className="empty">
              <div className="big">No customers yet</div>
              <p>Add your first one, or bring in the list you already have.</p>
              <div className="empty-actions">
                <Link className="btn small" href="/customers/new">
                  + Add customer
                </Link>
                <Link className="btn secondary small" href="/customers/import">
                  Import a list
                </Link>
              </div>
            </div>
          ) : (
            <table className="customer-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Property address</th>
                  <th>Preferred day</th>
                  <th>Status</th>
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
