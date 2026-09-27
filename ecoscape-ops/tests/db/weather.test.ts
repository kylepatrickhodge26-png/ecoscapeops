// Weather: each business's service area, its texting number, moving a rain day's visits,
// and texting the affected customers. Checks that only opted-in customers are ever
// texted, that nothing is texted twice, and that one business's settings, visits, texts
// and STOP replies never touch another's.
import { randomInt } from "node:crypto";

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
  type Client,
  type TestCrew,
  type TestOwner,
} from "./helpers";

const PERMISSION_DENIED = "42501";
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const INVALID_PARAMETER = "22023";
const NOT_FOUND = "P0002";
const NOT_SET_UP = "55000";
const TZ = "America/New_York";

// A random US number (unique per run, since sms_senders numbers are unique).
const randomNumber = () => `+1${randomInt(200, 999)}${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
// The same number the way someone might type it on a customer record.
const typed = (e164: string) => `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;

// Assigning a texting number is an operator task (service role), never an owner one.
async function assignNumber(owner: TestOwner, phone = randomNumber()) {
  const { error } = await adminClient().from("sms_senders").insert({ business_id: owner.businessId, phone_number: phone });
  expect(error).toBeNull();
  return phone;
}

// Books a one-time visit on a date, optionally with a status or crew member.
async function visit(
  owner: TestOwner,
  customerId: string,
  date: string,
  opts: { status?: "completed" | "cancelled" | "assigned"; crew?: string } = {},
) {
  const plan = await bookService(owner, customerId, {
    frequency: "one_time",
    start_date: date,
    assigned_crew_member_id: opts.crew ?? null,
  });
  const { data: job } = await owner.client.from("jobs").select("id").eq("service_plan_id", plan.id).single();
  if (opts.status) {
    const { error } = await owner.client.from("jobs").update({ status: opts.status }).eq("id", job!.id);
    expect(error).toBeNull();
  }
  return job!.id;
}

async function jobsOn(owner: TestOwner, date: string) {
  const { data, error } = await owner.client
    .from("jobs")
    .select("id, status, notes, scheduled_date, assigned_crew_member_id")
    .eq("scheduled_date", date);
  expect(error).toBeNull();
  return data!;
}

async function moveDay(client: Client, from: string, to: string) {
  return client.rpc("move_day_visits", { from_date: from, to_date: to });
}

