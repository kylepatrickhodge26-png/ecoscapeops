// The expense log: owner-only, and never visible to crew members or anyone outside the
// business. This month's total feeds the dashboard's estimated profit.
import { beforeAll, describe, expect, it } from "vitest";

import type { TablesInsert } from "@/lib/supabase/database.types";

import {
  addCustomer,
  addDays,
  anonClient,
  bookService,
  joinCrew,
  signUpOwner,
  todayIn,
  type TestCrew,
  type TestOwner,
} from "./helpers";

const PERMISSION_DENIED = "42501";
const CHECK_VIOLATION = "23514";
const TZ = "America/New_York";

type NewExpense = Omit<TablesInsert<"expenses">, "business_id">;

async function logExpense(owner: TestOwner, expense: NewExpense) {
  const { data, error } = await owner.client
    .from("expenses")
    .insert({ business_id: owner.businessId, ...expense })
    .select()
    .single();
  expect(error).toBeNull();
  return data!;
}

const expensesOf = async (owner: TestOwner) =>
  (await owner.client.from("expenses").select("id, amount, category, vendor").order("created_at")).data!;

describe("expense log", () => {
  let owner: TestOwner;
  const today = todayIn(TZ);

  beforeAll(async () => {
    owner = await signUpOwner("exp-log", "Ledger Lawns", { time_zone: TZ });
  });

  it("the owner can log, edit, and delete expenses", async () => {
    const logged = await logExpense(owner, {
      spent_on: today,
      category: "fuel",
      amount: 62.4,
      vendor: "Speedway",
      notes: "Truck and mowers",
    });
    expect(logged).toMatchObject({
      business_id: owner.businessId,
      category: "fuel",
      amount: 62.4,
      vendor: "Speedway",
      created_by: owner.userId,
    });

    const { data: edited } = await owner.client
      .from("expenses")
      .update({ amount: 64.1, category: "vehicle" })
      .eq("id", logged.id)
      .select("amount, category")
      .single();
    expect(edited).toEqual({ amount: 64.1, category: "vehicle" });

    const { data: deleted } = await owner.client.from("expenses").delete().eq("id", logged.id).select("id");
    expect(deleted).toEqual([{ id: logged.id }]);
  });

  it("accepts every category from the prototype", async () => {
    const categories = [
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
    ] as const;
    for (const category of categories) await logExpense(owner, { spent_on: today, category, amount: 1 });
  });

  it.each([
    ["a zero amount", { amount: 0 }],
    ["a negative amount", { amount: -5 }],
    ["an enormous amount", { amount: 1_000_000 }],
    ["an over-long vendor", { vendor: "x".repeat(121) }],
    ["over-long notes", { notes: "x".repeat(1001) }],
  ])("rejects %s", async (_label, fields) => {
    const { error } = await owner.client
      .from("expenses")
      .insert({ business_id: owner.businessId, spent_on: today, category: "fuel", amount: 10, ...fields });
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("rejects an unknown category", async () => {
    const { error } = await owner.client
      .from("expenses")
      .insert({ business_id: owner.businessId, spent_on: today, category: "yacht" as never, amount: 10 });
    expect(error).not.toBeNull();
  });

  it("records who logged it, and that can't be faked or changed", async () => {
    const other = await signUpOwner("exp-other", "Other Lawns");
    const { error: fakeAuthor } = await owner.client.from("expenses").insert({
      business_id: owner.businessId,
      spent_on: today,
      category: "fuel",
      amount: 10,
      created_by: other.userId,
    });
    expect(fakeAuthor?.code).toBe(PERMISSION_DENIED);

    const logged = await logExpense(owner, { spent_on: today, category: "fuel", amount: 10 });
    const { error: rewrite } = await owner.client
      .from("expenses")
      .update({ created_by: other.userId })
      .eq("id", logged.id);
    expect(rewrite?.code).toBe(PERMISSION_DENIED);
  });
});

describe("expense isolation: break-in attempts", () => {
  let acme: TestOwner;
  let maria: TestCrew;
  let birch: TestOwner;
  let zoe: TestCrew;
  let acmeExpenseId: string;
  const today = todayIn(TZ);

  beforeAll(async () => {
    acme = await signUpOwner("exp-acme", "Acme Lawn Care", { time_zone: TZ });
    maria = await joinCrew(acme, "Maria");
    birch = await signUpOwner("exp-birch", "Birch Tree Services", { time_zone: TZ });
    zoe = await joinCrew(birch, "Zoe");
    acmeExpenseId = (await logExpense(acme, { spent_on: today, category: "payroll", amount: 1200, vendor: "Payroll Co" })).id;
    await logExpense(birch, { spent_on: today, category: "mulch", amount: 300 });
  });

  it("a crew member can't see, log, change, or delete their business's expenses", async () => {
    const { data: seen } = await maria.client.from("expenses").select("*");
    expect(seen).toEqual([]);
    const { data: byId } = await maria.client.from("expenses").select("amount").eq("id", acmeExpenseId);
    expect(byId).toEqual([]);

    const { error: logError } = await maria.client
      .from("expenses")
      .insert({ business_id: acme.businessId, spent_on: today, category: "fuel", amount: 50 });
    expect(logError?.code).toBe(PERMISSION_DENIED);

    const { data: updated } = await maria.client.from("expenses").update({ amount: 1 }).eq("id", acmeExpenseId).select();
    expect(updated).toEqual([]);
    const { data: deleted } = await maria.client.from("expenses").delete().eq("id", acmeExpenseId).select();
    expect(deleted).toEqual([]);
  });

  it("another business can't see, change, delete, or add to this business's expenses", async () => {
    const { data: seen } = await birch.client.from("expenses").select("business_id, category");
    expect(seen).toEqual([{ business_id: birch.businessId, category: "mulch" }]);

    const { data: updated } = await birch.client.from("expenses").update({ amount: 1 }).eq("id", acmeExpenseId).select();
    expect(updated).toEqual([]);
    const { data: deleted } = await birch.client.from("expenses").delete().eq("id", acmeExpenseId).select();
    expect(deleted).toEqual([]);

    const { error: planted } = await birch.client
      .from("expenses")
      .insert({ business_id: acme.businessId, spent_on: today, category: "other", amount: 5 });
    expect(planted?.code).toBe(PERMISSION_DENIED);

    // Another business's crew member sees nothing either.
    expect((await zoe.client.from("expenses").select("*")).data).toEqual([]);
  });

  it("signed-out visitors get nothing", async () => {
    const { data, error } = await anonClient().from("expenses").select("*");
    expect(error?.code).toBe(PERMISSION_DENIED);
    expect(data).toBeNull();
  });

  it("an expense can't be moved to another business", async () => {
    const { error } = await acme.client
      .from("expenses")
      .update({ business_id: birch.businessId } as never)
      .eq("id", acmeExpenseId);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("after every attempt, the owner's expenses are exactly as logged", async () => {
    expect(await expensesOf(acme)).toEqual([
      { id: acmeExpenseId, amount: 1200, category: "payroll", vendor: "Payroll Co" },
    ]);
  });
});

describe("expenses on the dashboard", () => {
  let acme: TestOwner;
  let maria: TestCrew;
  let birch: TestOwner;
  const today = todayIn(TZ);
  const monthStart = `${today.slice(0, 7)}-01`;

  beforeAll(async () => {
    acme = await signUpOwner("exp-dash", "Profit Lawns", { time_zone: TZ });
    maria = await joinCrew(acme, "Maria");
    birch = await signUpOwner("exp-dash-b", "Other Profit Lawns", { time_zone: TZ });

    const customer = await addCustomer(acme);
    await bookService(acme, customer.id, { frequency: "one_time", start_date: monthStart, price: 500 });

    await logExpense(acme, { spent_on: today, category: "fuel", amount: 62.4 });
    await logExpense(acme, { spent_on: monthStart, category: "equipment", amount: 410 });
    await logExpense(acme, { spent_on: addDays(monthStart, -1), category: "insurance", amount: 900 }); // last month
    await logExpense(acme, { spent_on: addDays(monthStart, 40), category: "advertising", amount: 75 }); // next month
    await logExpense(birch, { spent_on: today, category: "payroll", amount: 5000 });
  });

  it("counts only this month's expenses of the owner's own business", async () => {
    const { data } = await acme.client.rpc("dashboard_summary");
    expect(data![0].month_expenses).toBeCloseTo(472.4, 2);
    expect(data![0].month_booked).toBe(500);
  });

  it("never gives a crew member expense totals", async () => {
    const { data } = await maria.client.rpc("dashboard_summary");
    expect(data![0].month_expenses).toBeNull();
    expect(data![0].month_booked).toBeNull();
  });

  it("another business's expenses stay out of it, and vice versa", async () => {
    const { data } = await birch.client.rpc("dashboard_summary");
    expect(data![0].month_expenses).toBe(5000);
  });
});
