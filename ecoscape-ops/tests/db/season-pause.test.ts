// Done for the season: marking a customer inactive takes their upcoming repeat visits off the
// schedule (one-time jobs, visits under way and history stay) and pauses their repeat
// services; repeat bookings made while they're inactive wait; marking them active brings the
// visits back on their regular day. Only the owner can do it, and nothing crosses businesses.
import { beforeAll, describe, expect, it } from "vitest";

import { addCustomer, addDays, anonClient, bookService, joinCrew, signUpOwner, todayIn, type TestCrew, type TestOwner } from "./helpers";

const TZ = "America/New_York";
const today = todayIn(TZ);
const day = (n: number) => addDays(today, n);

type Visit = { id: string; scheduled_date: string; status: string; assigned_crew_member_id: string | null };
const visitsOf = async (owner: TestOwner, planId: string) =>
  (await owner.client.from("jobs").select("id, scheduled_date, status, assigned_crew_member_id").eq("service_plan_id", planId).order("scheduled_date").order("status"))
    .data as Visit[];
const upcomingDates = async (owner: TestOwner, planId: string) =>
  (await visitsOf(owner, planId)).filter((v) => v.scheduled_date >= today && v.status !== "completed" && v.status !== "cancelled").map((v) => v.scheduled_date);
const planOf = async (owner: TestOwner, planId: string) =>
  (await owner.client.from("service_plans").select("active, paused, next_visit_date").eq("id", planId).single()).data!;
const setStatus = (owner: TestOwner, customerId: string, status: "active" | "inactive") =>
  owner.client.from("customers").update({ status }).eq("id", customerId).select("id");
const plusWeeks = (start: number, step: number, count: number) => Array.from({ length: count }, (_, i) => day(start + i * step));

