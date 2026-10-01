// Invoicing: invoices, live statuses, payments (recorded by hand or through Stripe), and
// the dashboard's money. Checks that crew members and other businesses can never see or
// act on a business's invoices, that a payment is never recorded twice, and that the
// dashboard counts a visit once even when it's also invoiced.
import { randomBytes, randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
  addCustomer,
  addDays,
  adminClient,
  anonClient,
  bookService,
  joinCrew,
  signUpOwner,
  todayIn,
  visitsFor,
  type Client,
  type TestCrew,
  type TestOwner,
} from "./helpers";

const PERMISSION_DENIED = "42501";
const INVALID = "22023";
const NOT_FOUND = "P0002";
const DUPLICATE = "23505";
const NOT_READY = "55000";
const TZ = "America/New_York";
const today = todayIn(TZ);

type Line = { job_id?: string | null; description: string; quantity?: number; unit_price: number };

// A one-time visit on a date, optionally completed.
async function visit(owner: TestOwner, customerId: string, opts: { date?: string; price?: number; completed?: boolean; crew?: string } = {}) {
  const plan = await bookService(owner, customerId, {
    frequency: "one_time",
    start_date: opts.date ?? today,
    price: opts.price ?? 65,
    assigned_crew_member_id: opts.crew ?? null,
  });
  const [job] = await visitsFor(owner, plan.id);
  if (opts.completed) {
    const { error } = await owner.client.from("jobs").update({ status: "completed" }).eq("id", job.id);
    expect(error).toBeNull();
  }
  return job;
}

function save(client: Client, fields: { customerId: string; lines: Line[]; dueDate?: string; notes?: string; invoiceId?: string }) {
  return client.rpc("save_invoice", {
    invoice_id: (fields.invoiceId ?? null) as never,
    customer_id: fields.customerId,
    due_date: fields.dueDate ?? addDays(today, 14),
    notes: fields.notes ?? "",
    lines: fields.lines,
  });
}

async function newInvoice(owner: TestOwner, customerId: string, lines: Line[], opts: { send?: boolean } = {}) {
  const { data, error } = await save(owner.client, { customerId, lines });
  expect(error).toBeNull();
  if (opts.send) expect((await owner.client.rpc("send_invoice", { invoice_id: data! })).error).toBeNull();
  return data!;
}

async function invoiceOf(owner: TestOwner, id: string) {
  const { data, error } = await owner.client
    .from("invoices")
    .select("id, number, status, total, amount_paid, due_date, issue_date, pay_token, display_status, balance")
    .eq("id", id)
    .single();
  expect(error).toBeNull();
  return data!;
}

function pay(client: Client, invoiceId: string, amount: number, opts: { requestId?: string; method?: string; receivedOn?: string } = {}) {
  return client.rpc("record_manual_payment", {
    invoice_id: invoiceId,
    amount,
    method: (opts.method ?? "cash") as never,
    received_on: opts.receivedOn ?? today,
    note: "",
    request_id: opts.requestId ?? randomUUID(),
  });
}

const paymentsOf = async (owner: TestOwner, invoiceId: string) =>
  (await owner.client.from("payments").select("id, amount, method, checkout_session_id").eq("invoice_id", invoiceId)).data!;

// Stripe bookkeeping is done by the app's server with the service role.
const accountId = () => `acct_${randomBytes(8).toString("hex")}`;
const sessionId = () => `cs_test_${randomBytes(12).toString("hex")}`;

async function connectStripe(owner: TestOwner, chargesEnabled = true) {
  const account = accountId();
  const { error } = await adminClient()
    .from("stripe_accounts")
    .insert({ business_id: owner.businessId, account_id: account, charges_enabled: chargesEnabled, details_submitted: chargesEnabled });
  expect(error).toBeNull();
  return account;
}

async function startCheckout(owner: TestOwner, invoiceId: string) {
  const { pay_token } = await invoiceOf(owner, invoiceId);
  const { data, error } = await adminClient().rpc("begin_invoice_checkout", { token: pay_token }).single();
  expect(error).toBeNull();
  const id = sessionId();
  const recorded = await adminClient().rpc("record_checkout_session", {
    session_id: id,
    invoice_id: data!.invoice_id,
    account_id: data!.account_id,
    amount: data!.amount,
    url: `https://checkout.stripe.com/c/pay/${id}`,
  });
  expect(recorded.error).toBeNull();
  return { sessionId: id, account: data!.account_id, amount: Number(data!.amount) };
}

