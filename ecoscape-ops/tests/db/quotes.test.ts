// Quotes: owner-only quotes for customers or prospects, sent and then accepted into a booked
// service. Checks that crew members, other businesses and signed-out visitors can never see
// or act on a business's quotes, that accepting books exactly once, and the numbering and
// status rules.
import { beforeAll, describe, expect, it } from "vitest";

import { addCustomer, addDays, anonClient, joinCrew, signUpOwner, todayIn, visitsFor, type TestCrew, type TestOwner } from "./helpers";

const PERMISSION_DENIED = "42501";
const INVALID = "22023";
const NOT_FOUND = "P0002";
const TZ = "America/New_York";
const today = todayIn(TZ);

type Line = { description: string; quantity?: number; unit_price: number };
const LINES: Line[] = [
  { description: "Spring cleanup", quantity: 1, unit_price: 250 },
  { description: "Mulch", quantity: 3, unit_price: 40.5 },
];

function save(owner: TestOwner, fields: { quoteId?: string; customerId?: string; name?: string; email?: string; expires?: string; lines?: Line[]; title?: string } = {}) {
  return owner.client.rpc("save_quote", {
    quote_id: (fields.quoteId ?? null) as never,
    customer_id: (fields.customerId ?? null) as never,
    prospect_name: fields.customerId ? "" : (fields.name ?? "Jane Doe"),
    prospect_phone: fields.customerId ? "" : "631-555-0100",
    prospect_email: fields.email ?? "",
    prospect_address: fields.customerId ? "" : "12 Oak St, Lake Grove NY",
    title: fields.title ?? "Spring cleanup",
    expires_on: fields.expires ?? addDays(today, 30),
    notes: "Thanks!",
    lines: fields.lines ?? LINES,
  });
}

async function newQuote(owner: TestOwner, fields: Parameters<typeof save>[1] = {}) {
  const { data, error } = await save(owner, fields);
  expect(error).toBeNull();
  return data!;
}

async function quoteOf(owner: TestOwner, id: string) {
  const { data, error } = await owner.client
    .from("quotes")
    .select("id, number, status, total, customer_id, prospect_name, accepted_service_plan_id, quote_status_shown")
    .eq("id", id)
    .single();
  expect(error).toBeNull();
  return data!;
}

