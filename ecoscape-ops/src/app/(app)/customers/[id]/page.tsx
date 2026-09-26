import type { Metadata } from "next";
import Link from "next/link";

import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import {
  NOTIFICATION_PREFERENCE_LABELS,
  customerDisplayName,
  preferredDayLabel,
  type NotificationPreference,
} from "@/lib/customers/schema";
import { todayInTimeZone } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

import { deleteCustomer } from "../actions";
import { getCustomerOr404 } from "../get-customer";
import { CustomerSchedule } from "./customer-schedule";
import { DeleteCustomerButton } from "./delete-customer-button";

export const metadata: Metadata = { title: "Customer · EcoScape Ops" };

const NOTICES: Record<string, string> = {
  created: "Customer added.",
  updated: "Changes saved.",
};

function formatDate(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function CustomerPage(props: PageProps<"/customers/[id]">) {
  const { business } = await requireOwner();
  const { id } = await props.params;
  const { notice, removed } = await props.searchParams;
  const customer = await getCustomerOr404(id);
  const supabase = await createClient();
  const { count: visitCount } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customer.id);
  const name = customerDisplayName(customer);
  const contact = [customer.phone, customer.email].filter(Boolean).join(" · ");

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href="/customers">
            ← Customers
          </Link>
          <h1>{name}</h1>
          {customer.property_address && <div className="meta">{customer.property_address}</div>}
          {contact && <div className="meta">{contact}</div>}
        </div>
        <div className="head-actions">
          <Link className="btn secondary small" href={`/customers/${customer.id}/edit`}>
            Edit
          </Link>
          <DeleteCustomerButton
            action={deleteCustomer.bind(null, customer.id)}
            customerName={name}
            visitCount={visitCount ?? 0}
          />
        </div>
      </div>

      {typeof notice === "string" && NOTICES[notice] && (
        <Notice tone="success">
          {NOTICES[notice]}
          {notice === "created" && (
            <>
              {" "}
              <Link href={`/schedule/new?customer=${customer.id}`}>Book their first service →</Link>
            </>
          )}
        </Notice>
      )}
      {notice === "stopped" && (
        <Notice tone="success">
          Service stopped.{" "}
          {Number(removed) > 0
            ? `${removed} upcoming ${removed === "1" ? "visit was" : "visits were"} removed from the schedule.`
            : "No more visits will be added."}
        </Notice>
      )}

      {customer.access_instructions && <div className="notice">Access: {customer.access_instructions}</div>}
      {customer.service_notes && <div className="notice pre-line">Notes: {customer.service_notes}</div>}

      <div className="panel">
        <div className="panel-head">
          <h3>Details</h3>
        </div>
        <div className="panel-body">
          <dl className="details">
            <div>
              <dt>Status</dt>
              <dd>
                <span className={`pill ${customer.status === "active" ? "completed" : "cancelled"}`}>
                  {customer.status}
                </span>
              </dd>
            </div>
            <div>
              <dt>Preferred day</dt>
              <dd>{preferredDayLabel(customer.preferred_day)}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{customer.phone || "—"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{customer.email || "—"}</dd>
            </div>
            <div>
              <dt>Property address</dt>
              <dd>{customer.property_address || "—"}</dd>
            </div>
            <div>
              <dt>Billing address</dt>
              <dd>{customer.billing_address || "Same as property"}</dd>
            </div>
            <div>
              <dt>Notification preference</dt>
              <dd>
                {NOTIFICATION_PREFERENCE_LABELS[customer.notification_preference as NotificationPreference] ??
                  customer.notification_preference}
              </dd>
            </div>
            <div>
              <dt>SMS opt-in</dt>
              <dd>{customer.sms_opt_in ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Customer since</dt>
              <dd>{formatDate(customer.customer_since)}</dd>
            </div>
          </dl>
        </div>
      </div>
      <CustomerSchedule customerId={customer.id} customerName={name} today={todayInTimeZone(business.time_zone)} />
    </>
  );
}
