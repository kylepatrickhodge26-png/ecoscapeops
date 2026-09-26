import type { Metadata } from "next";
import Link from "next/link";

import { requireOwner } from "@/lib/auth";
import { emptyCustomerFormValues } from "@/lib/customers/schema";

import { createCustomer } from "../actions";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "Add customer · EcoScape Ops" };

export default async function NewCustomerPage() {
  await requireOwner();

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
      />
    </>
  );
}