describe("quotes", () => {
  let alpha: TestOwner;
  let bravo: TestOwner;
  let crew: TestCrew;

  beforeAll(async () => {
    alpha = await signUpOwner("quotes-alpha", "Alpha Lawn");
    bravo = await signUpOwner("quotes-bravo", "Bravo Lawn");
    crew = await joinCrew(alpha, "Crewa");
  });

  it("numbers quotes per business and totals the lines", async () => {
    const first = await newQuote(alpha);
    const second = await newQuote(alpha, { name: "Bob", lines: [{ description: "Mow", unit_price: 40 }] });
    const other = await newQuote(bravo, { name: "Zed" });
    const a = await quoteOf(alpha, first);
    const b = await quoteOf(alpha, second);
    expect(a).toMatchObject({ status: "draft", total: 371.5, prospect_name: "Jane Doe" });
    expect(b.number).toBe(a.number + 1);
    expect((await quoteOf(bravo, other)).number).toBe(a.number);
  });

  it("checks what's entered", async () => {
    expect((await save(alpha, { name: " " })).error?.code).toBe(INVALID);
    expect((await save(alpha, { lines: [] })).error?.code).toBe(INVALID);
    expect((await save(alpha, { lines: [{ description: "Free", unit_price: 0 }] })).error?.code).toBe(INVALID);
    expect((await save(alpha, { lines: [{ description: "Big", quantity: 9999, unit_price: 99999 }] })).error?.code).toBe(INVALID);
    expect((await save(alpha, { email: "nope" })).error?.code).toBe(INVALID);
    expect((await save(alpha, { expires: "2020-01-01" })).error?.code).toBe(INVALID);
  });

  it("keeps other businesses out", async () => {
    const id = await newQuote(alpha);
    const customer = await addCustomer(alpha);

    const { data: seen } = await bravo.client.from("quotes").select("id").eq("id", id);
    expect(seen).toEqual([]);
    const { data: lines } = await bravo.client.from("quote_lines").select("id").eq("quote_id", id);
    expect(lines).toEqual([]);

    for (const call of [
      bravo.client.rpc("send_quote", { quote_id: id }),
      bravo.client.rpc("decline_quote", { quote_id: id }),
      bravo.client.rpc("duplicate_quote", { quote_id: id }),
      bravo.client.rpc("delete_draft_quote", { quote_id: id }),
      bravo.client.rpc("accept_quote", { quote_id: id, service_name: "X", frequency: "one_time", first_visit: today }),
      save(bravo, { quoteId: id }),
    ]) {
      expect((await call).error?.code).toBe(NOT_FOUND);
    }
    expect((await save(bravo, { customerId: customer.id })).error?.code).toBe(NOT_FOUND);
    expect((await quoteOf(alpha, id)).status).toBe("draft");
  });

  it("keeps crew members and signed-out visitors out", async () => {
    const id = await newQuote(alpha);
    const { data: seen } = await crew.client.from("quotes").select("id");
    expect(seen).toEqual([]);
    const { data: lines } = await crew.client.from("quote_lines").select("id");
    expect(lines).toEqual([]);
    expect((await crew.client.rpc("send_quote", { quote_id: id })).error?.code).toBe(PERMISSION_DENIED);
    expect((await crew.client.rpc("accept_quote", { quote_id: id, service_name: "X", frequency: "one_time", first_visit: today })).error?.code).toBe(PERMISSION_DENIED);
    expect((await save({ ...alpha, client: crew.client } as TestOwner)).error?.code).toBe(PERMISSION_DENIED);

    const anon = anonClient();
    expect((await anon.from("quotes").select("id")).error?.code).toBe(PERMISSION_DENIED);
    expect((await anon.rpc("save_quote", { quote_id: null as never, customer_id: null as never, prospect_name: "x", prospect_phone: "", prospect_email: "", prospect_address: "", title: "", expires_on: addDays(today, 5), notes: "", lines: LINES })).error?.code).toBe(PERMISSION_DENIED);
  });

  it("can't be written to directly, even by the owner", async () => {
    const id = await newQuote(alpha);
    const insert = await alpha.client.from("quotes").insert({ business_id: alpha.businessId, number: 99, prospect_name: "x", issue_date: today, expires_on: today });
    expect(insert.error?.code).toBe(PERMISSION_DENIED);
    const update = await alpha.client.from("quotes").update({ total: 1 }).eq("id", id);
    expect(update.error?.code).toBe(PERMISSION_DENIED);
    expect((await alpha.client.from("quote_counters").select("*")).error?.code).toBe(PERMISSION_DENIED);
  });

  it("goes draft, sent, expired, and only drafts can change", async () => {
    const id = await newQuote(alpha);
    expect((await alpha.client.rpc("send_quote", { quote_id: id })).error).toBeNull();
    expect((await quoteOf(alpha, id)).status).toBe("sent");
    expect((await save(alpha, { quoteId: id })).error?.code).toBe(INVALID);
    expect((await alpha.client.rpc("delete_draft_quote", { quote_id: id })).error?.code).toBe(INVALID);
    expect((await quoteOf(alpha, id)).quote_status_shown).toBe("sent");

    // A draft never shows as expired, even past its date.
    const draft = await newQuote(alpha, { expires: today });
    expect((await quoteOf(alpha, draft)).quote_status_shown).toBe("draft");
  });

  it("accepting a prospect's quote makes the customer and books the work once", async () => {
    const id = await newQuote(alpha);
    await alpha.client.rpc("send_quote", { quote_id: id });
    const first = addDays(today, 2);
    expect((await alpha.client.rpc("accept_quote", { quote_id: id, service_name: "", frequency: "weekly", first_visit: first })).error?.code).toBe(INVALID);
    expect((await alpha.client.rpc("accept_quote", { quote_id: id, service_name: "Cleanup", frequency: "weekly", first_visit: "2020-01-01" })).error?.code).toBe(INVALID);

    const { data: planId, error } = await alpha.client.rpc("accept_quote", { quote_id: id, service_name: "Spring cleanup", frequency: "weekly", first_visit: first });
    expect(error).toBeNull();
    const accepted = await quoteOf(alpha, id);
    expect(accepted).toMatchObject({ status: "accepted", accepted_service_plan_id: planId });

    const { data: customer } = await alpha.client.from("customers").select("first_name, last_name, phone, property_address").eq("id", accepted.customer_id!).single();
    expect(customer).toMatchObject({ first_name: "Jane", last_name: "Doe", phone: "631-555-0100", property_address: "12 Oak St, Lake Grove NY" });
    const visits = await visitsFor(alpha, planId!);
    expect(visits).toHaveLength(6);
    expect(visits.every((v) => v.price === 371.5)).toBe(true);

    // A second tap books nothing more.
    const again = await alpha.client.rpc("accept_quote", { quote_id: id, service_name: "Spring cleanup", frequency: "weekly", first_visit: first });
    expect(again.error?.code).toBe(INVALID);
    const { count } = await alpha.client.from("customers").select("id", { count: "exact", head: true }).eq("first_name", "Jane").eq("last_name", "Doe");
    expect(count).toBe(1);
    expect((await alpha.client.rpc("decline_quote", { quote_id: id })).error?.code).toBe(INVALID);
  });

  it("books a one-time visit for an existing customer, assigned to crew", async () => {
    const customer = await addCustomer(alpha);
    const id = await newQuote(alpha, { customerId: customer.id, title: "Hedge trim", lines: [{ description: "Hedges", quantity: 2, unit_price: 75 }] });
    const stranger = await bravo.client.rpc("accept_quote", { quote_id: id, service_name: "X", frequency: "one_time", first_visit: today });
    expect(stranger.error?.code).toBe(NOT_FOUND);
    const { data: planId, error } = await alpha.client.rpc("accept_quote", {
      quote_id: id,
      service_name: "Hedge trim",
      frequency: "one_time",
      first_visit: addDays(today, 1),
      assigned_crew_member_id: crew.crewMemberId,
    });
    expect(error).toBeNull();
    const visits = await visitsFor(alpha, planId!);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ price: 150, assigned_crew_member_id: crew.crewMemberId, customer_id: customer.id });
    expect((await quoteOf(alpha, id)).customer_id).toBe(customer.id);

    // Another business's crew member can't be assigned.
    const bravoCrew = await joinCrew(bravo, "Crewb");
    const other = await newQuote(alpha, { customerId: customer.id });
    const bad = await alpha.client.rpc("accept_quote", { quote_id: other, service_name: "X", frequency: "one_time", first_visit: today, assigned_crew_member_id: bravoCrew.crewMemberId });
    expect(bad.error?.code).toBe(INVALID);
  });

  it("can be declined, copied and deleted", async () => {
    const id = await newQuote(alpha);
    expect((await alpha.client.rpc("decline_quote", { quote_id: id })).error).toBeNull();
    expect((await quoteOf(alpha, id)).status).toBe("declined");

    const { data: copy, error } = await alpha.client.rpc("duplicate_quote", { quote_id: id });
    expect(error).toBeNull();
    const copied = await quoteOf(alpha, copy!);
    expect(copied).toMatchObject({ status: "draft", total: 371.5 });
    expect((await alpha.client.rpc("delete_draft_quote", { quote_id: copy! })).error).toBeNull();
    const { data: gone } = await alpha.client.from("quotes").select("id").eq("id", copy!);
    expect(gone).toEqual([]);
  });

  it("goes away with its customer", async () => {
    const customer = await addCustomer(alpha);
    const id = await newQuote(alpha, { customerId: customer.id });
    expect((await alpha.client.from("customers").delete().eq("id", customer.id)).error).toBeNull();
    const { data } = await alpha.client.from("quotes").select("id").eq("id", id);
    expect(data).toEqual([]);
  });
});
