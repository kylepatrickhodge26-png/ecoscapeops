// Moving visits: owner only, one or many at once, with the option to move a customer's later
// visits by the same number of days (which makes the new weekday their regular day).
import { beforeAll, describe, expect, it } from "vitest";

import { addCustomer, addDays, anonClient, bookService, joinCrew, signUpOwner, todayIn, visitsFor, type TestCrew, type TestOwner } from "./helpers";

const DENIED = "42501";
const NOT_FOUND = "P0002";
const INVALID = "22023";
const today = todayIn("America/New_York");
// A Monday one to two weeks out.
const monday = (() => {
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  return addDays(today, ((8 - dow) % 7) + 7);
})();

describe("moving visits", () => {
  let alpha: TestOwner;
  let bravo: TestOwner;
  let crew: TestCrew;
  let john: string;
  let johnPlan: string;
  let karenPlan: string;

  beforeAll(async () => {
    alpha = await signUpOwner("move-alpha", "Alpha Lawn");
    bravo = await signUpOwner("move-bravo", "Bravo Lawn");
    crew = await joinCrew(alpha, "Casey");
    john = (await addCustomer(alpha, { first_name: "John", preferred_day: "monday" })).id;
    const karen = (await addCustomer(alpha, { first_name: "Karen" })).id;
    johnPlan = (await bookService(alpha, john, { frequency: "biweekly", start_date: monday })).id;
    karenPlan = (await bookService(alpha, karen, { frequency: "weekly", start_date: monday })).id;
  });

  it("lets only the owner move their own visits", async () => {
    const [first] = await visitsFor(alpha, karenPlan);
    const args = { job_ids: [first.id], new_date: addDays(monday, 2), move_later: false };
    expect((await crew.client.rpc("move_visits", args)).error?.code).toBe(DENIED);
    expect((await bravo.client.rpc("move_visits", args)).error?.code).toBe(NOT_FOUND);
    expect((await anonClient().rpc("move_visits", args)).error).not.toBeNull();
    expect((await visitsFor(alpha, karenPlan))[0].scheduled_date).toBe(monday);
  });

  it("moves one visit and leaves a note", async () => {
    const [first, second] = await visitsFor(alpha, karenPlan);
    const { data, error } = await alpha.client.rpc("move_visits", { job_ids: [first.id], new_date: addDays(monday, 2), move_later: false });
    expect(error).toBeNull();
    expect(data).toBe(1);
    const after = await visitsFor(alpha, karenPlan);
    const moved = after.find((v) => v.id === first.id)!;
    expect(moved.scheduled_date).toBe(addDays(monday, 2));
    expect(moved.notes).toMatch(/^Moved from Mon, /);
    expect(after.find((v) => v.id === second.id)!.scheduled_date).toBe(second.scheduled_date);
  });

  it("refuses bad moves", async () => {
    const [first] = await visitsFor(alpha, karenPlan);
    expect((await alpha.client.rpc("move_visits", { job_ids: [first.id], new_date: addDays(today, 400) })).error?.code).toBe(INVALID);
    expect((await alpha.client.rpc("move_visits", { job_ids: [], new_date: monday })).error?.code).toBe(INVALID);
    expect((await alpha.client.rpc("move_visits", { job_ids: [first.id], new_date: first.scheduled_date })).error?.code).toBe(NOT_FOUND);
  });

  it("moves their later visits too and changes their regular day", async () => {
    const before = await visitsFor(alpha, johnPlan);
    const { data, error } = await alpha.client.rpc("move_visits", { job_ids: [before[0].id], new_date: addDays(monday, 2), move_later: true });
    expect(error).toBeNull();
    expect(data).toBe(before.length);
    const after = await visitsFor(alpha, johnPlan);
    expect(after.map((v) => v.scheduled_date)).toEqual(before.map((v) => addDays(v.scheduled_date, 2)));
    const { data: customer } = await alpha.client.from("customers").select("preferred_day").eq("id", john).single();
    expect(customer!.preferred_day).toBe("wednesday");
  });

  it("moves several visits at once", async () => {
    const visits = (await visitsFor(alpha, karenPlan)).slice(1, 3);
    const { data } = await alpha.client.rpc("move_visits", { job_ids: visits.map((v) => v.id), new_date: addDays(monday, 30), move_later: false });
    expect(data).toBe(2);
  });
});
