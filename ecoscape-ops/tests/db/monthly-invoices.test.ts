// Monthly invoices: a customer billed once a month gets one draft invoice covering their
// completed visits. Checks that running it twice (or at the same moment) never bills a visit
// twice, that only completed, paid, uninvoiced visits of monthly customers are picked up,
// that sent invoices are left alone, and that nothing crosses businesses or reaches crew.
import { beforeAll, describe, expect, it } from "vitest";

import { addCustomer, addDays, anonClient, bookService, joinCrew, signUpOwner, todayIn, visitsFor, type TestCrew, type TestOwner } from "./helpers";

const DENIED = "42501";
const NOT_FOUND = "P0002";
const INVALID = "22023";
const today = todayIn("America/New_York");
const thisMonth = `${today.slice(0, 7)}-01`;
const lastMonth = (() => {
  const d = new Date(`${thisMonth}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
})();

async function completedVisit(owner: TestOwner, customerId: string, date: string, price = 50, status = "completed") {
  const plan = await bookService(owner, customerId, { frequency: "one_time", start_date: date, price });
  const visit = (await visitsFor(owner, plan.id))[0];
  if (status !== "scheduled") await owner.client.from("jobs").update({ status: status as never }).eq("id", visit.id);
  return visit.id;
}

describe("monthly invoices", () => {
  let alpha: TestOwner;
  let bravo: TestOwner;
  let crew: TestCrew;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    alpha = await signUpOwner("monthly-alpha", "Alpha Lawn");
    bravo = await signUpOwner("monthly-bravo", "Bravo Lawn");
    crew = await joinCrew(alpha, "Casey");
    alice = (await addCustomer(alpha, { first_name: "Alice", last_name: "Ames" })).id;
    bob = (await addCustomer(alpha, { first_name: "Bob", last_name: "Bell" })).id;
    await alpha.client.rpc("set_customer_bill_monthly", { customer_id: alice, enabled: true });
  });

  it("limits who can switch it on and run it", async () => {
    expect((await crew.client.rpc("set_customer_bill_monthly", { customer_id: bob, enabled: true })).error?.code).toBe(DENIED);
    expect((await bravo.client.rpc("set_customer_bill_monthly", { customer_id: alice, enabled: false })).error?.code).toBe(NOT_FOUND);
    expect((await crew.client.rpc("generate_monthly_invoices", { for_month: lastMonth })).error?.code).toBe(DENIED);
    expect((await anonClient().rpc("generate_monthly_invoices", { for_month: lastMonth })).error).not.toBeNull();
    expect((await alpha.client.rpc("generate_monthly_invoices", { for_month: addDays(thisMonth, 40) })).error?.code).toBe(INVALID);
    const { data } = await alpha.client.from("customers").select("bill_monthly").eq("id", alice);
    expect(data).toEqual([{ bill_monthly: true }]);
  });

  it("bills a monthly customer's completed visits once, however often it runs", async () => {
    const v1 = await completedVisit(alpha, alice, addDays(lastMonth, 2), 50);
    const v2 = await completedVisit(alpha, alice, addDays(lastMonth, 9), 50);
    await completedVisit(alpha, alice, addDays(lastMonth, 10), 0); // free
    await completedVisit(alpha, alice, addDays(lastMonth, 11), 50, "scheduled"); // not done
    await completedVisit(alpha, bob, addDays(lastMonth, 3), 40); // not monthly

    const first = await alpha.client.rpc("generate_monthly_invoices", { for_month: lastMonth });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject([{ customer_id: alice, added_to_existing: false, visits: 2, amount: 100 }]);

    const second = await alpha.client.rpc("generate_monthly_invoices", { for_month: lastMonth });
    expect(second.data).toEqual([]);

    const { data: lines } = await alpha.client.from("invoice_lines").select("job_id").in("job_id", [v1, v2]);
    expect(lines).toHaveLength(2);
    const { data: invoices } = await alpha.client.from("invoices").select("status, total, customer_id").eq("billing_month", lastMonth);
    expect(invoices).toEqual([{ status: "draft", total: 100, customer_id: alice }]);
  });

  it("adds late visits to the draft, never twice, even when run at the same moment", async () => {
    const late = await completedVisit(alpha, alice, addDays(lastMonth, 15), 30);
    const runs = await Promise.all([
      alpha.client.rpc("generate_monthly_invoices", { for_month: lastMonth }),
      alpha.client.rpc("generate_monthly_invoices", { for_month: lastMonth }),
    ]);
    for (const r of runs) expect(r.error).toBeNull();
    const { data: lines } = await alpha.client.from("invoice_lines").select("id").eq("job_id", late);
    expect(lines).toHaveLength(1);
    const { data: invoices } = await alpha.client.from("invoices").select("total").eq("billing_month", lastMonth);
    expect(invoices).toEqual([{ total: 130 }]);
  });

  it("leaves a sent invoice alone and starts a new one for later visits", async () => {
    const { data: draft } = await alpha.client.from("invoices").select("id").eq("billing_month", lastMonth).single();
    expect((await alpha.client.rpc("send_invoice", { invoice_id: draft!.id })).error).toBeNull();
    await completedVisit(alpha, alice, addDays(lastMonth, 20), 25);
    const run = await alpha.client.rpc("generate_monthly_invoices", { for_month: lastMonth });
    expect(run.data).toMatchObject([{ added_to_existing: false, visits: 1, amount: 25 }]);
    const { data: sent } = await alpha.client.from("invoices").select("total").eq("id", draft!.id);
    expect(sent).toEqual([{ total: 130 }]);
  });

  it("keeps each business's visits and invoices to itself", async () => {
    const zed = (await addCustomer(bravo, { first_name: "Zed" })).id;
    await bravo.client.rpc("set_customer_bill_monthly", { customer_id: zed, enabled: true });
    await completedVisit(bravo, zed, addDays(lastMonth, 3), 900);
    const run = await bravo.client.rpc("generate_monthly_invoices", { for_month: lastMonth });
    expect(run.data).toMatchObject([{ visits: 1, amount: 900 }]);
    const { data: theirs } = await bravo.client.from("invoices").select("customer_id");
    expect(theirs).toEqual([{ customer_id: zed }]);
  });

  it("leaves a monthly customer's visits out of auto-invoice", async () => {
    await alpha.client.rpc("set_auto_invoice", { enabled: true });
    const monthly = await completedVisit(alpha, alice, thisMonth, 61);
    const perVisit = await completedVisit(alpha, bob, thisMonth, 62);
    const { data } = await alpha.client.from("invoice_lines").select("job_id").in("job_id", [monthly, perVisit]);
    expect(data).toEqual([{ job_id: perVisit }]);
    const run = await alpha.client.rpc("generate_monthly_invoices", { for_month: thisMonth });
    expect(run.data).toMatchObject([{ customer_id: alice, visits: 1 }]);
  });
});