const applyEvent = (session: string, account: string, outcome: string, amountCents?: number) =>
  adminClient().rpc("apply_checkout_event", {
    session_id: session,
    account_id: account,
    outcome,
    ...(amountCents !== undefined ? { amount_cents: amountCents } : {}),
  });

describe("creating and editing invoices", () => {
  let acme: TestOwner;
  let birch: TestOwner;
  let jane: { id: string };
  let bob: { id: string };

  beforeAll(async () => {
    acme = await signUpOwner("inv-acme", "Acme Lawn Care", { time_zone: TZ });
    birch = await signUpOwner("inv-birch", "Birch Tree Services", { time_zone: TZ });
    jane = await addCustomer(acme, { first_name: "Jane" });
    bob = await addCustomer(acme, { first_name: "Bob" });
  });

  it("numbers invoices from 1001 for each business, as drafts dated today", async () => {
    const first = await newInvoice(acme, jane.id, [{ description: "Spring cleanup", unit_price: 180 }]);
    const second = await newInvoice(acme, bob.id, [{ description: "Mulch", quantity: 3, unit_price: 42.5 }]);
    const birchFirst = await newInvoice(birch, (await addCustomer(birch)).id, [{ description: "Pruning", unit_price: 90 }]);

    expect(await invoiceOf(acme, first)).toMatchObject({ number: 1001, status: "draft", display_status: "draft", total: 180, issue_date: today });
    expect(await invoiceOf(acme, second)).toMatchObject({ number: 1002, total: 127.5, balance: 127.5 });
    expect((await invoiceOf(birch, birchFirst)).number).toBe(1001);
    expect((await invoiceOf(acme, first)).pay_token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("bills visits, and never the same visit on two live invoices", async () => {
    const job = await visit(acme, jane.id, { price: 65, completed: true });
    const first = await newInvoice(acme, jane.id, [{ job_id: job.id, description: "Mowing", unit_price: 65 }]);
    const { data: lines } = await acme.client.from("invoice_lines").select("job_id, amount").eq("invoice_id", first);
    expect(lines).toEqual([{ job_id: job.id, amount: 65 }]);

    const { error } = await save(acme.client, { customerId: jane.id, lines: [{ job_id: job.id, description: "Mowing", unit_price: 65 }] });
    expect(error?.code).toBe(DUPLICATE);
    expect(error?.message).toBe("One of those visits is already on another invoice");

    // Cancelling the first invoice frees the visit.
    expect((await acme.client.rpc("cancel_invoice", { invoice_id: first })).error).toBeNull();
    await newInvoice(acme, jane.id, [{ job_id: job.id, description: "Mowing", unit_price: 65 }]);
  });

  it.each([
    ["no lines", { lines: [] }, INVALID],
    ["a $0 total", { lines: [{ description: "Free", unit_price: 0 }] }, INVALID],
    ["a line with no price", { lines: [{ description: "Mowing" } as unknown as Line] }, INVALID],
    ["a negative price", { lines: [{ description: "Refund", unit_price: -5 }] }, "23514"],
    ["an empty description", { lines: [{ description: "  ", unit_price: 5 }] }, "23514"],
    ["a due date in the past", { lines: [{ description: "Mowing", unit_price: 5 }], dueDate: addDays(today, -1) }, INVALID],
  ])("rejects %s", async (_label, fields, code) => {
    const { error } = await save(acme.client, { customerId: jane.id, ...(fields as { lines: Line[] }) });
    expect(error?.code).toBe(code);
  });

  it("won't bill another business's customer or visit, another customer's visit, or a cancelled visit", async () => {
    const birchCustomer = await addCustomer(birch);
    const birchJob = await visit(birch, birchCustomer.id);
    expect((await save(acme.client, { customerId: birchCustomer.id, lines: [{ description: "x", unit_price: 5 }] })).error?.code).toBe(NOT_FOUND);
    expect((await save(acme.client, { customerId: jane.id, lines: [{ job_id: birchJob.id, description: "x", unit_price: 5 }] })).error?.code).toBe(INVALID);

    const bobsJob = await visit(acme, bob.id);
    expect((await save(acme.client, { customerId: jane.id, lines: [{ job_id: bobsJob.id, description: "x", unit_price: 5 }] })).error?.code).toBe(INVALID);

    const cancelled = await visit(acme, jane.id);
    await acme.client.from("jobs").update({ status: "cancelled" }).eq("id", cancelled.id);
    expect((await save(acme.client, { customerId: jane.id, lines: [{ job_id: cancelled.id, description: "x", unit_price: 5 }] })).error?.code).toBe(INVALID);
  });

  it("a draft can be changed or deleted; a sent invoice can't be changed, only cancelled", async () => {
    const id = await newInvoice(acme, jane.id, [{ description: "Edging", unit_price: 30 }]);
    const edit = await save(acme.client, {
      invoiceId: id,
      customerId: jane.id,
      lines: [{ description: "Edging", unit_price: 30 }, { description: "Weeding", quantity: 2, unit_price: 15 }],
      notes: "Thanks!",
    });
    expect(edit.error).toBeNull();
    expect((await invoiceOf(acme, id)).total).toBe(60);

    const other = await newInvoice(acme, jane.id, [{ description: "Leaves", unit_price: 80 }]);
    expect((await acme.client.rpc("delete_draft_invoice", { invoice_id: other })).error).toBeNull();
    expect((await acme.client.from("invoices").select("id").eq("id", other)).data).toEqual([]);

    expect((await acme.client.rpc("send_invoice", { invoice_id: id })).error).toBeNull();
    expect((await acme.client.rpc("send_invoice", { invoice_id: id })).error).toBeNull(); // already sent: fine
    expect((await save(acme.client, { invoiceId: id, customerId: jane.id, lines: [{ description: "x", unit_price: 1 }] })).error?.code).toBe(INVALID);
    expect((await acme.client.rpc("delete_draft_invoice", { invoice_id: id })).error?.code).toBe(INVALID);

    // More time to pay.
    const later = addDays(today, 30);
    expect((await acme.client.rpc("change_invoice_due_date", { invoice_id: id, due_date: later })).error).toBeNull();
    expect((await invoiceOf(acme, id)).due_date).toBe(later);

    expect((await acme.client.rpc("cancel_invoice", { invoice_id: id })).error).toBeNull();
    expect((await invoiceOf(acme, id)).display_status).toBe("cancelled");
    expect((await acme.client.rpc("send_invoice", { invoice_id: id })).error?.code).toBe(INVALID);
  });

  it("an invoice with a payment can't be cancelled", async () => {
    const id = await newInvoice(acme, jane.id, [{ description: "Aeration", unit_price: 120 }], { send: true });
    expect((await pay(acme.client, id, 20)).error).toBeNull();
    expect((await acme.client.rpc("cancel_invoice", { invoice_id: id })).error?.code).toBe(INVALID);
  });

  it("nobody writes invoices, lines or payments directly", async () => {
    const id = await newInvoice(acme, jane.id, [{ description: "Mowing", unit_price: 65 }]);
    expect((await acme.client.from("invoices").update({ total: 1 }).eq("id", id)).error?.code).toBe(PERMISSION_DENIED);
    expect((await acme.client.from("invoices").update({ status: "sent" }).eq("id", id)).error?.code).toBe(PERMISSION_DENIED);
    expect(
      (await acme.client.from("invoice_lines").insert({ business_id: acme.businessId, invoice_id: id, description: "x", unit_price: 1 })).error?.code,
    ).toBe(PERMISSION_DENIED);
    expect(
      (await acme.client.from("payments").insert({ business_id: acme.businessId, invoice_id: id, amount: 65, method: "cash", received_on: today, request_id: randomUUID() }))
        .error?.code,
    ).toBe(PERMISSION_DENIED);
    expect((await acme.client.from("invoices").delete().eq("id", id)).error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("statuses are worked out live", () => {
  let acme: TestOwner;
  let customerId: string;

  beforeAll(async () => {
    acme = await signUpOwner("inv-status", "Status Lawns", { time_zone: TZ });
    customerId = (await addCustomer(acme)).id;
  });

  it("goes draft → sent → partial → paid as payments come in", async () => {
    const id = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 100 }]);
    expect((await invoiceOf(acme, id)).display_status).toBe("draft");
    await acme.client.rpc("send_invoice", { invoice_id: id });
    expect((await invoiceOf(acme, id)).display_status).toBe("sent");
    await pay(acme.client, id, 40);
    expect(await invoiceOf(acme, id)).toMatchObject({ display_status: "partial", amount_paid: 40, balance: 60, status: "sent" });
    await pay(acme.client, id, 60, { method: "check" });
    expect(await invoiceOf(acme, id)).toMatchObject({ display_status: "paid", balance: 0, status: "sent" });
  });

  it("is overdue as soon as the due date passes, with nothing having to update it", async () => {
    const id = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 100 }], { send: true });
    // Move the invoice into the past (as if it had been sent weeks ago).
    await adminClient().from("invoices").update({ issue_date: addDays(today, -30), due_date: addDays(today, -1) }).eq("id", id);
    expect((await invoiceOf(acme, id)).display_status).toBe("overdue");
    // Partly paid but late is still overdue; paid in full is paid.
    await pay(acme.client, id, 30);
    expect((await invoiceOf(acme, id)).display_status).toBe("overdue");
    await pay(acme.client, id, 70);
    expect((await invoiceOf(acme, id)).display_status).toBe("paid");

    // Due today is not overdue yet.
    const dueToday = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 100 }], { send: true });
    await acme.client.rpc("change_invoice_due_date", { invoice_id: dueToday, due_date: today });
    expect((await invoiceOf(acme, dueToday)).display_status).toBe("sent");
  });
});

