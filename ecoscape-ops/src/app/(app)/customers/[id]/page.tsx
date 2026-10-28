import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/action-button";
import { ConfirmButton } from "@/components/confirm-button";
import { InvoiceStatusPill } from "@/components/invoice-status";
import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import {
  NOTIFICATION_PREFERENCE_LABELS,
  customerDisplayName,
  preferredDayLabel,
  type NotificationPreference,
} from "@/lib/customers/schema";
import { formatShortDate, isISODate, todayInTimeZone } from "@/lib/dates";
import { getShop } from "@/lib/geo/customers";
import { geoProblem } from "@/lib/geo/locate";
import { invoiceNumber } from "@/lib/invoices/constants";
import { PHOTO_BUCKET, PHOTO_KIND_LABELS } from "@/lib/photos/constants";
import { formatPrice } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

import {
  deleteCustomer,
  endCustomerSeason,
  inviteCustomer,
  locateCustomerNow,
  removeCustomerAccess,
  setBillMonthly,
  startCustomerSeason,
} from "../actions";
import { getCustomerOr404 } from "../get-customer";
import { BillMonthlyToggle } from "./bill-monthly-toggle";
import { CustomerInviteButton } from "./customer-account";
import { CustomerSchedule } from "./customer-schedule";
import { DeleteCustomerButton } from "./delete-customer-button";

export const metadata: Metadata = { title: "Customer" };

const NOTICES: Record<string, string> = {
  created: "Customer added.",
  updated: "Changes saved.",
  located: "Address looked up.",
  "access-removed": "Their account access was removed. Their login now shows nothing.",
};

