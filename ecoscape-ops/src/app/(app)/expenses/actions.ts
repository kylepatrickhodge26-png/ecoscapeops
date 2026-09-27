"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { monthOf, todayInTimeZone } from "@/lib/dates";
import {
  expenseFormValuesFromFormData,
  isExpenseCategory,
  parseExpense,
  quickLogSchema,
  type ExpenseField,
  type ExpenseFormValues,
} from "@/lib/expenses/schema";
import { createClient } from "@/lib/supabase/server";

// Expenses are owner-only; RLS enforces it regardless of these checks.

const uuid = z.uuid();

export type ExpenseFormState = {
  values: ExpenseFormValues;
  error?: string;
  fieldErrors?: Partial<Record<ExpenseField, string>>;
};

export async function createExpense(_prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const { business } = await requireOwner();
  const values = expenseFormValuesFromFormData(formData);
  const parsed = parseExpense(values);
  if (!parsed.success) return { values, fieldErrors: parsed.fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.from("expenses").insert({ ...parsed.data, business_id: business.id });
  if (error) {
    console.error("Log expense failed", error);
    return { values, error: "We couldn't save this expense. Please try again." };
  }

  redirect(`/expenses?month=${monthOf(parsed.data.spent_on)}&notice=added`);
}

export async function updateExpense(id: string, _prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  await requireOwner();
  const values = expenseFormValuesFromFormData(formData);
  if (!uuid.safeParse(id).success) return { values, error: "This expense no longer exists." };
  const parsed = parseExpense(values);
  if (!parsed.success) return { values, fieldErrors: parsed.fieldErrors };

  const supabase = await createClient();
  const { data, error } = await supabase.from("expenses").update(parsed.data).eq("id", id).select("id");
  if (error) {
    console.error("Update expense failed", error);
    return { values, error: "We couldn't save your changes. Please try again." };
  }
  if (data.length === 0) return { values, error: "This expense no longer exists." };

  redirect(`/expenses?month=${monthOf(parsed.data.spent_on)}&notice=updated`);
}

export async function deleteExpense(id: string): Promise<{ error?: string }> {
  await requireOwner();
  if (!uuid.safeParse(id).success) return { error: "This expense no longer exists." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("expenses").delete().eq("id", id).select("spent_on");
  if (error) {
    console.error("Delete expense failed", error);
    return { error: "We couldn't delete this expense. Please try again." };
  }
  if (data.length === 0) return { error: "This expense no longer exists." };

  redirect(`/expenses?month=${monthOf(data[0].spent_on)}&notice=deleted`);
}

export type QuickLogState = { error?: string; amount?: string; vendor?: string };

// The dashboard's one-tap log for the most common categories: today's date, an amount,
// and optionally where.
export async function quickLogExpense(category: string, _prev: QuickLogState, formData: FormData): Promise<QuickLogState> {
  const { business } = await requireOwner();
  const amount = String(formData.get("amount") ?? "");
  const vendor = String(formData.get("vendor") ?? "");
  if (!isExpenseCategory(category)) return { error: "Unknown category.", amount, vendor };

  const parsed = quickLogSchema.safeParse({ amount, vendor });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, amount, vendor };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .insert({
      business_id: business.id,
      category,
      amount: parsed.data.amount,
      vendor: parsed.data.vendor,
      spent_on: todayInTimeZone(business.time_zone),
    })
    .select("id")
    .single();
  if (error) {
    console.error("Quick-log expense failed", error);
    return { error: "We couldn't log this. Please try again.", amount, vendor };
  }

  redirect(`/dashboard?logged=${data.id}`);
}
