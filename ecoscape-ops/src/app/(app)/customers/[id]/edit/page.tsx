import type { Metadata } from "next";
import Link from "next/link";

import { requireOwner } from "@/lib/auth";
import { customerDisplayName, customerFormValuesFromCustomer } from "@/lib/customers/schema";

import { updateCustomer } from "../../actions";
import { CustomerForm } from "../../customer-form";
import { getCustomerOr404 } from "../../get-customer";

export const metadata: Metadata = { title: "Edit customer · EcoScape Ops" };

export default async function EditCustomerPage(props: PageProps<"/customers/[id]/edit">) {
  await requireOwner();
  const { id } = await props.params;
  const customer = await getCustomerOr404(id);

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href={`/customers/${customer.id}`}>
            ← {customerDisplayName(customer)}
          </Link>
          <h1>Edit customer</h1>
        </div>
      </div>
      <CustomerForm
        action={updateCustomer.bind(null, customer.id)}
        initialValues={customerFormValuesFromCustomer(customer)}
        submitLabel="Save changes"
        cancelHref={`/customers/${customer.id}`}
      />
    </>
  );
}
