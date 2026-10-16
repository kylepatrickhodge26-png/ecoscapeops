// Customer accounts: a customer joins only through the owner's invite link and then sees
// only their own visits, sent quotes and sent invoices. Checks that nothing internal (notes,
// crew, other customers, other businesses) ever reaches them, that the invite works once,
// and that a login is never both a customer and a business member.
import { beforeAll, describe, expect, it } from "vitest";

import { addCustomer, anonClient, bookService, joinCrew, signUp, signUpOwner, todayIn, visitsFor, type TestCrew, type TestOwner, type TestUser } from "./helpers";

const DENIED = "42501";
const NOT_FOUND = "P0002";
const INVALID = "22023";
const today = todayIn("America/New_York");

describe("customer accounts", () => {
  let alpha: TestOwner;
  let bravo: TestOwner;
  let crew: TestCrew;
  let alice: string;
  let bob: string;
  let customer: TestUser;
  let token: string;

  beforeAll(async () => {
    alpha = await signUpOwner("portal-alpha", "Alpha Lawn");
    bravo = await signUpOwner("portal-bravo", "Bravo Lawn");
    crew = await joinCrew(alpha, "Casey");
    alice = (await addCustomer(alpha, { first_name: "Alice", last_name: "Ames", phone: "631-555-0100" })).id;
    bob = (await addCustomer(alpha, { first_name: "Bob", phone: "631-555-0101" })).id;
    const mine = await bookService(alpha, alice, { frequency: "one_time", start_date: today, price: 65 });
    await alpha.client.from("jobs").update({ notes: "Gate code 1234" }).eq("id", (await visitsFor(alpha, mine.id))[0].id);
    await bookService(alpha, bob, { frequency: "one_time", start_date: today, price: 50 });
  });

  it("lets only the owner invite, and only their own customers", async () => {
    expect((await crew.client.rpc("invite_customer", { customer_id: alice })).error?.code).toBe(DENIED);
    expect((await bravo.client.rpc("invite_customer", { customer_id: alice })).error?.code).toBe(NOT_FOUND);
    expect((await anonClient().rpc("invite_customer", { customer_id: alice })).error).not.toBeNull();
    const { data, error } = await alpha.client.rpc("invite_customer", { customer_id: alice });
    expect(error).toBeNull();
    token = data!;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const details = await anonClient().rpc("customer_invite_details", { token });
    expect(details.data).toEqual([{ business_name: "Alpha Lawn", customer_name: "Alice" }]);
    expect((await alpha.client.from("customer_accounts").select("invite_token_hash")).error).not.toBeNull();
  });

  it("joins through the link once", async () => {
    customer = await signUp("portal-alice", undefined, { customer_invite_token: token });
    const again = await anonClient().auth.signUp({
      email: `again-${Date.now()}@example.test`,
      password: "correct-horse-battery",
      options: { data: { customer_invite_token: token } },
    });
    expect(again.error).not.toBeNull();
    const { data } = await alpha.client.from("customer_accounts").select("customer_id, user_id").eq("customer_id", alice);
    expect(data).toEqual([{ customer_id: alice, user_id: customer.userId }]);
  });

  it("keeps a login to one kind", async () => {
    expect((await customer.client.rpc("create_business", { business_name: "Alice Co" })).error).not.toBeNull();
    const t = (await alpha.client.rpc("invite_customer", { customer_id: bob })).data!;
    expect((await bravo.client.rpc("accept_customer_invite", { token: t })).error?.code).toBe("23505");
  });

  it("shows the customer only their own things, without internal notes", async () => {
    const summary = await customer.client.rpc("portal_summary");
    expect(summary.data).toMatchObject([{ business_name: "Alpha Lawn", first_name: "Alice" }]);
    const visits = await customer.client.rpc("portal_visits");
    expect(visits.data).toHaveLength(1);
    expect(visits.data![0]).not.toHaveProperty("notes");
    expect(JSON.stringify(visits.data)).not.toContain("Gate code");
    for (const table of ["customers", "jobs", "invoices", "quotes", "requests", "crew_members", "expenses", "business_members"] as const) {
      expect((await customer.client.from(table).select("*")).data ?? []).toEqual([]);
    }
    expect((await customer.client.rpc("report_summary", { from_date: today, to_date: today })).error?.code).toBe(DENIED);
    expect((await alpha.client.rpc("portal_summary")).data).toEqual([]);
    expect((await crew.client.rpc("portal_visits")).data).toEqual([]);
  });

  it("shows sent quotes only and records the customer's answer", async () => {
    const save = (title: string, who: string) =>
      alpha.client.rpc("save_quote", {
        quote_id: null as never,
        customer_id: who,
        prospect_name: "",
        prospect_phone: "",
        prospect_email: "",
        prospect_address: "",
        title,
        expires_on: today,
        notes: "",
        lines: [{ description: "Work", unit_price: 100 }],
      });
    const draft = (await save("Draft", alice)).data!;
    const sent = (await save("Spring", alice)).data!;
    const bobs = (await save("Bobs", bob)).data!;
    await alpha.client.rpc("send_quote", { quote_id: sent });
    await alpha.client.rpc("send_quote", { quote_id: bobs });
    const seen = await customer.client.rpc("portal_quotes");
    expect(seen.data!.map((q) => q.title)).toEqual(["Spring"]);
    expect((await customer.client.rpc("portal_respond_to_quote", { quote_id: draft, accept: true })).error?.code).toBe(NOT_FOUND);
    expect((await customer.client.rpc("portal_respond_to_quote", { quote_id: bobs, accept: true })).error?.code).toBe(NOT_FOUND);
    expect((await customer.client.rpc("portal_respond_to_quote", { quote_id: sent, accept: true })).error).toBeNull();
    expect((await customer.client.rpc("portal_respond_to_quote", { quote_id: sent, accept: false })).error?.code).toBe(INVALID);
    const { data } = await alpha.client.from("quotes").select("status, customer_response").eq("id", sent).single();
    expect(data).toEqual({ status: "sent", customer_response: "accepted" });
  });

  it("sends a request to the owner's inbox only", async () => {
    expect((await customer.client.rpc("portal_request_service", { details: "Leaf cleanup" })).error).toBeNull();
    const { data } = await alpha.client.from("requests").select("details, customer_id").eq("customer_id", alice);
    expect(data).toEqual([{ details: "Leaf cleanup", customer_id: alice }]);
    expect((await bravo.client.from("requests").select("id")).data).toEqual([]);
  });

  it("stops showing anything once access is removed", async () => {
    expect((await crew.client.rpc("remove_customer_access", { customer_id: alice })).error?.code).toBe(DENIED);
    expect((await alpha.client.rpc("remove_customer_access", { customer_id: alice })).error).toBeNull();
    expect((await customer.client.rpc("portal_summary")).data).toEqual([]);
    expect((await customer.client.rpc("portal_visits")).data).toEqual([]);
  });
});
