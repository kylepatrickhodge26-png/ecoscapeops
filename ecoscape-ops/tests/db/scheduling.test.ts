// Scheduling rules enforced by the database: visit generation, keeping 6 visits ahead,
// stopping a service, and tenant isolation for service plans and jobs.
import { beforeAll, describe, expect, it } from "vitest";

import {
  addCustomer,
  addDays,
  adminClient,
  anonClient,
  bookService,
  signUp,
  signUpOwner,
  todayIn,
  visitsFor,
  type TestOwner,
} from "./helpers";

const PERMISSION_DENIED = "42501";
const FOREIGN_KEY_VIOLATION = "23503";

const dates = (visits: { scheduled_date: string }[]) => visits.map((v) => v.scheduled_date);
const openVisits = (visits: { status: string }[]) =>
  visits.filter((v) => v.status !== "completed" && v.status !== "cancelled");

describe("business time zone", () => {
  it("comes from the browser at signup", async () => {
    const owner = await signUpOwner("tz", "Pacific Lawns", { time_zone: "America/Los_Angeles" });
    const { data } = await owner.client.from("businesses").select("time_zone").single();
    expect(data!.time_zone).toBe("America/Los_Angeles");
  });

  it("falls back to America/New_York when missing or unknown", async () => {
    const unknown = await signUpOwner("tz-bad", "Mystery Lawns", { time_zone: "Mars/Olympus_Mons" });
    const missing = await signUpOwner("tz-none", "Default Lawns");
    for (const owner of [unknown, missing]) {
      const { data } = await owner.client.from("businesses").select("time_zone").single();
      expect(data!.time_zone).toBe("America/New_York");
    }
  });

  it("can't be changed by the owner through the API", async () => {
    const owner = await signUpOwner("tz-edit", "Fixed Zone Co");
    const { error } = await owner.client
      .from("businesses")
      .update({ time_zone: "Asia/Tokyo" })
      .eq("id", owner.businessId);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("booking a service", () => {
  let owner: TestOwner;
  let customerId: string;

  beforeAll(async () => {
    owner = await signUpOwner("booking", "Booking Lawns");
    customerId = (await addCustomer(owner, { first_name: "John", last_name: "Smith" })).id;
  });

  it.each([
    ["weekly", ["2030-03-05", "2030-03-12", "2030-03-19", "2030-03-26", "2030-04-02", "2030-04-09"]],
    ["biweekly", ["2030-03-05", "2030-03-19", "2030-04-02", "2030-04-16", "2030-04-30", "2030-05-14"]],
    ["triweekly", ["2030-03-05", "2030-03-26", "2030-04-16", "2030-05-07", "2030-05-28", "2030-06-18"]],
  ] as const)("%s creates the next 6 visits", async (frequency, expected) => {
    const plan = await bookService(owner, customerId, { frequency, service_name: "Mowing", price: 65 });
    const visits = await visitsFor(owner, plan.id);
    expect(dates(visits)).toEqual(expected);
    for (const visit of visits) {
      expect(visit).toMatchObject({
        business_id: owner.businessId,
        customer_id: customerId,
        service_name: "Mowing",
        price: 65,
        status: "scheduled",
        completed_at: null,
      });
    }
  });

  it("one-time creates exactly 1 visit", async () => {
    const plan = await bookService(owner, customerId, { frequency: "one_time", start_date: "2030-07-01" });
    expect(dates(await visitsFor(owner, plan.id))).toEqual(["2030-07-01"]);
    const { data } = await owner.client.from("service_plans").select("next_visit_date").eq("id", plan.id).single();
    expect(data!.next_visit_date).toBeNull();
  });

  it("always starts a new plan active at its start date, whatever the client sends", async () => {
    const plan = await bookService(owner, customerId, {
      start_date: "2030-08-06",
      active: false,
      next_visit_date: "2099-01-01",
    });
    expect(plan.active).toBe(true);
    expect(dates(await visitsFor(owner, plan.id))[0]).toBe("2030-08-06");
  });

  it.each([
    ["an empty service name", { service_name: " " }],
    ["a negative price", { price: -1 }],
    ["an enormous price", { price: 100000 }],
  ])("rejects %s", async (_label, fields) => {
    const { error } = await owner.client
      .from("service_plans")
      .insert({
        business_id: owner.businessId,
        customer_id: customerId,
        service_name: "Mowing",
        price: 65,
        frequency: "weekly",
        start_date: "2030-03-05",
        ...fields,
      });
    expect(error?.code).toBe("23514");
  });
});

describe("keeping 6 visits ahead", () => {
  let owner: TestOwner;
  let customerId: string;

  beforeAll(async () => {
    owner = await signUpOwner("ahead", "Always Ahead Lawns");
    customerId = (await addCustomer(owner)).id;
  });

  const setStatus = async (jobId: string, status: "completed" | "cancelled" | "scheduled" | "weather_delay") => {
    const { error } = await owner.client.from("jobs").update({ status }).eq("id", jobId);
    expect(error).toBeNull();
  };

  it("adds the next visit in the cadence when one is completed or cancelled", async () => {
    const plan = await bookService(owner, customerId);
    let visits = await visitsFor(owner, plan.id);

    await setStatus(visits[0].id, "completed");
    visits = await visitsFor(owner, plan.id);
    expect(visits).toHaveLength(7);
    expect(openVisits(visits)).toHaveLength(6);
    expect(visits.at(-1)!.scheduled_date).toBe("2030-04-16");

    await setStatus(visits[1].id, "cancelled");
    visits = await visitsFor(owner, plan.id);
    expect(openVisits(visits)).toHaveLength(6);
    expect(visits.at(-1)!.scheduled_date).toBe("2030-04-23");
  });

  it("doesn't let a rescheduled visit shift the rest of the cadence", async () => {
    const plan = await bookService(owner, customerId);
    let visits = await visitsFor(owner, plan.id);

    // The last visit moves a day later, then another visit is completed.
    await owner.client.from("jobs").update({ scheduled_date: "2030-04-10" }).eq("id", visits[5].id);
    await setStatus(visits[0].id, "completed");

    visits = await visitsFor(owner, plan.id);
    expect(dates(visits).at(-1)).toBe("2030-04-16"); // still on the Tuesday cadence
  });

  it("doesn't pile up extra visits when a visit is reopened and completed again", async () => {
    const plan = await bookService(owner, customerId);
    const first = (await visitsFor(owner, plan.id))[0];

    await setStatus(first.id, "completed");
    await setStatus(first.id, "scheduled");
    await setStatus(first.id, "completed");

    const visits = await visitsFor(owner, plan.id);
    expect(visits).toHaveLength(7);
    expect(openVisits(visits)).toHaveLength(6);
  });

  it("doesn't add visits for other status changes", async () => {
    const plan = await bookService(owner, customerId);
    const first = (await visitsFor(owner, plan.id))[0];
    await setStatus(first.id, "weather_delay");
    expect(await visitsFor(owner, plan.id)).toHaveLength(6);
  });

  it("never adds a second visit to a one-time booking", async () => {
    const plan = await bookService(owner, customerId, { frequency: "one_time" });
    const [only] = await visitsFor(owner, plan.id);
    await setStatus(only.id, "completed");
    expect(await visitsFor(owner, plan.id)).toHaveLength(1);
  });

  it("records when a visit was completed, and clears it if reopened", async () => {
    const plan = await bookService(owner, customerId, { frequency: "one_time" });
    const [visit] = await visitsFor(owner, plan.id);

    await setStatus(visit.id, "completed");
    const completed = (await visitsFor(owner, plan.id))[0];
    expect(completed.completed_at).not.toBeNull();

    await setStatus(visit.id, "scheduled");
    expect((await visitsFor(owner, plan.id))[0].completed_at).toBeNull();
  });
});

describe("stopping a service", () => {
  let owner: TestOwner;
  let customerId: string;
  const today = todayIn("America/New_York");

  beforeAll(async () => {
    owner = await signUpOwner("stop", "Season End Lawns", { time_zone: "America/New_York" });
    customerId = (await addCustomer(owner)).id;
  });

  it("removes upcoming visits that haven't started and stops adding new ones", async () => {
    // Started two weeks ago: two past visits, today's, and three future ones.
    const plan = await bookService(owner, customerId, { start_date: addDays(today, -14) });
    let visits = await visitsFor(owner, plan.id);
    await owner.client.from("jobs").update({ status: "completed" }).eq("id", visits[0].id);
    visits = await visitsFor(owner, plan.id); // now 7 visits (one added)
    const weatherDelayed = visits[4];
    await owner.client.from("jobs").update({ status: "weather_delay" }).eq("id", weatherDelayed.id);

    const { data: removed, error } = await owner.client.rpc("stop_service_plan", { plan_id: plan.id });
    expect(error).toBeNull();

    visits = await visitsFor(owner, plan.id);
    // Kept: the completed and the missed past visits, plus the weather-delayed one.
    expect(dates(visits)).toEqual([addDays(today, -14), addDays(today, -7), weatherDelayed.scheduled_date]);
    expect(removed).toBe(4);

    const { data: stopped } = await owner.client
      .from("service_plans")
      .select("active, next_visit_date")
      .eq("id", plan.id)
      .single();
    expect(stopped).toEqual({ active: false, next_visit_date: null });

    // Closing out a remaining visit adds nothing now.
    await owner.client.from("jobs").update({ status: "completed" }).eq("id", visits[1].id);
    expect(await visitsFor(owner, plan.id)).toHaveLength(3);
  });

  it("reports an unknown plan as not found", async () => {
    const { error } = await owner.client.rpc("stop_service_plan", {
      plan_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(error?.code).toBe("P0002");
  });
});

describe("scheduling tenant isolation", () => {
  let acme: TestOwner;
  let birch: TestOwner;
  let acmeCustomerId: string;
  let acmePlanId: string;
  let acmeJobId: string;
  let birchCustomerId: string;

  beforeAll(async () => {
    acme = await signUpOwner("acme-s", "Acme Lawn Care");
    birch = await signUpOwner("birch-s", "Birch Tree Services");
    acmeCustomerId = (await addCustomer(acme, { first_name: "Secret" })).id;
    birchCustomerId = (await addCustomer(birch)).id;
    acmePlanId = (await bookService(acme, acmeCustomerId)).id;
    acmeJobId = (await visitsFor(acme, acmePlanId))[0].id;
    await bookService(birch, birchCustomerId);
  });

  it("another business can't see service plans or visits", async () => {
    const { data: plans } = await birch.client.from("service_plans").select("business_id");
    expect(plans!.every((p) => p.business_id === birch.businessId)).toBe(true);
    expect(plans).toHaveLength(1);

    const { data: jobs } = await birch.client.from("jobs").select("id").eq("service_plan_id", acmePlanId);
    expect(jobs).toEqual([]);
    const { data: byId } = await birch.client.from("jobs").select("id").eq("id", acmeJobId);
    expect(byId).toEqual([]);
  });

  it("another business can't change, complete, or delete a visit", async () => {
    const { data: updated } = await birch.client
      .from("jobs")
      .update({ status: "completed", scheduled_date: "2030-12-25" })
      .eq("id", acmeJobId)
      .select();
    expect(updated).toEqual([]);
    const { data: deleted } = await birch.client.from("jobs").delete().eq("id", acmeJobId).select();
    expect(deleted).toEqual([]);

    const [first] = await visitsFor(acme, acmePlanId);
    expect(first).toMatchObject({ id: acmeJobId, status: "scheduled", scheduled_date: "2030-03-05" });
  });

  it("another business can't stop a service", async () => {
    const { error } = await birch.client.rpc("stop_service_plan", { plan_id: acmePlanId });
    expect(error?.code).toBe("P0002");
    expect(openVisits(await visitsFor(acme, acmePlanId))).toHaveLength(6);
  });

  it("can't book a service in another business, or for another business's customer", async () => {
    const { error: intoAcme } = await birch.client.from("service_plans").insert({
      business_id: acme.businessId,
      customer_id: acmeCustomerId,
      service_name: "Planted",
      price: 1,
      frequency: "weekly",
      start_date: "2030-03-05",
    });
    expect(intoAcme?.code).toBe(PERMISSION_DENIED);

    const { error: acmeCustomer } = await birch.client.from("service_plans").insert({
      business_id: birch.businessId,
      customer_id: acmeCustomerId,
      service_name: "Poached",
      price: 1,
      frequency: "weekly",
      start_date: "2030-03-05",
    });
    expect(acmeCustomer?.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("can't attach a visit to another business's plan or customer", async () => {
    const { error } = await birch.client.from("jobs").insert({
      business_id: birch.businessId,
      customer_id: birchCustomerId,
      service_plan_id: acmePlanId,
      service_name: "Sneaky",
      price: 1,
      scheduled_date: "2030-03-05",
    });
    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("a visit can't be moved to another business", async () => {
    const { error } = await acme.client.from("jobs").update({ business_id: birch.businessId }).eq("id", acmeJobId);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("signed-out visitors and crew members get nothing", async () => {
    const anon = anonClient();
    for (const table of ["service_plans", "jobs"] as const) {
      const { error } = await anon.from(table).select("id");
      expect(error?.code, table).toBe(PERMISSION_DENIED);
    }
    const { error: anonStop } = await anon.rpc("stop_service_plan", { plan_id: acmePlanId });
    expect(anonStop).not.toBeNull();

    const crew = await signUp("crew-s");
    await adminClient()
      .from("business_members")
      .insert({ business_id: acme.businessId, user_id: crew.userId, role: "crew" });
    const { data: crewJobs } = await crew.client.from("jobs").select("id");
    expect(crewJobs).toEqual([]);
    const { data: crewPlans } = await crew.client.from("service_plans").select("id");
    expect(crewPlans).toEqual([]);
    const { error: crewStop } = await crew.client.rpc("stop_service_plan", { plan_id: acmePlanId });
    expect(crewStop?.code).toBe("P0002");
  });

  it("deleting a customer deletes their services and visits", async () => {
    const customer = await addCustomer(acme, { first_name: "Leaving" });
    const plan = await bookService(acme, customer.id);
    await acme.client.from("customers").delete().eq("id", customer.id);

    const { data: plans } = await acme.client.from("service_plans").select("id").eq("id", plan.id);
    expect(plans).toEqual([]);
    const { count } = await adminClient()
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("service_plan_id", plan.id);
    expect(count).toBe(0);
  });
});
