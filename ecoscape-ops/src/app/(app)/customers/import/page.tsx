import type { Metadata } from "next";
import Link from "next/link";

import { requireOwner } from "@/lib/auth";

import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import customers" };

export default async function ImportCustomersPage() {
  await requireOwner();
  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href="/customers">
            ← Customers
          </Link>
          <h1>Import customers</h1>
          <div className="meta">Bring in the customers you already have, all at once.</div>
        </div>
      </div>
      <ImportForm />
    </>
  );
}
