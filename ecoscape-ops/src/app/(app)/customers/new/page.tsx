import type { Metadata } from "next";
import Link from "next/link";

import { requireOwner } from "@/lib/auth";
import { assigneeOptions, getCrew, showAssignment } from "@/lib/crew";
import { emptyCustomerFormValues } from "@/lib/customers/schema";
import { addDays, todayInTimeZone, weekdayOf } from "@/lib/dates";

import { createCustomer } from "../actions";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "Add customer" };

export default async function NewCustomerPage() {
  const { business, user } = await requireOwner();
  const today = todayInTimeZone(business.time_zone);
  // Their first visit defaults to today (Monday when today is a Sunday).
  const firstVisit = weekdayOf(today) === 0 ? addDays(today, 1) : today;
  const crew = await getCrew(business.id, user.id);
  const assignees = showAssignment(crew) ? assigneeOptions(crew, user.id) : undefined;

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href="/customers">
            ← Customers
          </Link>
          <h1>Add customer</h1>
        </div>
      </div>
      <CustomerForm
        action={createCustomer}
        initialValues={emptyCustomerFormValues()}
        submitLabel="Add customer"
        cancelHref="/customers"
        booking={{ today, firstVisit, assignees }}
      />
    </>
  );
}
