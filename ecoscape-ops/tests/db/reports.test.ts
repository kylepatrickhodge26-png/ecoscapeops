// Reports: owner-only figures worked out from the business's own rows. Checks the numbers
// (including that an invoiced visit is counted once), that crew, other businesses and
// signed-out visitors can't run them, and that bad date ranges are refused.
import { beforeAll, describe, expect, it } from "vitest";

import { addCustomer, adminClient, anonClient, bookService, joinCrew, signUpOwner, visitsFor, type TestCrew, type TestOwner } from "./helpers";

const DENIED = "42501";
const INVALID = "22023";
const RANGE = { from_date: "2031-03-01", to_date: "2031-04-30" };

const REPORTS = [
  "report_summary",
  "report_revenue_by_month",
  "report_revenue_by_customer",
  "report_revenue_by_service",
  "report_expenses_by_category",
  "report_jobs_by_crew",
] as const;

describe("reports", () => {
  let alpha: TestOwner;
  let bravo: TestOwner;
  let crew: TestCrew;
  let visit: string;
  let customerId: string;

  beforeAll(async () => {
    alpha = await signUpOwner("reports-alpha", "Alpha Lawn");
    bravo = await signUpOwner("reports-bravo", "Bravo Lawn");
    crew = await joinCrew(alpha, "Casey");
    customerId = (await addCustomer(alpha, { first_name: "Alice", last_name: "Ames" })).id;
    const mow = await bookService(alpha, customerId, { frequency: "one_time", start_date: "2031-03-05", price: 100, assigned_crew_member_id: crew.crewMemberId });
    const mulch = await bookService(alpha, customerId, { frequency: "one_time", start_date: "2031-03-20", service_name: "Mulch", price: 200 });
    visit = (await visitsFor(alpha, mow.id))[0].id;
    expect(mulch.id).toBeTruthy();
    await alpha.client.from("jobs").update({ status: "completed" }).eq("id", visit);
    await alpha.client.from("expenses").insert([
      { business_id: alpha.businessId, spent_on: "2031-03-10", category: "fuel", amount: 30 },
      { business_id: alpha.businessId, spent_on: "2031-04-10", category: "fuel", amount: 20 },
    ]);
    const theirCustomer = await addCustomer(bravo, { first_name: "Zed" });
    await bookService(bravo, theirCustomer.id, { frequency: "one_time", start_date: "2031-03-06", price: 7000 });
  });

  it("works out the numbers", async () => {
    const { data } = await alpha.client.rpc("report_summary", RANGE);
    expect(data![0]).toMatchObject({ booked: 300, completed: 100, collected: 0, expenses: 50 });
    const { data: months } = await alpha.client.rpc("report_revenue_by_month", RANGE);
    expect(months).toEqual([{ month: "2031-03-01", booked: 300, completed: 100 }]);
    const { data: customers } = await alpha.client.rpc("report_revenue_by_customer", RANGE);
    expect(customers).toMatchObject([{ customer_name: "Alice Ames", booked: 300, completed: 100 }]);
    const { data: categories } = await alpha.client.rpc("report_expenses_by_category", RANGE);
    expect(categories).toEqual([{ category: "fuel", total: 50 }]);
    const { data: crewRows } = await alpha.client.rpc("report_jobs_by_crew", RANGE);
    expect(crewRows).toMatchObject([{ crew_name: "Casey", completed: 1, scheduled: 1 }, { crew_name: "Unassigned", completed: 0, scheduled: 1 }]);
  });

  it("counts an invoiced visit once", async () => {
    const admin = adminClient();
    const { data: invoice } = await admin
      .from("invoices")
      .insert({ business_id: alpha.businessId, customer_id: customerId, number: 1, issue_date: "2031-04-05", due_date: "2031-04-20" })
      .select("id")
      .single();
    await admin.from("invoice_lines").insert([
      { business_id: alpha.businessId, invoice_id: invoice!.id, job_id: visit, position: 0, description: "Mowing", quantity: 1, unit_price: 120 },
      { business_id: alpha.businessId, invoice_id: invoice!.id, position: 1, description: "Delivery", quantity: 1, unit_price: 25 },
    ]);
    const draft = await alpha.client.rpc("report_summary", RANGE);
    expect(draft.data![0]).toMatchObject({ booked: 300, completed: 100 });
    await admin.from("invoices").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", invoice!.id);
    const sent = await alpha.client.rpc("report_summary", RANGE);
    // Visit at its invoiced 120 (not 100 + 120), the mulch 200, and the 25 extra.
    expect(sent.data![0]).toMatchObject({ booked: 345, completed: 145, outstanding: 145 });
    const { data: byCustomer } = await alpha.client.rpc("report_revenue_by_customer", RANGE);
    expect(byCustomer![0].booked).toBe(345);
    await admin.from("invoices").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", invoice!.id);
    const back = await alpha.client.rpc("report_summary", RANGE);
    expect(back.data![0]).toMatchObject({ booked: 300, completed: 100 });
  });

  it("shows each business only its own numbers", async () => {
    const { data } = await bravo.client.rpc("report_summary", RANGE);
    expect(data![0]).toMatchObject({ booked: 7000, expenses: 0 });
    const { data: customers } = await bravo.client.rpc("report_revenue_by_customer", RANGE);
    expect(customers!.map((c) => c.customer_name)).toEqual(["Zed"]);
  });

  it("keeps crew members and signed-out visitors out", async () => {
    for (const name of REPORTS) {
      expect((await crew.client.rpc(name, RANGE)).error?.code).toBe(DENIED);
      expect((await anonClient().rpc(name, RANGE)).error).not.toBeNull();
    }
  });

  it("refuses bad ranges", async () => {
    expect((await alpha.client.rpc("report_summary", { from_date: "2031-04-30", to_date: "2031-03-01" })).error?.code).toBe(INVALID);
    expect((await alpha.client.rpc("report_summary", { from_date: "2020-01-01", to_date: "2031-01-01" })).error?.code).toBe(INVALID);
  });
});