function formatDate(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function CustomerPage(props: PageProps<"/customers/[id]">) {
  const { business } = await requireOwner();
  const { id } = await props.params;
  const { notice, removed, next } = await props.searchParams;
  const customer = await getCustomerOr404(id);
  const supabase = await createClient();
  const today = todayInTimeZone(business.time_zone);
  const inactive = customer.status === "inactive";
  // Upcoming repeat visits that "Done for the season" would take off the schedule.
  const { count: repeatVisits, error: repeatError } = await supabase
    .from("jobs")
    .select("id, service_plans!inner(frequency)", { count: "exact", head: true })
    .eq("customer_id", customer.id)
    .gte("scheduled_date", today)
    .in("status", ["scheduled", "assigned", "weather_delay"])
    .neq("service_plans.frequency", "one_time");
  if (repeatError) throw new Error(`Could not load visits: ${repeatError.message}`);
  const { count: visitCount } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customer.id);
  const { data: invoices, error: invoicesError } = await supabase
    .from("invoices")
    .select("id, number, issue_date, total, display_status")
    .eq("customer_id", customer.id)
    .order("number", { ascending: false });
  if (invoicesError) throw new Error(`Could not load invoices: ${invoicesError.message}`);
  const { data: photos, error: photosError } = await supabase
    .from("job_photos")
    .select("id, storage_path, kind, caption, created_at, jobs!inner(id, service_name, scheduled_date, customer_id)")
    .eq("jobs.customer_id", customer.id)
    .order("created_at", { ascending: false })
    .limit(60);
  if (photosError) throw new Error(`Could not load photos: ${photosError.message}`);
  const photoUrls = new Map<string, string>();
  if (photos.length > 0) {
    const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(
      photos.map((p) => p.storage_path),
      3600,
    );
    for (const sgn of signed ?? []) if (sgn.path && sgn.signedUrl) photoUrls.set(sgn.path, sgn.signedUrl);
  }
  const { data: account, error: accountError } = await supabase
    .from("customer_accounts")
    .select("email, joined_at, invite_expires_at, user_id")
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (accountError) throw new Error(`Could not load the customer's account: ${accountError.message}`);
  const name = customerDisplayName(customer);
  const contact = [customer.phone, customer.email].filter(Boolean).join(" · ");
  const shop = customer.property_address ? await getShop(business.id) : null;
  const problem = geoProblem(customer.geo_status, customer.geo_matched_address, customer.geo_distance_miles);

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
          {inactive ? (
            <ActionButton action={startCustomerSeason.bind(null, customer.id)} label="Start again" pendingLabel="Starting…" />
          ) : (
            <ConfirmButton
              action={endCustomerSeason.bind(null, customer.id)}
              label="Done for the season"
              confirmLabel="Yes, done for the season"
              pendingLabel="Saving…"
              danger={false}
              confirmText={
                <>
                  Mark <b>{name}</b> inactive for the season?{" "}
                  {repeatVisits
                    ? `Their ${repeatVisits} upcoming repeat ${repeatVisits === 1 ? "visit comes" : "visits come"} off the schedule. `
                    : ""}
                  One-time jobs stay. Tap Start again when they&apos;re back, and visits return on their regular day.
                </>
              }
            />
          )}
          <Link className="btn secondary small" href={`/customers/${customer.id}/edit`}>
            Edit
          </Link>
          <DeleteCustomerButton
            action={deleteCustomer.bind(null, customer.id)}
            customerName={name}
            visitCount={visitCount ?? 0}
            invoiceCount={invoices.length}
          />
        </div>
      </div>

      {customer.property_address &&
        (!shop ? (
          <Notice tone="warn">
            <Link href="/settings">Set your shop address</Link> to put this customer&apos;s visits in route order.
          </Notice>
        ) : problem ? (
          <Notice tone="warn">
            <span data-testid="geo-problem">{problem}</span> <Link href={`/customers/${customer.id}/edit`}>Edit the address</Link>
          </Notice>
        ) : customer.geo_status === "pending" ? (
          <Notice tone="warn">
            This address hasn&apos;t been looked up for routes yet.{" "}
            <form action={locateCustomerNow.bind(null, customer.id)} className="inline-form">
              <button className="linklike" type="submit">
                Look it up now
              </button>
            </form>
          </Notice>
        ) : null)}

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
      {notice === "season-ended" && (
        <Notice tone="success">
          Done for the season.{" "}
          {Number(removed) > 0
            ? `${removed} upcoming repeat ${removed === "1" ? "visit" : "visits"} came off the schedule. `
            : ""}
          One-time jobs stay. Tap Start again when they&apos;re back.
        </Notice>
      )}
      {notice === "season-started" && (
        <Notice tone="success">
          Back for the season.{" "}
          {typeof next === "string" && isISODate(next)
            ? `Their repeat visits are on the schedule again, starting ${formatShortDate(next)}.`
            : "They're marked active."}
        </Notice>
      )}
      {notice === "booked-waiting" && (
        <Notice tone="success">
          Booked. It starts when you tap Start again, since {name} is done for the season.
        </Notice>
      )}
      {inactive && notice !== "season-ended" && notice !== "booked-waiting" && (
        <Notice tone="warn">
          <span data-testid="season-paused">
            Done for the season: their repeat visits are paused. Tap Start again to bring them back on their regular day.
          </span>
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
      <CustomerSchedule customerId={customer.id} customerName={name} today={today} />

      <div className="panel" aria-labelledby="customer-account" data-testid="customer-account">
        <div className="panel-head">
          <h3 id="customer-account">Customer account</h3>
          {account && <span className={`pill ${account.user_id ? "completed" : "cancelled"}`}>{account.user_id ? "Active" : "Invited"}</span>}
        </div>
        <div className="panel-body">
          {account?.user_id ? (
            <p>
              {name} signs in as <b>{account.email}</b> to see their visits, sent quotes and sent invoices, answer quotes and ask for more
              work. They never see your notes, crew, other customers or anything else.
            </p>
          ) : account ? (
            <p className="hint">
              Invite sent{account.invite_expires_at ? `, link expires ${formatShortDate(account.invite_expires_at.slice(0, 10))}` : ""}. Lost
              it? Make a new one (the old link stops working).
            </p>
          ) : (
            <p className="hint">
              Give {name} their own login to see upcoming visits, quotes and invoices, accept quotes, pay and ask for more work.
            </p>
          )}
          <div className="head-actions">
            {!account?.user_id && (
              <CustomerInviteButton invite={inviteCustomer.bind(null, customer.id)} name={name} label={account ? "New invite link" : "Invite to their account"} />
            )}
            {account && (
              <ConfirmButton
                action={removeCustomerAccess.bind(null, customer.id)}
                label={account.user_id ? "Remove access" : "Cancel invite"}
                confirmLabel="Yes, remove"
                pendingLabel="Removing…"
                confirmText={<>Remove {name}&apos;s account access? Their login will show nothing. You can invite them again later.</>}
              />
            )}
          </div>
        </div>
      </div>

      <div className="panel" aria-labelledby="customer-photos">
        <div className="panel-head">
          <h3 id="customer-photos">Photos</h3>
        </div>
        <div className="panel-body">
          {photos.length === 0 ? (
            <div className="empty">No photos yet. Crew can add before and after photos on each visit.</div>
          ) : (
            <ul className="photo-grid">
              {photos.map((p) => {
                const url = photoUrls.get(p.storage_path);
                return (
                  <li key={p.id}>
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={p.caption || `${PHOTO_KIND_LABELS[p.kind]} photo`} loading="lazy" />
                      </a>
                    )}
                    <div className="photo-meta">
                      <span className={`pill photo-${p.kind}`}>{PHOTO_KIND_LABELS[p.kind]}</span>{" "}
                      <Link href={`/schedule/jobs/${p.jobs.id}`}>
                        {p.jobs.service_name}, {formatShortDate(p.jobs.scheduled_date)}
                      </Link>
                      {p.caption && <div className="subtext">{p.caption}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="panel" aria-labelledby="customer-invoices">
        <div className="panel-head">
          <h3 id="customer-invoices">Invoices</h3>
          <Link className="btn secondary small" href={`/invoices/new?customer=${customer.id}`}>
            + New invoice
          </Link>
        </div>
        <div className="panel-body">
          <BillMonthlyToggle enabled={customer.bill_monthly} save={setBillMonthly.bind(null, customer.id)} />
        </div>
        <div className="panel-body flush">
          {invoices.length === 0 ? (
            <div className="empty">No invoices yet.</div>
          ) : (
            <table className="invoice-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Issued</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <Link className="row-link" href={`/invoices/${inv.id}`}>
                        <b>{invoiceNumber(inv.number)}</b>
                      </Link>
                    </td>
                    <td className="nowrap">{formatShortDate(inv.issue_date)}</td>
                    <td className="num">{formatPrice(inv.total)}</td>
                    <td>
                      <InvoiceStatusPill status={inv.display_status} />
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
