import type { Metadata } from "next";
import Link from "next/link";

import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers/schema";
import { getShop } from "@/lib/geo/customers";
import { MAX_MILES_FROM_SHOP, geoProblem } from "@/lib/geo/locate";
import { createClient } from "@/lib/supabase/server";

import { locateRemainingCustomers } from "./actions";
import { ShopForm } from "./shop-form";

export const metadata: Metadata = { title: "Settings" };

const NOTICES: Record<string, string> = {
  shop: "Shop address saved.",
  located: "Customer addresses looked up.",
};

export default async function SettingsPage(props: PageProps<"/settings">) {
  const { business } = await requireOwner();
  const { notice } = await props.searchParams;
  const shop = await getShop(business.id);

  const supabase = await createClient();
  const { data: customers, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, phone, email, property_address, geo_status, geo_matched_address, geo_distance_miles")
    .eq("business_id", business.id)
    .neq("property_address", "");
  if (error) throw new Error(`Could not load customers: ${error.message}`);
  const count = (status: string) => customers.filter((c) => c.geo_status === status).length;
  const needsAttention = customers.filter((c) => c.geo_status === "flagged" || c.geo_status === "not_found");
  const pending = count("pending");

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Settings</h1>
          <div className="meta">{business.name}</div>
        </div>
      </div>
      {typeof notice === "string" && NOTICES[notice] && <Notice tone="success">{NOTICES[notice]}</Notice>}

      <div className="panel">
        <div className="panel-head">
          <h3>Checklists &amp; photos</h3>
          <Link className="btn secondary small" href="/settings/checklists">
            Manage
          </Link>
        </div>
        <div className="panel-body">
          <p className="hint">Give each service a checklist for crew to tick off, and see how much photo storage you&apos;re using.</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Customer FAQ</h3>
          <Link className="btn secondary small" href="/settings/faq">
            Manage
          </Link>
        </div>
        <div className="panel-body">
          <p className="hint">Answer the questions customers always ask. They see them on their account page and your request form.</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Shop address</h3>
        </div>
        <div className="panel-body">
          {shop && (
            <p className="shop-found" data-testid="shop-found">
              Found: <b>{shop.matched_address}</b>
            </p>
          )}
          <ShopForm current={shop?.address ?? ""} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Customer addresses on the map</h3>
        </div>
        <div className="panel-body" data-testid="geo-summary">
          {!shop ? (
            <p className="hint">Save your shop address first. Then each customer&apos;s address is looked up so visits can be put in route order.</p>
          ) : (
            <>
              <p>
                {count("located")} located · {pending} waiting · {needsAttention.length} need a look
              </p>
              <p className="hint">
                Looked up with the free U.S. Census Bureau geocoder, in your shop&apos;s town unless the address names its own.
                Anything over {MAX_MILES_FROM_SHOP} miles from the shop is flagged instead of used.
              </p>
              {pending > 0 && (
                <form action={locateRemainingCustomers}>
                  <button className="btn secondary small" type="submit">
                    Look up {pending} waiting {pending === 1 ? "address" : "addresses"}
                  </button>
                </form>
              )}
              {needsAttention.length > 0 && (
                <ul className="geo-problems">
                  {needsAttention.map((c) => (
                    <li key={c.id}>
                      <Link href={`/customers/${c.id}`}>
                        <b>{customerDisplayName(c)}</b>
                      </Link>{" "}
                      · {c.property_address}
                      <div className="subtext">{geoProblem(c.geo_status, c.geo_matched_address, c.geo_distance_miles)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