describe("recording payments by hand", () => {
  let acme: TestOwner;
  let customerId: string;

  beforeAll(async () => {
    acme = await signUpOwner("inv-pay", "Payment Lawns", { time_zone: TZ });
    customerId = (await addCustomer(acme)).id;
  });

  it("records cash, check or other payments on a sent invoice, up to the balance", async () => {
    const draft = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 50 }]);
    expect((await pay(acme.client, draft, 10)).error?.code).toBe(INVALID);

    const id = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 50 }], { send: true });
    expect((await pay(acme.client, id, 60)).error?.message).toBe("That's more than the balance due");
    expect((await pay(acme.client, id, 0)).error?.code).toBe(INVALID);
    expect((await pay(acme.client, id, 10, { receivedOn: addDays(today, 1) })).error?.code).toBe(INVALID);
    expect((await pay(acme.client, id, 10, { method: "online" })).error?.code).toBe(INVALID);
    expect((await pay(acme.client, id, 10, { method: "other" })).error).toBeNull();
    expect((await invoiceOf(acme, id)).balance).toBe(40);
  });

  it("records a payment once, however many times the same form is submitted", async () => {
    const id = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 80 }], { send: true });
    const requestId = randomUUID();
    const first = await pay(acme.client, id, 30, { requestId });
    const again = await pay(acme.client, id, 30, { requestId });
    expect(again.data).toBe(first.data);

    // Even at the same moment.
    const racingId = randomUUID();
    const results = await Promise.all([1, 2, 3].map(() => pay(acme.client, id, 20, { requestId: racingId })));
    expect(results.every((r) => r.error === null)).toBe(true);
    expect(new Set(results.map((r) => r.data)).size).toBe(1);

    expect((await paymentsOf(acme, id)).map((p) => p.amount).sort()).toEqual([20, 30]);
    expect((await invoiceOf(acme, id)).amount_paid).toBe(50);
  });

  it("two different payments at the same moment can't add up to more than the balance", async () => {
    const id = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 100 }], { send: true });
    const results = await Promise.all([pay(acme.client, id, 70), pay(acme.client, id, 70)]);
    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect((await invoiceOf(acme, id)).amount_paid).toBe(70);
  });

  it("a payment recorded by mistake can be removed", async () => {
    const id = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 45 }], { send: true });
    const { data: paymentId } = await pay(acme.client, id, 45);
    expect((await invoiceOf(acme, id)).display_status).toBe("paid");
    expect((await acme.client.rpc("delete_manual_payment", { payment_id: paymentId! })).error).toBeNull();
    expect(await invoiceOf(acme, id)).toMatchObject({ display_status: "sent", balance: 45 });
  });
});

