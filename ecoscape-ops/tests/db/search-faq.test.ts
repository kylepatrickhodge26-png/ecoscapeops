// Search and the customer FAQ. Search finds the owner's own customers, visits, quotes,
// invoices and requests, matching what was typed as plain text; crew members, customers,
// other businesses and signed-out visitors can't search at all, or never see another
// business's records. The FAQ is the owner's to write; customers read only their own
// landscaper's questions, and the request form shows them only while its link is on.
import { beforeAll, describe, expect, it } from "vitest";

import { addCustomer, addDays, anonClient, bookService, joinCrew, signUp, signUpOwner, todayIn, type TestCrew, type TestOwner, type TestUser } from "./helpers";

const DENIED = "42501";
const NOT_FOUND = "P0002";
const INVALID = "22023";
const today = todayIn("America/New_York");

type Hit = { kind: string; id: string; title: string; detail: string | null; number: number | null };
const search = async (owner: TestUser, q: string) => {
  const { data, error } = await owner.client.rpc("search_everything", { q });
  expect(error).toBeNull();
  return data as Hit[];
};
const kinds = (hits: Hit[], kind: string) => hits.filter((h) => h.kind === kind);

describe("search", () => {
  let alpha: TestOwner;
  let bravo: TestOwner;
  let crew: TestCrew;
  const id: Record<string, string> = {};
  let invoiceNo: number;
  let quoteNo: number;

  beforeAll(async () => {
    alpha = await signUpOwner("search-alpha", "Alpha Lawn");
    bravo = await signUpOwner("search-bravo", "Bravo Lawn");
    crew = await joinCrew(alpha, "Casey");
    id.alice = (await addCustomer(alpha, { first_name: "Alice", last_name: "Ames", phone: "(631) 555-0100", property_address: "12 Oak St, Lake Grove NY", email: "alice@example.test" })).id;
    id.bob = (await addCustomer(alpha, { first_name: "Bob", last_name: "Burns_100%", phone: "631-555-0199", property_address: "40 Elm Ave" })).id;
    id.bravoAlice = (await addCustomer(bravo, { first_name: "Alice", last_name: "Zed", phone: "631-555-0100", property_address: "12 Oak St, Lake Grove NY" })).id;
    await bookService(alpha, id.alice, { frequency: "one_time", start_date: today, service_name: "Hedge trimming", price: 80 });
    await bookService(bravo, id.bravoAlice, { frequency: "one_time", start_date: today, service_name: "Hedge trimming", price: 90 });

    const invoice = await alpha.client.rpc("save_invoice", {
      invoice_id: null as never,
      customer_id: id.alice,
      due_date: addDays(today, 14),
      notes: "",
      lines: [{ description: "Fall cleanup", quantity: 1, unit_price: 200 }],
    });
    expect(invoice.error).toBeNull();
    invoiceNo = (await alpha.client.from("invoices").select("number").eq("id", invoice.data!).single()).data!.number;

    const quote = await alpha.client.rpc("save_quote", {
      quote_id: null as never,
      customer_id: null as never,
      prospect_name: "Priya Patel",
      prospect_phone: "516-555-0123",
      prospect_email: "",
      prospect_address: "9 Birch Ln",
      title: "Patio pavers",
      expires_on: addDays(today, 30),
      notes: "",
      lines: [{ description: "Pavers", quantity: 1, unit_price: 1500 }],
    });
    expect(quote.error).toBeNull();
    quoteNo = (await alpha.client.from("quotes").select("number").eq("id", quote.data!).single()).data!.number;

    const { data: link } = await alpha.client.rpc("request_link");
    expect((await alpha.client.rpc("set_request_link_enabled", { enabled: true })).error).toBeNull();
    const sent = await anonClient().rpc("submit_request", {
      token: link![0].token,
      name: "Rita Request",
      phone: "631-555-0777",
      email: "",
      address: "77 Pine Rd",
      details: "Leaf pickup please",
      ip_hash: `ip-${Math.random()}`,
    });
    expect(sent.error).toBeNull();
  });

  it("finds customers by name, phone, street and email", async () => {
    for (const q of ["alice", "Alice Ames", "ames", "555-0100", "6315550100", "(631) 555-0100", "oak st", "ALICE@EXAMPLE"]) {
      expect(kinds(await search(alpha, q), "customer").map((h) => h.id), q).toEqual([id.alice]);
    }
  });

  it("finds visits, quotes, invoices and requests", async () => {
    const hedge = kinds(await search(alpha, "hedge"), "visit");
    expect(hedge).toHaveLength(1);
    expect(hedge[0]).toMatchObject({ title: "Alice Ames", detail: "Hedge trimming" });

    expect(kinds(await search(alpha, "patio"), "quote")).toMatchObject([{ title: "Priya Patel", detail: "Patio pavers", number: quoteNo }]);
    expect(kinds(await search(alpha, "priya"), "quote")).toHaveLength(1);
    expect(kinds(await search(alpha, "516-555-0123"), "quote")).toHaveLength(1);
    expect(kinds(await search(alpha, `Q-${quoteNo}`), "quote")).toHaveLength(1);

    expect(kinds(await search(alpha, `#${invoiceNo}`), "invoice")).toMatchObject([{ title: "Alice Ames", number: invoiceNo }]);
    expect(kinds(await search(alpha, `invoice ${invoiceNo}`), "invoice")).toHaveLength(1);
    expect(kinds(await search(alpha, "alice"), "invoice")).toHaveLength(1);

    expect(kinds(await search(alpha, "rita"), "request")).toMatchObject([{ title: "Rita Request", detail: "77 Pine Rd" }]);
    expect(kinds(await search(alpha, "leaf pickup"), "request")).toHaveLength(1);
  });

  it("matches what was typed as plain text", async () => {
    expect(kinds(await search(alpha, "%"), "customer")).toEqual([]);
    expect(kinds(await search(alpha, "__"), "customer")).toEqual([]);
    expect(kinds(await search(alpha, "100%"), "customer").map((h) => h.id)).toEqual([id.bob]);
    expect(kinds(await search(alpha, "am_s"), "customer")).toEqual([]);
    // A street number doesn't match phone numbers that happen to contain it.
    expect(kinds(await search(alpha, "555 Main"), "customer")).toEqual([]);
    expect(await search(alpha, "a")).toEqual([]);
    expect(await search(alpha, "   ")).toEqual([]);
    expect(await search(alpha, "x".repeat(5000))).toEqual([]);
  });

  it("never shows another business's records", async () => {
    const mine = await search(alpha, "alice");
    const theirs = await search(bravo, "alice");
    expect(mine.map((h) => h.id)).not.toContain(id.bravoAlice);
    expect(kinds(theirs, "customer").map((h) => h.id)).toEqual([id.bravoAlice]);
    expect(kinds(theirs, "visit")).toHaveLength(1);
    expect(kinds(theirs, "invoice")).toEqual([]);
    const ids = new Set(mine.map((h) => h.id));
    for (const q of ["oak", "6315550100", "hedge", "patio", "priya", "rita", `#${invoiceNo}`, `Q-${quoteNo}`]) {
      for (const hit of await search(bravo, q)) expect(ids.has(hit.id), `${q} → ${hit.kind}`).toBe(false);
    }
  });

  it("is for the owner only: not crew, customers or signed-out visitors", async () => {
    expect((await crew.client.rpc("search_everything", { q: "alice" })).error?.code).toBe(DENIED);
    expect((await anonClient().rpc("search_everything", { q: "alice" })).error?.code).toBe(DENIED);
    const { data: token } = await alpha.client.rpc("invite_customer", { customer_id: id.bob });
    const customer = await signUp("search-customer", undefined, { customer_invite_token: token! });
    expect((await customer.client.rpc("search_everything", { q: "alice" })).error?.code).toBe(DENIED);
  });
});

