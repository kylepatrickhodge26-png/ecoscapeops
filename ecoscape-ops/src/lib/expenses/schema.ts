import { z } from "zod";

import { isISODate } from "@/lib/dates";
import type { Enums, Tables } from "@/lib/supabase/database.types";

export type Expense = Tables<"expenses">;
export type ExpenseCategory = Enums<"expense_category">;

// The prototype's expense categories, in its order.
export const EXPENSE_CATEGORIES = [
  "fuel",
  "equipment",
  "repairs",
  "materials",
  "fertilizer",
  "mulch",
  "payroll",
  "insurance",
  "advertising",
  "vehicle",
  "other",
] as const satisfies readonly ExpenseCategory[];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  fuel: "Fuel",
  equipment: "Equipment",
  repairs: "Repairs",
  materials: "Materials",
  fertilizer: "Fertilizer",
  mulch: "Mulch",
  payroll: "Payroll",
  insurance: "Insurance",
  advertising: "Advertising",
  vehicle: "Vehicle",
  other: "Other",
};

export const isExpenseCategory = (value: unknown): value is ExpenseCategory =>
  typeof value === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(value);

// Limits mirror the expenses table constraints.
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, "Enter an amount like 62.40")
  .transform(Number)
  .refine((n) => n > 0, "The amount must be more than $0");

const vendor = z.string().trim().max(120, "Vendor must be 120 characters or fewer");

export const EXPENSE_FIELDS = ["spent_on", "category", "amount", "vendor", "notes"] as const;
export type ExpenseField = (typeof EXPENSE_FIELDS)[number];
export type ExpenseFormValues = Record<ExpenseField, string>;

export const expenseSchema = z.object({
  spent_on: z.string().refine(isISODate, "Enter a valid date"),
  category: z.enum(EXPENSE_CATEGORIES, { error: "Choose a category" }),
  amount,
  vendor,
  notes: z.string().trim().max(1000, "Notes must be 1000 characters or fewer"),
});

// The dashboard's quick-log: just an amount and, optionally, where.
export const quickLogSchema = z.object({ amount, vendor });

function stringValues<K extends string>(formData: FormData, fields: readonly K[]): Record<K, string> {
  return Object.fromEntries(
    fields.map((field) => {
      const raw = formData.get(field);
      return [field, typeof raw === "string" ? raw : ""];
    }),
  ) as Record<K, string>;
}

export const expenseFormValuesFromFormData = (formData: FormData) => stringValues(formData, EXPENSE_FIELDS);

export function parseExpense(values: ExpenseFormValues) {
  const result = expenseSchema.safeParse(values);
  if (result.success) return { success: true, data: result.data } as const;
  const fieldErrors: Partial<Record<ExpenseField, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as ExpenseField | undefined;
    if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  return { success: false, fieldErrors } as const;
}