describe("crew members, other businesses and signed-out visitors", () => {
  let acme: TestOwner;
  let maria: TestCrew;
  let birch: TestOwner;
  let invoiceId: string;
  let paymentId: string;
  let token: string;

  beforeAll(async () => {
    acme = await signUpOwner("inv-iso-acme", "Acme Lawn Care", { time_zone: TZ });
    maria = await joinCrew(acme, "Maria");
    birch = await signUpOwner("inv-iso-birch", "Birch Tree Services", { time_zone: TZ });
    const customer = await addCustomer(acme, { first_name: "Secret", last_name: "Client", phone: "631-555-0100", property_address: "1 Hidden Lane" });
    const job = await visit(acme, customer.id, { crew: maria.crewMemberId, completed: true, price: 250 });
    invoiceId = await newInvoice(acme, customer.id, [{ job_id: job.id, description: "Mowing", unit_price: 250 }], { send: true });
    paymentId = (await pay(acme.client, invoiceId, 50)).data!;
    token = (await invoiceOf(acme, invoiceId)).pay_token;
    await connectStripe(acme);
  });

  const tables = ["invoices", "invoice_lines", "payments", "invoice_settings", "stripe_accounts", "checkout_sessions"] as const;

  it("a crew member sees none of it, not even for the visits they did", async () => {
    for (const table of tables) expect((await maria.client.from(table).select("*")).data).toEqual([]);
    expect((await maria.client.from("stripe_events").select("*")).error?.code).toBe(PERMISSION_DENIED);
  });

  it("a crew member can't create, send, cancel, pay or change anything", async () => {
    const calls = [
      save(maria.client, { customerId: randomUUID(), lines: [{ description: "x", unit_price: 1 }] }),
      maria.client.rpc("send_invoice", { invoice_id: invoiceId }),
      maria.client.rpc("cancel_invoice", { invoice_id: invoiceId }),
      maria.client.rpc("delete_draft_invoice", { invoice_id: invoiceId }),
      maria.client.rpc("change_invoice_due_date", { invoice_id: invoiceId, due_date: addDays(today, 60) }),
      pay(maria.client, invoiceId, 10),
      maria.client.rpc("delete_manual_payment", { payment_id: paymentId }),
      maria.client.rpc("set_auto_invoice", { enabled: true }),
    ];
    for (const { error } of await Promise.all(calls)) expect(error?.code).toBe(PERMISSION_DENIED);
    expect(await invoiceOf(acme, invoiceId)).toMatchObject({ status: "sent", amount_paid: 50 });
  });

  it("another business can't see this business's invoices, even by id", async () => {
    for (const table of tables) {
      expect((await birch.client.from(table).select("*").eq("business_id", acme.businessId)).data).toEqual([]);
    }
    expect((await birch.client.from("invoices").select("*").eq("id", invoiceId)).data).toEqual([]);
  });

  it("another business can't act on this business's invoices or payments", async () => {
    const calls = [
      birch.client.rpc("send_invoice", { invoice_id: invoiceId }),
      birch.client.rpc("cancel_invoice", { invoice_id: invoiceId }),
      birch.client.rpc("delete_draft_invoice", { invoice_id: invoiceId }),
      birch.client.rpc("change_invoice_due_date", { invoice_id: invoiceId, due_date: addDays(today, 60) }),
      pay(birch.client, invoiceId, 10),
      birch.client.rpc("delete_manual_payment", { payment_id: paymentId }),
      save(birch.client, { invoiceId, customerId: randomUUID(), lines: [{ description: "x", unit_price: 1 }] }),
    ];
    for (const { error } of await Promise.all(calls)) expect([NOT_FOUND, PERMISSION_DENIED]).toContain(error?.code);
    expect(await invoiceOf(acme, invoiceId)).toMatchObject({ status: "sent", amount_paid: 50, total: 250 });
    expect(await paymentsOf(acme, invoiceId)).toHaveLength(1);
  });

  it("signed-out visitors get nothing from the tables or functions", async () => {
    const anon = anonClient();
    for (const table of tables) expect((await anon.from(table).select("*")).error?.code).toBe(PERMISSION_DENIED);
    expect((await pay(anon, invoiceId, 10)).error?.code).toBe(PERMISSION_DENIED);
    expect((await anon.rpc("send_invoice", { invoice_id: invoiceId })).error?.code).toBe(PERMISSION_DENIED);
  });

  it("the pay link shows its one invoice to anyone who has it, and nothing more", async () => {
    const { data, error } = await anonClient().rpc("public_invoice", { token });
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        business_name: "Acme Lawn Care",
        number: 1001,
        customer_name: "Secret Client",
        issue_date: today,
        due_date: addDays(today, 14),
        status: "partial",
        total: 250,
        amount_paid: 50,
        balance: 200,
        lines: [{ description: "Mowing", quantity: 1, unit_price: 250, amount: 250 }],
        can_pay_online: true,
        payment_processing: false,
      },
    ]);
    // No phone number, address, ids or other invoices.
    expect(JSON.stringify(data)).not.toMatch(/631|Hidden Lane|[0-9a-f]{8}-[0-9a-f]{4}/);

    for (const bad of ["", "nope", randomBytes(32).toString("hex"), `${token}' or '1'='1`]) {
      expect((await anonClient().rpc("public_invoice", { token: bad })).data).toEqual([]);
    }
  });

  it("a draft or cancelled invoice's pay link shows nothing", async () => {
    const customer = await addCustomer(acme);
    const draft = await newInvoice(acme, customer.id, [{ description: "Mowing", unit_price: 10 }]);
    expect((await anonClient().rpc("public_invoice", { token: (await invoiceOf(acme, draft)).pay_token })).data).toEqual([]);
    await acme.client.rpc("send_invoice", { invoice_id: draft });
    await acme.client.rpc("cancel_invoice", { invoice_id: draft });
    expect((await anonClient().rpc("public_invoice", { token: (await invoiceOf(acme, draft)).pay_token })).data).toEqual([]);
  });
});