describe("customer FAQ", () => {
  let alpha: TestOwner;
  let bravo: TestOwner;
  let crew: TestCrew;
  let customer: TestUser;
  let alphaToken: string;
  let bravoToken: string;
  const q: Record<string, string> = {};

  const add = async (owner: TestOwner, question: string, answer = "An answer") => {
    const { data, error } = await owner.client.from("faq_items").insert({ business_id: owner.businessId, question, answer, position: 999 }).select("id, position").single();
    expect(error).toBeNull();
    return data!;
  };
  const listed = async (owner: TestOwner) => (await owner.client.from("faq_items").select("question").order("position")).data!.map((r) => r.question);

  beforeAll(async () => {
    alpha = await signUpOwner("faq-alpha", "Alpha Lawn");
    bravo = await signUpOwner("faq-bravo", "Bravo Lawn");
    crew = await joinCrew(alpha, "Casey");
    const alice = (await addCustomer(alpha, { first_name: "Alice" })).id;
    const { data: invite } = await alpha.client.rpc("invite_customer", { customer_id: alice });
    customer = await signUp("faq-customer", undefined, { customer_invite_token: invite! });
    alphaToken = (await alpha.client.rpc("request_link")).data![0].token;
    bravoToken = (await bravo.client.rpc("request_link")).data![0].token;
    expect((await bravo.client.rpc("set_request_link_enabled", { enabled: true })).error).toBeNull();
  });

  it("lets the owner write, edit, reorder and remove questions", async () => {
    const rain = await add(alpha, "What if it rains?", "We move your visit to the next dry day.");
    const pay = await add(alpha, "How do I pay?", "Venmo or cash.");
    q.rain = rain.id;
    q.pay = pay.id;
    // New questions always go to the end, whatever position was sent.
    expect(rain.position).toBe(1);
    expect(pay.position).toBe(2);
    await add(bravo, "Bravo's own question");

    expect((await alpha.client.from("faq_items").update({ answer: "Venmo, Zelle or cash." }).eq("id", q.pay)).error).toBeNull();
    expect((await alpha.client.rpc("move_faq_item", { item_id: q.pay, up: true })).error).toBeNull();
    expect(await listed(alpha)).toEqual(["How do I pay?", "What if it rains?"]);
    // Moving past the end changes nothing.
    expect((await alpha.client.rpc("move_faq_item", { item_id: q.pay, up: true })).error).toBeNull();
    expect(await listed(alpha)).toEqual(["How do I pay?", "What if it rains?"]);
    // Position is set by the database only.
    expect((await alpha.client.from("faq_items").update({ position: 50 }).eq("id", q.rain)).error?.code).toBe(DENIED);

    const temp = await add(alpha, "Temporary?");
    expect((await alpha.client.from("faq_items").delete().eq("id", temp.id).select("id")).data).toHaveLength(1);
    expect(await listed(alpha)).toEqual(["How do I pay?", "What if it rains?"]);
  });

  it("refuses empty or overlong questions and more than 50", async () => {
    const bad = (question: string, answer: string) => alpha.client.from("faq_items").insert({ business_id: alpha.businessId, question, answer });
    expect((await bad("  ", "x")).error?.code).toBe("23514");
    expect((await bad("Why?", "  ")).error?.code).toBe("23514");
    expect((await bad("x".repeat(201), "x")).error?.code).toBe("23514");
    expect((await bad("Why?", "x".repeat(2001))).error?.code).toBe("23514");

    const many = await signUpOwner("faq-many", "Many Lawn");
    const rows = Array.from({ length: 50 }, (_, i) => ({ business_id: many.businessId, question: `Q${i}`, answer: "A" }));
    expect((await many.client.from("faq_items").insert(rows)).error).toBeNull();
    expect((await many.client.from("faq_items").insert({ business_id: many.businessId, question: "One more", answer: "A" })).error?.code).toBe(INVALID);
  });

  it("keeps each business's FAQ to itself", async () => {
    expect(await listed(bravo)).toEqual(["Bravo's own question"]);
    expect((await bravo.client.from("faq_items").update({ answer: "hacked" }).eq("id", q.rain).select("id")).data).toEqual([]);
    expect((await bravo.client.from("faq_items").delete().eq("id", q.rain).select("id")).data).toEqual([]);
    expect((await bravo.client.rpc("move_faq_item", { item_id: q.rain, up: true })).error?.code).toBe(NOT_FOUND);
    expect((await bravo.client.from("faq_items").insert({ business_id: alpha.businessId, question: "Planted?", answer: "x" })).error?.code).toBe(DENIED);
    const moved = await bravo.client.from("faq_items").update({ business_id: alpha.businessId } as never).eq("business_id", bravo.businessId);
    expect(moved.error).not.toBeNull();
    expect(await listed(alpha)).toEqual(["How do I pay?", "What if it rains?"]);
  });

  it("gives crew members and signed-out visitors no access to the table", async () => {
    expect((await crew.client.from("faq_items").select("*")).data).toEqual([]);
    expect((await crew.client.from("faq_items").insert({ business_id: alpha.businessId, question: "Crew?", answer: "x" })).error?.code).toBe(DENIED);
    expect((await crew.client.rpc("move_faq_item", { item_id: q.rain, up: false })).error?.code).toBe(DENIED);
    expect((await anonClient().from("faq_items").select("*")).error?.code).toBe(DENIED);
    expect((await anonClient().rpc("move_faq_item", { item_id: q.rain, up: false })).error?.code).toBe(DENIED);
    expect((await anonClient().rpc("portal_faq")).error?.code).toBe(DENIED);
  });

  it("shows a customer only their own landscaper's questions", async () => {
    expect((await customer.client.rpc("portal_faq")).data).toEqual([
      { question: "How do I pay?", answer: "Venmo, Zelle or cash." },
      { question: "What if it rains?", answer: "We move your visit to the next dry day." },
    ]);
    expect((await customer.client.from("faq_items").select("*")).data).toEqual([]);
    expect((await customer.client.from("faq_items").insert({ business_id: alpha.businessId, question: "Mine?", answer: "x" })).error?.code).toBe(DENIED);
    // Owners and crew aren't customers: the portal FAQ is empty for them.
    expect((await alpha.client.rpc("portal_faq")).data).toEqual([]);
    expect((await crew.client.rpc("portal_faq")).data).toEqual([]);
  });

  it("shows the request form's questions only while its link is on", async () => {
    const anon = anonClient();
    expect((await anon.rpc("public_request_faq", { token: alphaToken })).data).toEqual([]);
    expect((await alpha.client.rpc("set_request_link_enabled", { enabled: true })).error).toBeNull();
    expect((await anon.rpc("public_request_faq", { token: alphaToken })).data!.map((r) => r.question)).toEqual(["How do I pay?", "What if it rains?"]);
    expect((await anon.rpc("public_request_faq", { token: bravoToken })).data!.map((r) => r.question)).toEqual(["Bravo's own question"]);
    expect((await anon.rpc("public_request_faq", { token: "a".repeat(64) })).data).toEqual([]);
    expect((await alpha.client.rpc("regenerate_request_link")).error).toBeNull();
    expect((await anon.rpc("public_request_faq", { token: alphaToken })).data).toEqual([]);
  });
});