describe("done for the season", () => {
  let alpha: TestOwner;
  let bravo: TestOwner;
  let crew: TestCrew;
  let alice: string;
  let bob: string;
  let cara: string;
  let zed: string;
  const plan: Record<string, string> = {};

  beforeAll(async () => {
    alpha = await signUpOwner("season-alpha", "Alpha Lawn", { time_zone: TZ });
    bravo = await signUpOwner("season-bravo", "Bravo Lawn", { time_zone: TZ });
    crew = await joinCrew(alpha, "Casey");
    alice = (await addCustomer(alpha, { first_name: "Alice" })).id;
    bob = (await addCustomer(alpha, { first_name: "Bob" })).id;
    cara = (await addCustomer(alpha, { first_name: "Cara" })).id;
    zed = (await addCustomer(bravo, { first_name: "Zed" })).id;

    plan.mowing = (await bookService(alpha, alice, { frequency: "weekly", start_date: today, service_name: "Mowing", assigned_crew_member_id: crew.crewMemberId })).id;
    plan.edging = (await bookService(alpha, alice, { frequency: "biweekly", start_date: day(3), service_name: "Edging" })).id;
    plan.cleanup = (await bookService(alpha, alice, { frequency: "one_time", start_date: day(10), service_name: "Fall cleanup" })).id;
    plan.leaves = (await bookService(alpha, alice, { frequency: "weekly", start_date: day(-14), service_name: "Leaves" })).id;
    plan.bob = (await bookService(alpha, bob, { frequency: "weekly", start_date: today, service_name: "Mowing" })).id;
    plan.cara = (await bookService(alpha, cara, { frequency: "weekly", start_date: day(1), service_name: "Mowing" })).id;
    plan.zed = (await bookService(bravo, zed, { frequency: "weekly", start_date: today, service_name: "Mowing" })).id;

    // Today's mow is under way; two weeks ago's leaves were done, last week's never were.
    const mowing = await visitsOf(alpha, plan.mowing);
    expect((await alpha.client.from("jobs").update({ status: "in_progress" }).eq("id", mowing[0].id)).error).toBeNull();
    const leaves = await visitsOf(alpha, plan.leaves);
    expect((await alpha.client.from("jobs").update({ status: "completed" }).eq("id", leaves[0].id)).error).toBeNull();
  });

  it("only lets the owner mark a customer inactive", async () => {
    expect((await setStatus(crew as unknown as TestOwner, bob, "inactive")).data ?? []).toEqual([]);
    expect((await setStatus(bravo, bob, "inactive")).data).toEqual([]);
    expect((await anonClient().from("customers").update({ status: "inactive" }).eq("id", bob)).error).not.toBeNull();
    expect(await upcomingDates(alpha, plan.bob)).toEqual(plusWeeks(0, 7, 6));
  });

  it("takes upcoming repeat visits off and keeps one-time jobs, visits under way and history", async () => {
    expect((await setStatus(alpha, alice, "inactive")).data).toHaveLength(1);

    expect((await visitsOf(alpha, plan.mowing)).map((v) => [v.scheduled_date, v.status])).toEqual([[today, "in_progress"]]);
    expect(await visitsOf(alpha, plan.edging)).toEqual([]);
    expect((await visitsOf(alpha, plan.cleanup)).map((v) => [v.scheduled_date, v.status])).toEqual([[day(10), "scheduled"]]);
    expect((await visitsOf(alpha, plan.leaves)).map((v) => [v.scheduled_date, v.status])).toEqual([
      [day(-14), "completed"],
      [day(-7), "scheduled"],
    ]);
    for (const p of [plan.mowing, plan.edging, plan.leaves]) expect(await planOf(alpha, p)).toMatchObject({ active: true, paused: true });
    expect(await planOf(alpha, plan.cleanup)).toMatchObject({ paused: false });

    // Finishing the mow under way doesn't bring visits back.
    const [underWay] = await visitsOf(alpha, plan.mowing);
    expect((await alpha.client.from("jobs").update({ status: "completed" }).eq("id", underWay.id)).error).toBeNull();
    expect(await upcomingDates(alpha, plan.mowing)).toEqual([]);

    // Other customers and other businesses are untouched.
    expect(await upcomingDates(alpha, plan.bob)).toEqual(plusWeeks(0, 7, 6));
    expect(await upcomingDates(bravo, plan.zed)).toEqual(plusWeeks(0, 7, 6));
  });

  it("keeps repeat services paused while inactive: new bookings wait, one-time jobs book", async () => {
    plan.aeration = (await bookService(alpha, alice, { frequency: "weekly", start_date: day(1), service_name: "Aeration" })).id;
    plan.spring = (await bookService(alpha, alice, { frequency: "weekly", start_date: day(30), service_name: "Spring mowing" })).id;
    plan.gutter = (await bookService(alpha, alice, { frequency: "one_time", start_date: day(5), service_name: "Gutters" })).id;
    expect(await visitsOf(alpha, plan.aeration)).toEqual([]);
    expect(await planOf(alpha, plan.aeration)).toMatchObject({ paused: true });
    expect((await visitsOf(alpha, plan.gutter)).map((v) => v.scheduled_date)).toEqual([day(5)]);

    // Unpausing by hand doesn't work: the database keeps it paused while the customer is inactive.
    expect((await alpha.client.from("service_plans").update({ paused: false }).eq("id", plan.aeration)).error).toBeNull();
    expect(await planOf(alpha, plan.aeration)).toMatchObject({ paused: true });
    expect(await visitsOf(alpha, plan.aeration)).toEqual([]);

    // A service stopped while paused stays stopped.
    expect((await alpha.client.rpc("stop_service_plan", { plan_id: plan.edging })).error).toBeNull();
  });

  it("brings visits back on their regular day when marked active", async () => {
    expect((await setStatus(alpha, alice, "active")).data).toHaveLength(1);

    // Today's mow was done, so the next one is a week out; same crew member as before.
    const mowing = await visitsOf(alpha, plan.mowing);
    expect(await upcomingDates(alpha, plan.mowing)).toEqual(plusWeeks(7, 7, 6));
    expect(mowing.filter((v) => v.status === "scheduled" || v.status === "assigned").every((v) => v.assigned_crew_member_id === crew.crewMemberId)).toBe(true);
    // Last week's missed leaves still count as open, so 5 more are added, from today.
    expect(await upcomingDates(alpha, plan.leaves)).toEqual(plusWeeks(0, 7, 5));
    // Booked while inactive: from their first visit date.
    expect(await upcomingDates(alpha, plan.aeration)).toEqual(plusWeeks(1, 7, 6));
    expect(await upcomingDates(alpha, plan.spring)).toEqual(plusWeeks(30, 7, 6));
    // Stopped stays stopped; one-time jobs are as they were.
    expect(await visitsOf(alpha, plan.edging)).toEqual([]);
    expect(await planOf(alpha, plan.edging)).toMatchObject({ active: false, next_visit_date: null });
    expect((await visitsOf(alpha, plan.cleanup)).map((v) => v.scheduled_date)).toEqual([day(10)]);
    for (const p of [plan.mowing, plan.leaves, plan.aeration]) expect(await planOf(alpha, p)).toMatchObject({ paused: false });

    // Marking active again changes nothing.
    expect((await setStatus(alpha, alice, "active")).error).toBeNull();
    expect(await upcomingDates(alpha, plan.mowing)).toEqual(plusWeeks(7, 7, 6));
  });

  it("keeps an every-2-weeks service on its own weeks, and a moved regular day", async () => {
    const edging = (await bookService(alpha, cara, { frequency: "biweekly", start_date: day(4), service_name: "Edging" })).id;
    // Cara's mowing moved from day 1 to day 3, later visits too: day 3 is her regular day now.
    const [first] = await visitsOf(alpha, plan.cara);
    expect((await alpha.client.rpc("move_visits", { job_ids: [first.id], new_date: day(3), move_later: true })).error).toBeNull();
    expect(await upcomingDates(alpha, plan.cara)).toEqual(plusWeeks(3, 7, 6));

    expect((await setStatus(alpha, cara, "inactive")).error).toBeNull();
    expect(await upcomingDates(alpha, plan.cara)).toEqual([]);
    expect(await upcomingDates(alpha, edging)).toEqual([]);
    expect((await setStatus(alpha, cara, "active")).error).toBeNull();
    expect(await upcomingDates(alpha, plan.cara)).toEqual(plusWeeks(3, 7, 6));
    expect(await upcomingDates(alpha, edging)).toEqual(plusWeeks(4, 14, 6));
  });

  it("works per business: another owner pausing their customer touches nothing of yours", async () => {
    expect((await setStatus(bravo, zed, "inactive")).data).toHaveLength(1);
    expect(await upcomingDates(bravo, plan.zed)).toEqual([]);
    expect(await upcomingDates(alpha, plan.bob)).toEqual(plusWeeks(0, 7, 6));
    expect(await upcomingDates(alpha, plan.mowing)).toEqual(plusWeeks(7, 7, 6));
    // Bravo can't see or change Alpha's plans' paused state either.
    expect((await bravo.client.from("service_plans").update({ paused: true }).eq("id", plan.bob).select("id")).data).toEqual([]);
    expect(await planOf(alpha, plan.bob)).toMatchObject({ paused: false });
  });
});