describe("auto-invoicing when a visit is completed", () => {
  let acme: TestOwner;
  let maria: TestCrew;
  let birch: TestOwner;
  let customerId: string;

  const invoicesFor = async (owner: TestOwner, jobId: string) =>
    (await owner.client.from("invoice_lines").select("invoice_id, description, amount, invoice:invoices(status, due_date)").eq("job_id", jobId)).data!;

  beforeAll(async () => {
    acme = await signUpOwner("inv-auto", "Auto Lawns", { time_zone: TZ });
    maria = await joinCrew(acme, "Maria");
    birch = await signUpOwner("inv-auto-birch", "Birch Tree Services", { time_zone: TZ });
    customerId = (await addCustomer(acme)).id;
  });

  it("does nothing while it's off", async () => {
    const job = await visit(acme, customerId, { completed: true });
    expect(await invoicesFor(acme, job.id)).toEqual([]);
  });

  it("creates a draft invoice for each completed visit once it's on", async () => {
    expect((await acme.client.rpc("set_auto_invoice", { enabled: true })).error).toBeNull();
    const job = await visit(acme, customerId, { price: 85, completed: true });
    const [line] = await invoicesFor(acme, job.id);
    expect(line).toMatchObject({ amount: 85, invoice: { status: "draft", due_date: addDays(today, 14) } });
    expect(line.description).toMatch(/^Mowing \(\w{3}, \w{3} \d{1,2}\)$/);

    // Reopening and completing it again doesn't invoice it twice.
    await acme.client.from("jobs").update({ status: "in_progress" }).eq("id", job.id);
    await acme.client.from("jobs").update({ status: "completed" }).eq("id", job.id);
    expect(await invoicesFor(acme, job.id)).toHaveLength(1);
  });

  it("works when a crew member marks their job completed", async () => {
    const job = await visit(acme, customerId, { crew: maria.crewMemberId, price: 40 });
    expect((await maria.client.rpc("crew_set_job_status", { job_id: job.id, new_status: "completed" })).error).toBeNull();
    expect(await invoicesFor(acme, job.id)).toEqual([expect.objectContaining({ amount: 40 })]);
    // The crew member still sees no invoices.
    expect((await maria.client.from("invoices").select("*")).data).toEqual([]);
  });

  it("skips $0 visits", async () => {
    const job = await visit(acme, customerId, { price: 0, completed: true });
    expect(await invoicesFor(acme, job.id)).toEqual([]);
  });

  it("is each business's own setting", async () => {
    const birchCustomer = await addCustomer(birch);
    const job = await visit(birch, birchCustomer.id, { completed: true });
    expect(await invoicesFor(birch, job.id)).toEqual([]);
    const { data } = await birch.client.from("invoice_settings").select("auto_invoice");
    expect(data).toEqual([]);
  });
});