describe("service area", () => {
  let acme: TestOwner;
  let maria: TestCrew;
  let birch: TestOwner;

  const area = { postal_code: "11779", place_name: "Lake Ronkonkoma", latitude: 40.8154, longitude: -73.1123 };

  beforeAll(async () => {
    acme = await signUpOwner("area-acme", "Acme Lawn Care", { time_zone: TZ });
    maria = await joinCrew(acme, "Maria");
    birch = await signUpOwner("area-birch", "Birch Tree Services", { time_zone: TZ });
  });

  it("the owner can set and change their service area", async () => {
    const { error } = await acme.client.from("service_areas").upsert({ business_id: acme.businessId, ...area });
    expect(error).toBeNull();
    const { error: changeError } = await acme.client
      .from("service_areas")
      .upsert({ business_id: acme.businessId, postal_code: "10001", place_name: "New York", latitude: 40.7484, longitude: -73.9967 });
    expect(changeError).toBeNull();

    const { data } = await acme.client.from("service_areas").select("postal_code, place_name").single();
    expect(data).toEqual({ postal_code: "10001", place_name: "New York" });

    // Back to Lake Ronkonkoma for the rest of these tests.
    await acme.client.from("service_areas").upsert({ business_id: acme.businessId, ...area });
  });

  it("crew members can read their business's area for the forecast, but not the table", async () => {
    const { data: direct } = await maria.client.from("service_areas").select("*");
    expect(direct).toEqual([]);

    const { data, error } = await maria.client.rpc("business_service_area");
    expect(error).toBeNull();
    expect(data).toEqual([area]);

    const { error: writeError } = await maria.client
      .from("service_areas")
      .upsert({ business_id: acme.businessId, ...area, postal_code: "90210" });
    expect(writeError?.code).toBe(PERMISSION_DENIED);
  });

  it("another business can't see, set, change, or remove it", async () => {
    const { data: seen } = await birch.client.from("service_areas").select("*").eq("business_id", acme.businessId);
    expect(seen).toEqual([]);
    const { data: viaRpc } = await birch.client.rpc("business_service_area");
    expect(viaRpc).toEqual([]);

    const { error: insertError } = await birch.client
      .from("service_areas")
      .insert({ business_id: acme.businessId, ...area, postal_code: "90210" });
    expect(insertError).not.toBeNull();

    const { data: updated } = await birch.client
      .from("service_areas")
      .update({ postal_code: "90210" })
      .eq("business_id", acme.businessId)
      .select();
    expect(updated).toEqual([]);

    const { data: deleted } = await birch.client.from("service_areas").delete().eq("business_id", acme.businessId).select();
    expect(deleted).toEqual([]);

    const { data: still } = await maria.client.rpc("business_service_area");
    expect(still).toEqual([area]);
  });

  it("an area can't be moved to another business", async () => {
    const { error } = await acme.client
      .from("service_areas")
      .update({ business_id: birch.businessId })
      .eq("business_id", acme.businessId);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it.each([
    ["a ZIP code that isn't 5 digits", { postal_code: "1177" }],
    ["an impossible latitude", { latitude: 95 }],
    ["an impossible longitude", { longitude: -190 }],
    ["an empty place name", { place_name: " " }],
  ])("rejects %s", async (_label, fields) => {
    const { error } = await birch.client.from("service_areas").upsert({ business_id: birch.businessId, ...area, ...fields });
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("signed-out visitors get nothing", async () => {
    const { error } = await anonClient().from("service_areas").select("*");
    expect(error?.code).toBe(PERMISSION_DENIED);
    const { error: rpcError } = await anonClient().rpc("business_service_area");
    expect(rpcError?.code).toBe(PERMISSION_DENIED);
  });
});

describe("texting numbers", () => {
  let acme: TestOwner;
  let maria: TestCrew;
  let birch: TestOwner;
  let acmeNumber: string;

  beforeAll(async () => {
    acme = await signUpOwner("num-acme", "Acme Lawn Care", { time_zone: TZ });
    maria = await joinCrew(acme, "Maria");
    birch = await signUpOwner("num-birch", "Birch Tree Services", { time_zone: TZ });
    acmeNumber = await assignNumber(acme);
  });

  it("the owner can see their number, and only theirs", async () => {
    const { data } = await acme.client.from("sms_senders").select("business_id, phone_number");
    expect(data).toEqual([{ business_id: acme.businessId, phone_number: acmeNumber }]);
  });

  it("owners can't assign, change, or remove a number — not even their own", async () => {
    const { error: insertError } = await birch.client
      .from("sms_senders")
      .insert({ business_id: birch.businessId, phone_number: randomNumber() });
    expect(insertError?.code).toBe(PERMISSION_DENIED);

    // Taking over another business's number would let one business text as another.
    const { error: updateError } = await acme.client
      .from("sms_senders")
      .update({ phone_number: randomNumber() })
      .eq("business_id", acme.businessId);
    expect(updateError?.code).toBe(PERMISSION_DENIED);

    const { error: deleteError } = await acme.client.from("sms_senders").delete().eq("business_id", acme.businessId);
    expect(deleteError?.code).toBe(PERMISSION_DENIED);

    const { data } = await acme.client.from("sms_senders").select("phone_number").single();
    expect(data!.phone_number).toBe(acmeNumber);
  });

  it("crew members, other businesses, and signed-out visitors can't see it", async () => {
    expect((await maria.client.from("sms_senders").select("*")).data).toEqual([]);
    expect((await birch.client.from("sms_senders").select("*")).data).toEqual([]);
    expect((await anonClient().from("sms_senders").select("*")).error?.code).toBe(PERMISSION_DENIED);
  });

  it("two businesses can never share a number", async () => {
    const { error } = await adminClient().from("sms_senders").insert({ business_id: birch.businessId, phone_number: acmeNumber });
    expect(error?.code).toBe(UNIQUE_VIOLATION);
  });

  it("numbers must be in +15551234567 form", async () => {
    const { error } = await adminClient().from("sms_senders").insert({ business_id: birch.businessId, phone_number: "631-555-0100" });
    expect(error?.code).toBe(CHECK_VIOLATION);
  });
});

describe("moving a rain day's visits", () => {
  const today = todayIn(TZ);
  const rainDay = addDays(today, 1);
  const newDay = addDays(today, 2);
  let acme: TestOwner;
  let maria: TestCrew;
  let birch: TestOwner;
  let birchJob: string;
  let ids: Record<"scheduled" | "assigned" | "completed" | "cancelled" | "dayAfter", string>;

  beforeAll(async () => {
    acme = await signUpOwner("move-acme", "Acme Lawn Care", { time_zone: TZ });
    maria = await joinCrew(acme, "Maria");
    const customer = await addCustomer(acme, { first_name: "Jane" });
    ids = {
      scheduled: await visit(acme, customer.id, rainDay),
      assigned: await visit(acme, customer.id, rainDay, { crew: maria.crewMemberId }),
      completed: await visit(acme, customer.id, rainDay, { status: "completed" }),
      cancelled: await visit(acme, customer.id, rainDay, { status: "cancelled" }),
      dayAfter: await visit(acme, customer.id, addDays(rainDay, 3)),
    };

    // Another business with a visit on the same day.
    birch = await signUpOwner("move-birch", "Birch Tree Services", { time_zone: TZ });
    birchJob = await visit(birch, (await addCustomer(birch)).id, rainDay);
  });

  it("crew members and signed-out visitors can't move a day", async () => {
    const { error } = await moveDay(maria.client, rainDay, newDay);
    expect(error?.code).toBe(PERMISSION_DENIED);
    const { error: anonError } = await moveDay(anonClient(), rainDay, newDay);
    expect(anonError?.code).toBe(PERMISSION_DENIED);
    expect((await jobsOn(acme, rainDay)).length).toBe(4);
  });

  it.each([
    ["the same date twice", () => [rainDay, rainDay]],
    ["a date before today", () => [addDays(today, -1), newDay]],
    ["a new date before today", () => [rainDay, addDays(today, -1)]],
  ])("rejects %s", async (_label, dates) => {
    const [from, to] = dates();
    const { error } = await moveDay(acme.client, from, to);
    expect(error?.code).toBe(INVALID_PARAMETER);
  });

  it("says so when there's nothing to move, and leaves no rain delay behind", async () => {
    const { error } = await moveDay(acme.client, addDays(today, 20), addDays(today, 21));
    expect(error?.code).toBe(NOT_FOUND);
    const { data } = await acme.client.from("rain_delays").select("id");
    expect(data).toEqual([]);
  });

  it("moves the day's open visits, marks them weather-delayed, and keeps who they're assigned to", async () => {
    const { data: delayId, error } = await moveDay(acme.client, rainDay, newDay);
    expect(error).toBeNull();

    const moved = await jobsOn(acme, newDay);
    expect(moved.map((j) => j.id).sort()).toEqual([ids.scheduled, ids.assigned].sort());
    for (const job of moved) {
      expect(job.status).toBe("weather_delay");
      expect(job.notes).toMatch(/^Moved from \w{3}, \w{3} \d{1,2} due to weather$/);
    }
    expect(moved.find((j) => j.id === ids.assigned)!.assigned_crew_member_id).toBe(maria.crewMemberId);

    // Completed and cancelled visits stay where they were.
    const left = await jobsOn(acme, rainDay);
    expect(left.map((j) => j.id).sort()).toEqual([ids.completed, ids.cancelled].sort());
    expect((await jobsOn(acme, addDays(rainDay, 3))).map((j) => j.id)).toEqual([ids.dayAfter]);

    const { data: delay } = await acme.client.from("rain_delays").select("id, from_date, to_date, created_by").single();
    expect(delay).toEqual({ id: delayId, from_date: rainDay, to_date: newDay, created_by: acme.userId });
    const { data: links } = await acme.client.from("rain_delay_visits").select("job_id").eq("rain_delay_id", delayId!);
    expect(links!.map((l) => l.job_id).sort()).toEqual([ids.scheduled, ids.assigned].sort());
  });

  it("never touches another business's visits on the same day", async () => {
    const birchJobs = await jobsOn(birch, rainDay);
    expect(birchJobs).toEqual([
      expect.objectContaining({ id: birchJob, status: "scheduled", notes: "", scheduled_date: rainDay }),
    ]);
  });

  it("another business, and crew members, can't see this business's rain delays", async () => {
    for (const client of [birch.client, maria.client]) {
      expect((await client.from("rain_delays").select("*")).data).toEqual([]);
      expect((await client.from("rain_delay_visits").select("*")).data).toEqual([]);
    }
  });

  it("nobody can write rain delays directly", async () => {
    const { error } = await acme.client
      .from("rain_delays")
      .insert({ business_id: acme.businessId, from_date: rainDay, to_date: newDay });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("the moved visit shows up for the crew member it's assigned to, on the new day", async () => {
    const { data } = await maria.client.rpc("crew_jobs", { from_date: newDay, to_date: newDay });
    expect(data!.map((j) => [j.id, j.status])).toEqual([[ids.assigned, "weather_delay"]]);
  });
});

describe("texting customers about a rain delay", () => {
  const today = todayIn(TZ);
  const rainDay = addDays(today, 1);
  const newDay = addDays(today, 3);
  let acme: TestOwner;
  let maria: TestCrew;
  let birch: TestOwner;
  let acmeNumber: string;
  let birchNumber: string;
  let delayId: string;
  let birchDelayId: string;
  const janePhone = randomNumber();
  const evePhone = randomNumber();
  let c: Record<"jane" | "bob" | "cara" | "dan" | "eve", { id: string }>;
  let birchJane: { id: string };

  const texts = async (client: Client, id: string) => client.rpc("rain_delay_texts", { rain_delay_id: id });
  const start = async (client: Client, id: string) => client.rpc("start_rain_delay_texts", { rain_delay_id: id });

  beforeAll(async () => {
    acme = await signUpOwner("sms-acme", "Acme Lawn Care", { time_zone: TZ });
    maria = await joinCrew(acme, "Maria");
    acmeNumber = await assignNumber(acme);
    c = {
      jane: await addCustomer(acme, { first_name: "Jane", last_name: "Adams", phone: typed(janePhone), sms_opt_in: true }),
      bob: await addCustomer(acme, { first_name: "Bob", last_name: "Baker", phone: typed(randomNumber()), sms_opt_in: false }),
      cara: await addCustomer(acme, { first_name: "Cara", last_name: "Cole", phone: "555-0142", sms_opt_in: true }),
      dan: await addCustomer(acme, { first_name: "Dan", last_name: "Diaz", phone: typed(randomNumber()), sms_opt_in: true }),
      eve: await addCustomer(acme, { first_name: "Eve", last_name: "Evans", phone: evePhone, sms_opt_in: true }),
    };
    for (const who of [c.jane, c.bob, c.cara, c.eve]) await visit(acme, who.id, rainDay);
    await visit(acme, c.eve.id, rainDay); // two visits that day: still one text
    await visit(acme, c.dan.id, addDays(rainDay, 1)); // not on the rain day: never texted
    const { data, error } = await moveDay(acme.client, rainDay, newDay);
    expect(error).toBeNull();
    delayId = data!;

    // Another business, with its own number and a customer who has Jane's phone number.
    birch = await signUpOwner("sms-birch", "Birch Tree Services", { time_zone: TZ });
    birchNumber = await assignNumber(birch);
    birchJane = await addCustomer(birch, { first_name: "Janet", phone: janePhone, sms_opt_in: true });
    await visit(birch, birchJane.id, rainDay);
    const moved = await moveDay(birch.client, rainDay, newDay);
    expect(moved.error).toBeNull();
    birchDelayId = moved.data!;
  });

  it("previews a personalized text for each opted-in customer, and says why the others won't get one", async () => {
    const { data, error } = await texts(acme.client, delayId);
    expect(error).toBeNull();
    const byName = Object.fromEntries(data!.map((row) => [row.first_name, row]));
    expect(Object.keys(byName).sort()).toEqual(["Bob", "Cara", "Eve", "Jane"]); // not Dan

    const moveText = "Due to the weather, we're moving your";
    expect(byName.Jane).toMatchObject({ can_text: true, reason: null, to_phone: janePhone, message_id: null, status: null });
    expect(byName.Jane.body).toMatch(new RegExp(`^Hi Jane, this is Acme Lawn Care\\. ${moveText} \\w{3}, \\w{3} \\d{1,2} visit to \\w{3}, \\w{3} \\d{1,2}\\. Thanks! Reply STOP to opt out\\.$`));
    expect(byName.Eve).toMatchObject({ can_text: true, to_phone: evePhone });
    expect(byName.Eve.body).toMatch(/^Hi Eve, this is Acme Lawn Care\./);
    expect(byName.Bob).toMatchObject({ can_text: false, reason: "not_opted_in", body: null });
    expect(byName.Cara).toMatchObject({ can_text: false, reason: "no_mobile_number", body: null, to_phone: null });
  });

  it("crew members, other businesses, and signed-out visitors can't preview or send", async () => {
    for (const client of [maria.client, birch.client]) {
      const preview = await texts(client, delayId);
      expect(preview.data).toBeNull();
      const send = await start(client, delayId);
      expect(send.data).toBeNull();
      expect([PERMISSION_DENIED, NOT_FOUND]).toContain(send.error?.code);
    }
    expect((await texts(maria.client, delayId)).error?.code).toBe(PERMISSION_DENIED);
    expect((await texts(birch.client, delayId)).error?.code).toBe(NOT_FOUND);
    expect((await start(anonClient(), delayId)).error?.code).toBe(PERMISSION_DENIED);
    // None of that created a text.
    expect((await acme.client.from("sms_messages").select("id")).data).toEqual([]);
  });

  it("sends one text per opted-in customer, from the business's own number", async () => {
    const { data, error } = await start(acme.client, delayId);
    expect(error).toBeNull();
    const byPhone = Object.fromEntries(data!.map((m) => [m.to_phone, m]));
    expect(Object.keys(byPhone).sort()).toEqual([janePhone, evePhone].sort());
    for (const m of data!) expect(m.from_phone).toBe(acmeNumber);
    expect(byPhone[janePhone].body).toMatch(/^Hi Jane, this is Acme Lawn Care\./);

    const { data: log } = await acme.client.from("sms_messages").select("customer_id, status, sent_by, business_id");
    expect(log!.map((m) => m.customer_id).sort()).toEqual([c.jane.id, c.eve.id].sort());
    for (const m of log!) expect(m).toMatchObject({ status: "sending", sent_by: acme.userId, business_id: acme.businessId });
  });

  it("never texts anyone twice, even if Send is pressed again", async () => {
    const { data, error } = await start(acme.client, delayId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("records what Twilio said, and a STOP-ed number opts the customer out", async () => {
    const { data: rows } = await acme.client.from("sms_messages").select("id, customer_id");
    const janeMsg = rows!.find((m) => m.customer_id === c.jane.id)!;
    const eveMsg = rows!.find((m) => m.customer_id === c.eve.id)!;

    const ok = await acme.client.rpc("record_sms_result", {
      message_id: janeMsg.id,
      twilio_sid: `SM${randomInt(1e9, 9e9)}`,
      twilio_status: "queued",
    });
    expect(ok.error).toBeNull();
    const stop = await acme.client.rpc("record_sms_result", {
      message_id: eveMsg.id,
      error_code: 21610,
      error_message: "Attempt to send to unsubscribed recipient",
    });
    expect(stop.error).toBeNull();

    const { data } = await texts(acme.client, delayId);
    const byName = Object.fromEntries(data!.map((row) => [row.first_name, row]));
    expect(byName.Jane).toMatchObject({ status: "queued", message_id: janeMsg.id });
    expect(byName.Eve).toMatchObject({ status: "failed", error_code: 21610, can_text: false, reason: "not_opted_in" });
    const { data: eve } = await acme.client.from("customers").select("sms_opt_in").eq("id", c.eve.id).single();
    expect(eve!.sms_opt_in).toBe(false);

    // A result can only be recorded once, while the text is being sent.
    const again = await acme.client.rpc("record_sms_result", {
      message_id: janeMsg.id,
      twilio_sid: "SMfake",
      twilio_status: "delivered",
    });
    expect(again.error?.code).toBe(NOT_FOUND);
  });

  it("doesn't retry a text to someone who has since opted out", async () => {
    // Eve's text failed, but she's opted out now, so Send again leaves her alone.
    const { data } = await start(acme.client, delayId);
    expect(data).toEqual([]);
  });

  it("retries a failed text to someone who is still opted in", async () => {
    const owner = await signUpOwner("sms-retry", "Retry Lawns", { time_zone: TZ });
    await assignNumber(owner);
    const phone = randomNumber();
    const customer = await addCustomer(owner, { first_name: "Rita", phone, sms_opt_in: true });
    await visit(owner, customer.id, rainDay);
    const { data: id } = await moveDay(owner.client, rainDay, newDay);

    const [first] = (await start(owner.client, id!)).data!;
    await owner.client.rpc("record_sms_result", {
      message_id: first.message_id,
      error_code: 20500,
      error_message: "Internal server error",
    });
    const { data: retried } = await start(owner.client, id!);
    expect(retried).toEqual([{ message_id: first.message_id, to_phone: phone, from_phone: first.from_phone, body: first.body }]);
  });

  it("never texts a customer who opted out after the preview", async () => {
    const owner = await signUpOwner("sms-late", "Late Lawns", { time_zone: TZ });
    await assignNumber(owner);
    const customer = await addCustomer(owner, { first_name: "Lou", phone: randomNumber(), sms_opt_in: true });
    await visit(owner, customer.id, rainDay);
    const { data: id } = await moveDay(owner.client, rainDay, newDay);
    expect((await texts(owner.client, id!)).data![0].can_text).toBe(true);

    await owner.client.from("customers").update({ sms_opt_in: false }).eq("id", customer.id);
    expect((await start(owner.client, id!)).data).toEqual([]);
  });

  it("two sends at the same moment still text each customer once", async () => {
    const owner = await signUpOwner("sms-race", "Race Lawns", { time_zone: TZ });
    await assignNumber(owner);
    for (const name of ["Ann", "Ben", "Cy"]) {
      const customer = await addCustomer(owner, { first_name: name, phone: randomNumber(), sms_opt_in: true });
      await visit(owner, customer.id, rainDay);
    }
    const { data: id } = await moveDay(owner.client, rainDay, newDay);
    const results = await Promise.all([start(owner.client, id!), start(owner.client, id!), start(owner.client, id!)]);
    const claimed = results.flatMap((r) => r.data ?? []);
    expect(claimed).toHaveLength(3);
    expect(new Set(claimed.map((m) => m.to_phone)).size).toBe(3);
  });

  it("won't send until the business has a texting number", async () => {
    const owner = await signUpOwner("sms-nonumber", "No Number Lawns", { time_zone: TZ });
    const customer = await addCustomer(owner, { first_name: "Nia", phone: randomNumber(), sms_opt_in: true });
    await visit(owner, customer.id, rainDay);
    const { data: id } = await moveDay(owner.client, rainDay, newDay);
    const { error } = await start(owner.client, id!);
    expect(error?.code).toBe(NOT_SET_UP);
    expect((await owner.client.from("sms_messages").select("id")).data).toEqual([]);
  });

  it("another business's texts go only to its own customers, from its own number", async () => {
    const { data } = await start(birch.client, birchDelayId);
    expect(data).toEqual([expect.objectContaining({ to_phone: janePhone, from_phone: birchNumber })]);
    expect(data![0].body).toMatch(/^Hi Janet, this is Birch Tree Services\./);

    // Each owner's log holds only their own texts.
    const { data: birchLog } = await birch.client.from("sms_messages").select("business_id, customer_id");
    expect(birchLog).toEqual([{ business_id: birch.businessId, customer_id: birchJane.id }]);
    const { data: acmeLog } = await acme.client.from("sms_messages").select("business_id");
    expect(acmeLog!.every((m) => m.business_id === acme.businessId)).toBe(true);
  });

  it("another business can't record results on this business's texts", async () => {
    const { data: rows } = await acme.client.from("sms_messages").select("id").limit(1);
    const { error } = await birch.client.rpc("record_sms_result", {
      message_id: rows![0].id,
      error_code: 21610,
      error_message: "x",
    });
    expect(error?.code).toBe(NOT_FOUND);
  });

  it("crew members and other businesses can't read the text log, and nobody can write it directly", async () => {
    expect((await maria.client.from("sms_messages").select("*")).data).toEqual([]);
    const { data: birchSees } = await birch.client.from("sms_messages").select("*").eq("business_id", acme.businessId);
    expect(birchSees).toEqual([]);
    expect((await anonClient().from("sms_messages").select("*")).error?.code).toBe(PERMISSION_DENIED);

    const { error: insertError } = await acme.client.from("sms_messages").insert({
      business_id: acme.businessId,
      rain_delay_id: delayId,
      to_phone: janePhone,
      from_phone: acmeNumber,
      body: "hi",
    });
    expect(insertError?.code).toBe(PERMISSION_DENIED);
    const { error: updateError } = await acme.client.from("sms_messages").update({ status: "delivered" }).eq("rain_delay_id", delayId);
    expect(updateError?.code).toBe(PERMISSION_DENIED);
  });
});

describe("Twilio webhooks", () => {
  const today = todayIn(TZ);
  let acme: TestOwner;
  let birch: TestOwner;
  let acmeNumber: string;
  let birchNumber: string;
  const phone = randomNumber();
  let acmeCustomer: { id: string };
  let birchCustomer: { id: string };
  let sid: string;

  const optedIn = async (owner: TestOwner, id: string) =>
    (await owner.client.from("customers").select("sms_opt_in").eq("id", id).single()).data!.sms_opt_in;
  const statusOf = async (owner: TestOwner, twilioSid: string) =>
    (await owner.client.from("sms_messages").select("status, error_code").eq("twilio_sid", twilioSid).single()).data!;

  beforeAll(async () => {
    acme = await signUpOwner("hook-acme", "Acme Lawn Care", { time_zone: TZ });
    birch = await signUpOwner("hook-birch", "Birch Tree Services", { time_zone: TZ });
    acmeNumber = await assignNumber(acme);
    birchNumber = await assignNumber(birch);
    // The same person is a customer of both businesses.
    acmeCustomer = await addCustomer(acme, { first_name: "Sam", phone: typed(phone), sms_opt_in: true });
    birchCustomer = await addCustomer(birch, { first_name: "Sam", phone, sms_opt_in: true });

    await visit(acme, acmeCustomer.id, addDays(today, 1));
    const { data: id } = await moveDay(acme.client, addDays(today, 1), addDays(today, 2));
    const [msg] = (await acme.client.rpc("start_rain_delay_texts", { rain_delay_id: id! })).data!;
    sid = `SM${randomInt(1e9, 9e9)}${randomInt(1e9, 9e9)}`;
    await acme.client.rpc("record_sms_result", {
      message_id: msg.message_id,
      twilio_sid: sid,
      twilio_status: "queued",
    });
  });

  it("only the server (service role) can call them — not owners, crew, or visitors", async () => {
    for (const client of [acme.client, anonClient()]) {
      const optOut = await client.rpc("twilio_opt_out", { to_number: acmeNumber, from_number: phone });
      expect(optOut.error?.code).toBe(PERMISSION_DENIED);
      const status = await client.rpc("twilio_message_status", {
        message_sid: sid,
        message_status: "failed",
        error_code: 21610,
      });
      expect(status.error?.code).toBe(PERMISSION_DENIED);
    }
    expect(await optedIn(acme, acmeCustomer.id)).toBe(true);
    expect(await statusOf(acme, sid)).toEqual({ status: "queued", error_code: null });
  });

  it("delivery updates move a text forward, never backward", async () => {
    const admin = adminClient();
    await admin.rpc("twilio_message_status", { message_sid: sid, message_status: "delivered" });
    expect(await statusOf(acme, sid)).toEqual({ status: "delivered", error_code: null });
    // A late "sent" arriving after "delivered" changes nothing.
    await admin.rpc("twilio_message_status", { message_sid: sid, message_status: "sent" });
    expect((await statusOf(acme, sid)).status).toBe("delivered");
    // An unknown SID changes nothing anywhere.
    const { error } = await admin.rpc("twilio_message_status", {
      message_sid: "SMnotours",
      message_status: "failed",
      error_code: 30007,
    });
    expect(error).toBeNull();
  });

  it("a STOP reply opts the customer out of that business only", async () => {
    const admin = adminClient();
    const { data: changed } = await admin.rpc("twilio_opt_out", { to_number: acmeNumber, from_number: phone });
    expect(changed).toBe(1);
    expect(await optedIn(acme, acmeCustomer.id)).toBe(false);
    // The same person, as Birch's customer, still gets Birch's texts.
    expect(await optedIn(birch, birchCustomer.id)).toBe(true);

    const { data: birchChanged } = await admin.rpc("twilio_opt_out", { to_number: birchNumber, from_number: phone });
    expect(birchChanged).toBe(1);
    expect(await optedIn(birch, birchCustomer.id)).toBe(false);
  });

  it("a STOP to a number that isn't any business's changes nothing", async () => {
    const other = await signUpOwner("hook-other", "Other Lawns", { time_zone: TZ });
    const customer = await addCustomer(other, { phone, sms_opt_in: true });
    const { data } = await adminClient().rpc("twilio_opt_out", { to_number: randomNumber(), from_number: phone });
    expect(data).toBe(0);
    expect(await optedIn(other, customer.id)).toBe(true);
  });
});
