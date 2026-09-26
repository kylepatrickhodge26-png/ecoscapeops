import type { Metadata } from "next";
import Link from "next/link";

import { requireOwner } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers/schema";
import { isISODate, todayInTimeZone } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

import { BookingForm, type BookingCustomer } from "./booking-form";

export const metadata: Metadata = { title: "Book a job · EcoScape Ops" };

export default async function NewBookingPage(props: PageProps<"/schedule/new">) {
  const { business } = await requireOwner();
  const params = await props.searchParams;
  const today = todayInTimeZone(business.time_zone);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, phone, email, preferred_day, status")
    .eq("business_id", business.id);
  if (error) throw new Error(`Could not load customers: ${error.message}`);

  const customers: BookingCustomer[] = data
    .map((c) => ({ id: c.id, name: customerDisplayName(c), preferredDay: c.preferred_day, inactive: c.status !== "active" }))
    .sort((a, b) => Number(a.inactive) - Number(b.inactive) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const presetCustomer = customers.find((c) => c.id === params.customer)?.id ?? "";
  const presetDate = isISODate(params.date) && params.date >= today ? params.date : "";

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href={presetCustomer ? `/customers/${presetCustomer}` : "/schedule"}>
            ← {presetCustomer ? "Customer" : "Schedule"}
          </Link>
          <h1>Book a job</h1>
        </div>
      </div>
      {customers.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <div className="big">Add a customer first</div>
            <p>Jobs are booked for a customer.</p>
            <Link className="btn small" href="/customers/new">
              + Add customer
            </Link>
          </div>
        </div>
      ) : (
        <BookingForm customers={customers} today={today} presetCustomer={presetCustomer} presetDate={presetDate} />
      )}
    </>
  );
}
