import type { Metadata } from "next";
import Link from "next/link";

import { requireOwner } from "@/lib/auth";
import { todayInTimeZone } from "@/lib/dates";
import { isExpenseCategory } from "@/lib/expenses/schema";

import { createExpense } from "../actions";
import { ExpenseForm } from "../expense-form";

export const metadata: Metadata = { title: "Add expense · EcoScape Ops" };

export default async function NewExpensePage(props: PageProps<"/expenses/new">) {
  const { business } = await requireOwner();
  const { category } = await props.searchParams;

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href="/expenses">
            ← Expenses
          </Link>
          <h1>Add expense</h1>
        </div>
      </div>
      <ExpenseForm
        action={createExpense}
        initialValues={{
          spent_on: todayInTimeZone(business.time_zone),
          category: isExpenseCategory(category) ? category : "fuel",
          amount: "",
          vendor: "",
          notes: "",
        }}
        submitLabel="Add expense"
        cancelHref="/expenses"
      />
    </>
  );
}
