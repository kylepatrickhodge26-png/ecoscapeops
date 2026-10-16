import type { Metadata } from "next";

import { requireOwner } from "@/lib/auth";
import { formatPrice } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

import { HubTiles } from "../hub-tiles";

export const metadata: Metadata = { title: "Money" };

export default async function MoneyPage() {
  await requireOwner();
  const supabase = await createClient();
  const { data } = await supabase.rpc("dashboard_summary");
  const s = data?.[0];
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Money</h1>
          <div className="meta">Price jobs, get paid, and see what you&apos;re making</div>
        </div>
      </div>
      <HubTiles
        tiles={[
          { href: "/quotes", title: "Quotes", text: "Price a job and send it. When they say yes, it's booked." },
          {
            href: "/invoices",
            title: "Invoices",
            text: "Bill for finished visits and record payments.",
            stat: s ? `${formatPrice(s.outstanding ?? 0)} owed to you` : undefined,
          },
          {
            href: "/expenses",
            title: "Expenses",
            text: "Log gas, equipment, mulch and other costs.",
            stat: s ? `${formatPrice(s.month_expenses ?? 0)} this month` : undefined,
          },
          { href: "/reports", title: "Reports", text: "Revenue, profit and exports for your accountant." },
        ]}
      />
    </>
  );
}
