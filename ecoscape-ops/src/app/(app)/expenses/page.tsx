import type { Metadata } from "next";
import Link from "next/link";

import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { addDays, addMonths, formatMonth, formatShortDate, isISOMonth, monthOf, todayInTimeZone } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from "@/lib/expenses/schema";
import { formatPrice } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

import { quickLogExpense } from "./actions";
import { QuickLog } from "./quick-log";

export const metadata: Metadata = { title: "Expenses" };

const NOTICES: Record<string, string> = {
  added: "Expense added.",
  updated: "Changes saved.",
  deleted: "Expense deleted.",
};

export default async function ExpensesPage(props: PageProps<"/expenses">) {
  const { business } = await requireOwner();
  const params = await props.searchParams;
  const logged = typeof params.logged === "string" ? params.logged : undefined;
  const today = todayInTimeZone(business.time_zone);
  const month = isISOMonth(params.month) ? params.month : monthOf(today);
  const monthEnd = addDays(`${addMonths(month, 1)}-01`, -1);

  const supabase = await createClient();
  const { data: expenses, error } = await supabase
    .from("expenses")
    .select("id, spent_on, category, amount, vendor, notes")
    .eq("business_id", business.id)
    .gte("spent_on", `${month}-01`)
    .lte("spent_on", monthEnd)
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load expenses: ${error.message}`);

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const byCategory = new Map<ExpenseCategory, number>();
  for (const e of expenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Expenses</h1>
          <div className="meta">Owner only — crew members never see expenses</div>
        </div>
        <Link className="btn" href="/expenses/new">
          + Add expense
        </Link>
      </div>

      {/* One tap for the everyday costs: today's date, an amount, and where. Keyed on the last
          logged expense so the forms close after saving. */}
      <div className="quick-row" role="group" aria-label="Quick log">
        <QuickLog key={`fuel-${logged}`} action={quickLogExpense.bind(null, "fuel")} label="Log gas" vendorPlaceholder="e.g. Speedway" />
        <QuickLog
          key={`equipment-${logged}`}
          action={quickLogExpense.bind(null, "equipment")}
          label="Log equipment"
          vendorPlaceholder="e.g. Home Depot"
        />
      </div>

      <LoggedNotice expenseId={logged} />
      {typeof params.notice === "string" && NOTICES[params.notice] && (
        <Notice tone="success">{NOTICES[params.notice]}</Notice>
      )}

      <div className="cal-header-row">
        <div className="cal-nav">
          <Link className="btn secondary small" href={`/expenses?month=${addMonths(month, -1)}`} aria-label="Previous month">
            ←
          </Link>
          <h2 className="cal-month">{formatMonth(month)}</h2>
          <Link className="btn secondary small" href={`/expenses?month=${addMonths(month, 1)}`} aria-label="Next month">
            →
          </Link>
          {month !== monthOf(today) && (
            <Link className="btn secondary small" href="/expenses">
              This month
            </Link>
          )}
        </div>
      </div>

      <div className="grid g2">
        <div className="card accent-clay" data-card="month-total">
          <div className="label">SPENT · {formatMonth(month).toUpperCase()}</div>
          <div className="big">{formatPrice(total)}</div>
          <div className="sub">
            {expenses.length} {expenses.length === 1 ? "entry" : "entries"}
          </div>
        </div>
        <div className="card" data-card="by-category">
          <div className="label">BY CATEGORY</div>
          {categories.length === 0 ? (
            <div className="sub">Nothing logged this month.</div>
          ) : (
            <ul className="category-totals">
              {categories.map(([category, amount]) => (
                <li key={category}>
                  <span>{EXPENSE_CATEGORY_LABELS[category]}</span>
                  <b>{formatPrice(amount)}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-body flush">
          {expenses.length === 0 ? (
            <div className="empty">
              <div className="big">No expenses this month</div>
              Log fuel and equipment from the dashboard, or add any expense here.
            </div>
          ) : (
            <table className="expense-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Vendor</th>
                  <th>Amount</th>
                  <th>Notes</th>
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} data-expense-id={e.id}>
                    <td className="nowrap">{formatShortDate(e.spent_on)}</td>
                    <td>
                      <Link className="row-link" href={`/expenses/${e.id}/edit`}>
                        <b>{EXPENSE_CATEGORY_LABELS[e.category]}</b>
                      </Link>
                    </td>
                    <td>{e.vendor || "—"}</td>
                    <td className="amount-cell">{formatPrice(e.amount)}</td>
                    <td className="notes-cell">{e.notes}</td>
                    <td className="actions-cell">
                      <Link className="btn secondary small" href={`/expenses/${e.id}/edit`}>
                        Edit
                      </Link>
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

// "Logged $62.40 for fuel (Speedway)." after a quick log.
async function LoggedNotice({ expenseId }: { expenseId?: string }) {
  if (!expenseId || !/^[0-9a-f-]{36}$/.test(expenseId)) return null;
  const supabase = await createClient();
  const { data: expense } = await supabase
    .from("expenses")
    .select("id, amount, category, vendor, spent_on")
    .eq("id", expenseId)
    .maybeSingle();
  if (!expense) return null;
  return (
    <Notice tone="success">
      Logged {formatPrice(expense.amount)} for {EXPENSE_CATEGORY_LABELS[expense.category].toLowerCase()}
      {expense.vendor && ` (${expense.vendor})`} on {formatShortDate(expense.spent_on)}.{" "}
      <Link href={`/expenses/${expense.id}/edit`}>Edit</Link>
    </Notice>
  );
}