describe("Stripe payments", () => {
  let acme: TestOwner;
  let birch: TestOwner;
  let acmeAccount: string;
  let birchAccount: string;
  let customerId: string;

  beforeAll(async () => {
    acme = await signUpOwner("inv-stripe", "Acme Lawn Care", { time_zone: TZ });
    birch = await signUpOwner("inv-stripe-birch", "Birch Tree Services", { time_zone: TZ });
    customerId = (await addCustomer(acme)).id;
    acmeAccount = await connectStripe(acme);
    birchAccount = await connectStripe(birch);
  });

  it("only the app's server (service role) can start checkouts or record Stripe payments", async () => {
    const id = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 65 }], { send: true });
    const { pay_token } = await invoiceOf(acme, id);
    for (const client of [acme.client, anonClient()]) {
      expect((await client.rpc("begin_invoice_checkout", { token: pay_token })).error?.code).toBe(PERMISSION_DENIED);
      expect((await client.rpc("apply_checkout_event", { session_id: sessionId(), account_id: acmeAccount, outcome: "paid" })).error?.code).toBe(
        PERMISSION_DENIED,
      );
      expect(
        (await client.rpc("record_checkout_session", { session_id: sessionId(), invoice_id: id, account_id: acmeAccount, amount: 65, url: "x" })).error
          ?.code,
      ).toBe(PERMISSION_DENIED);
      expect((await client.rpc("record_stripe_event", { event_id: "evt_1", event_type: "x" })).error?.code).toBe(PERMISSION_DENIED);
    }
    for (const table of ["stripe_accounts", "checkout_sessions"] as const) {
      expect((await acme.client.from(table).insert({} as never)).error?.code).toBe(PERMISSION_DENIED);
    }
  });

  it("records a card payment once, however many times Stripe sends the event", async () => {
    const id = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 65 }], { send: true });
    const checkout = await startCheckout(acme, id);
    expect(checkout).toMatchObject({ account: acmeAccount, amount: 65 });

    expect((await applyEvent(checkout.sessionId, acmeAccount, "paid", 6500)).data).toBe("recorded");
    expect((await applyEvent(checkout.sessionId, acmeAccount, "paid", 6500)).data).toBe("already_recorded");
    expect((await applyEvent(checkout.sessionId, acmeAccount, "paid_later", 6500)).data).toBe("already_recorded");
    // Stripe retrying several deliveries at the same moment.
    await Promise.all([1, 2, 3].map(() => applyEvent(checkout.sessionId, acmeAccount, "paid", 6500)));

    expect(await paymentsOf(acme, id)).toEqual([expect.objectContaining({ amount: 65, method: "online", checkout_session_id: checkout.sessionId })]);
    expect(await invoiceOf(acme, id)).toMatchObject({ display_status: "paid", amount_paid: 65 });
  });

  it("ignores checkouts EcoScape Ops didn't start, or events from another account", async () => {
    const id = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 65 }], { send: true });
    const checkout = await startCheckout(acme, id);
    // Another business's Stripe account can't mark this invoice paid.
    expect((await applyEvent(checkout.sessionId, birchAccount, "paid", 6500)).data).toBe("unknown_checkout");
    expect((await applyEvent(sessionId(), acmeAccount, "paid", 6500)).data).toBe("unknown_checkout");
    expect(await paymentsOf(acme, id)).toEqual([]);
  });

  it("a checkout can only be started on the invoice's own business's account", async () => {
    const id = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 65 }], { send: true });
    const { error } = await adminClient().rpc("record_checkout_session", {
      session_id: sessionId(),
      invoice_id: id,
      account_id: birchAccount,
      amount: 65,
      url: "https://checkout.stripe.com/x",
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("reuses an open checkout for the same amount, so two taps don't start two payments", async () => {
    const id = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 100 }], { send: true });
    const first = await startCheckout(acme, id);
    const { pay_token } = await invoiceOf(acme, id);
    const { data } = await adminClient().rpc("begin_invoice_checkout", { token: pay_token }).single();
    expect(data!.reusable_url).toBe(`https://checkout.stripe.com/c/pay/${first.sessionId}`);

    // After a cash payment the balance differs, so a new checkout is needed.
    await pay(acme.client, id, 25);
    const { data: after } = await adminClient().rpc("begin_invoice_checkout", { token: pay_token }).single();
    expect(after).toMatchObject({ amount: 75, reusable_url: null });
  });

  it("follows a bank payment from processing to cleared, or failed", async () => {
    const id = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 300 }], { send: true });
    const { pay_token } = await invoiceOf(acme, id);
    const checkout = await startCheckout(acme, id);
    expect((await applyEvent(checkout.sessionId, acmeAccount, "processing")).data).toBe("processing");
    const { data: shown } = await anonClient().rpc("public_invoice", { token: pay_token });
    expect(shown![0]).toMatchObject({ payment_processing: true, status: "sent" });

    expect((await applyEvent(checkout.sessionId, acmeAccount, "paid_later", 30000)).data).toBe("recorded");
    expect(await paymentsOf(acme, id)).toEqual([expect.objectContaining({ amount: 300, method: "bank_transfer" })]);

    const other = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 50 }], { send: true });
    const failing = await startCheckout(acme, other);
    await applyEvent(failing.sessionId, acmeAccount, "processing");
    expect((await applyEvent(failing.sessionId, acmeAccount, "failed")).data).toBe("failed");
    expect(await invoiceOf(acme, other)).toMatchObject({ display_status: "sent", amount_paid: 0 });
  });

  it("won't start a checkout before the business can take payments, or for a draft or paid invoice", async () => {
    const pending = await signUpOwner("inv-stripe-pending", "Pending Lawns", { time_zone: TZ });
    await connectStripe(pending, false);
    const invoice = await newInvoice(pending, (await addCustomer(pending)).id, [{ description: "Mowing", unit_price: 65 }], { send: true });
    const { data: shown } = await anonClient().rpc("public_invoice", { token: (await invoiceOf(pending, invoice)).pay_token });
    expect(shown![0].can_pay_online).toBe(false);
    expect((await adminClient().rpc("begin_invoice_checkout", { token: (await invoiceOf(pending, invoice)).pay_token })).error?.code).toBe(NOT_READY);

    const draft = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 65 }]);
    expect((await adminClient().rpc("begin_invoice_checkout", { token: (await invoiceOf(acme, draft)).pay_token })).error?.code).toBe(NOT_FOUND);

    const paid = await newInvoice(acme, customerId, [{ description: "Mowing", unit_price: 65 }], { send: true });
    await pay(acme.client, paid, 65);
    expect((await adminClient().rpc("begin_invoice_checkout", { token: (await invoiceOf(acme, paid)).pay_token })).error?.code).toBe(INVALID);
  });

  it("logs each Stripe event once", async () => {
    const eventId = `evt_${randomBytes(8).toString("hex")}`;
    expect((await adminClient().rpc("record_stripe_event", { event_id: eventId, event_type: "checkout.session.completed" })).data).toBe(true);
    expect((await adminClient().rpc("record_stripe_event", { event_id: eventId, event_type: "checkout.session.completed" })).data).toBe(false);
  });

  it("each owner sees only their own checkouts and Stripe account", async () => {
    const { data: accounts } = await birch.client.from("stripe_accounts").select("account_id");
    expect(accounts).toEqual([{ account_id: birchAccount }]);
    const { data: sessions } = await birch.client.from("checkout_sessions").select("id");
    expect(sessions).toEqual([]);
    expect((await acme.client.from("checkout_sessions").select("id")).data!.length).toBeGreaterThan(0);
  });
});

