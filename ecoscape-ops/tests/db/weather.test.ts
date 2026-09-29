// Weather: each business's service area, moving a rain day's visits, and the texts
// prepared for the affected customers. Checks that only opted-in customers ever get a
// text, and that one business's settings, visits and texts never touch another's.
import { randomInt, randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
  addCustomer,
  addDays,
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
const INVALID_PARAMETER = "22023";
const NOT_FOUND = "P0002";
const TZ = "America/New_York";

// A random US number.
const randomNumber = () => `+1${randomInt(200, 999)}${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
// The same number the way someone might type it on a customer record.
const typed = (e164: string) => `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;

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

describe("texts for a rain delay", () => {
  const today = todayIn(TZ);
  const rainDay = addDays(today, 1);
  const newDay = addDays(today, 3);
  let acme: TestOwner;
  let maria: TestCrew;
  let birch: TestOwner;
  let delayId: string;
  let birchDelayId: string;
  const janePhone = randomNumber();
  const evePhone = randomNumber();
  let c: Record<"jane" | "bob" | "cara" | "dan" | "eve", { id: string }>;
  let birchJanet: { id: string };

  const texts = async (client: Client, id: string) => client.rpc("rain_delay_texts", { rain_delay_id: id });
  const mark = async (client: Client, id: string, customerId: string) =>
    client.rpc("mark_weather_text_opened", { rain_delay_id: id, customer_id: customerId });
  const openedLog = async (owner: TestOwner) =>
    (await owner.client.from("weather_texts").select("rain_delay_id, customer_id, business_id, opened_by")).data!;

  beforeAll(async () => {
    acme = await signUpOwner("wt-acme", "Acme Lawn Care", { time_zone: TZ });
    maria = await joinCrew(acme, "Maria");
    c = {
      jane: await addCustomer(acme, { first_name: "Jane", last_name: "Adams", phone: typed(janePhone), sms_opt_in: true }),
      bob: await addCustomer(acme, { first_name: "Bob", last_name: "Baker", phone: typed(randomNumber()), sms_opt_in: false }),
      cara: await addCustomer(acme, { first_name: "Cara", last_name: "Cole", phone: "555-0142", sms_opt_in: true }),
      dan: await addCustomer(acme, { first_name: "Dan", last_name: "Diaz", phone: typed(randomNumber()), sms_opt_in: true }),
      eve: await addCustomer(acme, { first_name: "Eve", last_name: "Evans", phone: evePhone, sms_opt_in: true }),
    };
    for (const who of [c.jane, c.bob, c.cara, c.eve]) await visit(acme, who.id, rainDay);
    await visit(acme, c.eve.id, rainDay); // two visits that day: still one text
    await visit(acme, c.dan.id, addDays(rainDay, 1)); // not on the rain day: no text
    const { data, error } = await moveDay(acme.client, rainDay, newDay);
    expect(error).toBeNull();
    delayId = data!;

    // Another business, with a customer who has Jane's phone number.
    birch = await signUpOwner("wt-birch", "Birch Tree Services", { time_zone: TZ });
    birchJanet = await addCustomer(birch, { first_name: "Janet", phone: janePhone, sms_opt_in: true });
    await visit(birch, birchJanet.id, rainDay);
    const moved = await moveDay(birch.client, rainDay, newDay);
    expect(moved.error).toBeNull();
    birchDelayId = moved.data!;
  });

  it("prepares a personalized text for each opted-in customer, and says why the others won't get one", async () => {
    const { data, error } = await texts(acme.client, delayId);
    expect(error).toBeNull();
    const byName = Object.fromEntries(data!.map((row) => [row.first_name, row]));
    expect(Object.keys(byName).sort()).toEqual(["Bob", "Cara", "Eve", "Jane"]); // not Dan, and Eve once

    expect(byName.Jane).toMatchObject({ can_text: true, reason: null, to_phone: janePhone, opened_at: null });
    expect(byName.Jane.body).toMatch(
      /^Hi Jane, this is Acme Lawn Care\. Due to the weather, we're moving your \w{3}, \w{3} \d{1,2} visit to \w{3}, \w{3} \d{1,2}\. Thanks! Reply STOP to opt out\.$/,
    );
    expect(byName.Eve).toMatchObject({ can_text: true, to_phone: evePhone });
    expect(byName.Eve.body).toMatch(/^Hi Eve, this is Acme Lawn Care\./);
    // No message at all for customers who can't be texted.
    expect(byName.Bob).toMatchObject({ can_text: false, reason: "not_opted_in", body: null });
    expect(byName.Cara).toMatchObject({ can_text: false, reason: "no_mobile_number", body: null, to_phone: null });
  });

  it("the owner can mark a text as opened, and opening it again keeps the first time", async () => {
    const { data: first, error } = await mark(acme.client, delayId, c.jane.id);
    expect(error).toBeNull();
    expect(first).not.toBeNull();
    const { data: again } = await mark(acme.client, delayId, c.jane.id);
    expect(again).toBe(first);

    const { data } = await texts(acme.client, delayId);
    expect(data!.find((r) => r.first_name === "Jane")!.opened_at).toBe(first);
    expect(await openedLog(acme)).toEqual([
      { rain_delay_id: delayId, customer_id: c.jane.id, business_id: acme.businessId, opened_by: acme.userId },
    ]);
  });

  it("refuses to mark a text for anyone who can't be texted", async () => {
    for (const who of [c.bob, c.cara, c.dan, { id: randomUUID() }]) {
      const { error } = await mark(acme.client, delayId, who.id);
      expect(error?.code).toBe(PERMISSION_DENIED);
    }
    expect((await openedLog(acme)).map((r) => r.customer_id)).toEqual([c.jane.id]);
  });

  it("a customer who opts out after the text was prepared gets no text", async () => {
    await acme.client.from("customers").update({ sms_opt_in: false }).eq("id", c.eve.id);
    const { data } = await texts(acme.client, delayId);
    expect(data!.find((r) => r.first_name === "Eve")).toMatchObject({ can_text: false, reason: "not_opted_in", body: null });
    const { error } = await mark(acme.client, delayId, c.eve.id);
    expect(error?.code).toBe(PERMISSION_DENIED);
    await acme.client.from("customers").update({ sms_opt_in: true }).eq("id", c.eve.id);
  });

  it("crew members, other businesses, and signed-out visitors can't see or mark this business's texts", async () => {
    expect((await texts(maria.client, delayId)).error?.code).toBe(PERMISSION_DENIED);
    expect((await mark(maria.client, delayId, c.eve.id)).error?.code).toBe(PERMISSION_DENIED);
    expect((await texts(birch.client, delayId)).error?.code).toBe(NOT_FOUND);
    expect((await mark(birch.client, delayId, c.eve.id)).error?.code).toBe(NOT_FOUND);
    // Nor by pointing their own rain delay at this business's customer.
    expect((await mark(birch.client, birchDelayId, c.eve.id)).error?.code).toBe(PERMISSION_DENIED);
    expect((await texts(anonClient(), delayId)).error?.code).toBe(PERMISSION_DENIED);
    expect((await mark(anonClient(), delayId, c.eve.id)).error?.code).toBe(PERMISSION_DENIED);

    expect((await maria.client.from("weather_texts").select("*")).data).toEqual([]);
    expect((await birch.client.from("weather_texts").select("*").eq("business_id", acme.businessId)).data).toEqual([]);
    expect((await anonClient().from("weather_texts").select("*")).error?.code).toBe(PERMISSION_DENIED);
    expect((await openedLog(acme)).map((r) => r.customer_id)).toEqual([c.jane.id]);
  });

  it("another business's texts are its own: its customers, in its name", async () => {
    const { data } = await texts(birch.client, birchDelayId);
    expect(data).toEqual([expect.objectContaining({ customer_id: birchJanet.id, to_phone: janePhone, can_text: true })]);
    expect(data![0].body).toMatch(/^Hi Janet, this is Birch Tree Services\./);

    await mark(birch.client, birchDelayId, birchJanet.id);
    expect(await openedLog(birch)).toEqual([
      { rain_delay_id: birchDelayId, customer_id: birchJanet.id, business_id: birch.businessId, opened_by: birch.userId },
    ]);
    // Acme's log is unchanged.
    expect((await openedLog(acme)).map((r) => r.customer_id)).toEqual([c.jane.id]);
  });

  it("nobody can write the texts log directly", async () => {
    const { error: insertError } = await acme.client
      .from("weather_texts")
      .insert({ rain_delay_id: delayId, customer_id: c.bob.id, business_id: acme.businessId });
    expect(insertError?.code).toBe(PERMISSION_DENIED);
    const { error: updateError } = await acme.client
      .from("weather_texts")
      .update({ opened_at: new Date().toISOString() })
      .eq("rain_delay_id", delayId);
    expect(updateError?.code).toBe(PERMISSION_DENIED);
    const { error: deleteError } = await acme.client.from("weather_texts").delete().eq("rain_delay_id", delayId);
    expect(deleteError?.code).toBe(PERMISSION_DENIED);
  });
});
