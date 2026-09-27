import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ConfirmButton } from "@/components/confirm-button";
import { requireOwner } from "@/lib/auth";
import { formatShortDate, monthOf } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/expenses/schema";
import { formatPrice } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

import { deleteExpense, updateExpense } from "../../actions";
import { ExpenseForm } from "../../expense-form";

export const metadata: Metadata = { title: "Edit expense · EcoScape Ops" };

export default async function EditExpensePage(props: PageProps<"/expenses/[id]/edit">) {
  await requireOwner();
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();

  // Another business's expense is invisible under RLS, so it 404s like a missing one.
  const supabase = await createClient();
  const { data: expense, error } = await supabase.from("expenses").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load expense: ${error.message}`);
  if (!expense) notFound();

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href={`/expenses?month=${monthOf(expense.spent_on)}`}>
            ← Expenses
          </Link>
          <h1>Edit expense</h1>
        </div>
        <ConfirmButton
          action={deleteExpense.bind(null, expense.id)}
          label="Delete"
          confirmLabel="Yes, delete"
          pendingLabel="Deleting…"
          confirmText={
            <>
              Delete this {formatPrice(expense.amount)} {EXPENSE_CATEGORY_LABELS[expense.category].toLowerCase()}{" "}
              expense from {formatShortDate(expense.spent_on)}? This can&apos;t be undone.
            </>
          }
        />
      </div>
      <ExpenseForm
        action={updateExpense.bind(null, expense.id)}
        initialValues={{
          spent_on: expense.spent_on,
          category: expense.category,
          amount: expense.amount.toFixed(2),
          vendor: expense.vendor,
          notes: expense.notes,
        }}
        submitLabel="Save changes"
        cancelHref={`/expenses?month=${monthOf(expense.spent_on)}`}
      />
    </>
  );
}