describe("dashboard money", () => {
  let acme: TestOwner;
  let maria: TestCrew;
  let birch: TestOwner;

  const summaryOf = async (client: Client) => {
    const { data, error } = await client.rpc("dashboard_summary");
    expect(error).toBeNull();
    return data![0];
  };

  beforeAll(async () => {
    acme = await signUpOwner("inv-dash", "Dashboard Lawns", { time_zone: TZ });
    maria = await joinCrew(acme, "Maria");
    birch = await signUpOwner("inv-dash-birch", "Birch Tree Services", { time_zone: TZ });
  });

  it("counts each visit once, at its invoiced amount once invoiced, plus other invoiced items", async () => {
    const customer = await addCustomer(acme);
    const invoicedVisit = await visit(acme, customer.id, { price: 100, completed: true });
    await visit(acme, customer.id, { price: 50, completed: true });
    const draftVisit = await visit(acme, customer.id, { price: 70 });

    const before = await summaryOf(acme.client);
    expect(before).toMatchObject({ month_booked: 220, month_completed: 150, outstanding: 0, overdue: 0, month_collected: 0 });

    // The $100 visit is billed at $90, with $25 of mulch on the same invoice.
    const invoice = await newInvoice(
      acme,
      customer.id,
      [
        { job_id: invoicedVisit.id, description: "Mowing", unit_price: 90 },
        { description: "Mulch", unit_price: 25 },
      ],
      { send: true },
    );
    // A draft doesn't change anything until it's sent.
    await newInvoice(acme, customer.id, [{ job_id: draftVisit.id, description: "Mowing", unit_price: 60 }]);
    // A cancelled invoice never counts.
    const cancelled = await newInvoice(acme, customer.id, [{ description: "Big job", unit_price: 1000 }], { send: true });
    await acme.client.rpc("cancel_invoice", { invoice_id: cancelled });
    await pay(acme.client, invoice, 40);

    const after = await summaryOf(acme.client);
    // 90 (not 100 + 90) + 50 + 70 + 25 mulch
    expect(after).toMatchObject({ month_booked: 235, month_completed: 165, outstanding: 75, overdue: 0, month_collected: 40 });
  });

  it("shows what's overdue", async () => {
    const customer = await addCustomer(acme);
    const late = await newInvoice(acme, customer.id, [{ description: "Leaf cleanup", unit_price: 30 }], { send: true });
    await adminClient()
      .from("invoices")
      .update({ issue_date: addDays(today, -60), due_date: addDays(today, -45) })
      .eq("id", late);
    const summary = await summaryOf(acme.client);
    expect(summary).toMatchObject({ outstanding: 105, overdue: 30 });
  });

  it("gives crew members no money at all", async () => {
    const summary = await summaryOf(maria.client);
    expect(summary).toMatchObject({ month_booked: null, month_completed: null, month_expenses: null, outstanding: null, overdue: null, month_collected: null });
  });

  it("never mixes in another business's invoices or payments", async () => {
    expect(await summaryOf(birch.client)).toMatchObject({ month_booked: 0, outstanding: 0, overdue: 0, month_collected: 0 });
  });
});
