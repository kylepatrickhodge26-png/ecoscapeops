// Time tracking: crew clock in and out of their own visits, one open entry at a time. Only the
// owner can read entries, fix them, or see hours worth and revenue per hour. Crew members,
// other businesses and signed-out visitors can never read or change someone else's time.
import { beforeAll, describe, expect, it } from "vitest";

import { addCustomer, anonClient, bookService, joinCrew, signUpOwner, todayIn, visitsFor, type TestCrew, type TestOwner } from "./helpers";

const DENIED = "42501";
const NOT_FOUND = "P0002";
const INVALID = "22023";
const ALREADY_OPEN = "23505";
const today = todayIn("America/New_York");
const RANGE = { from_date: today, to_date: today };

async function visit(owner: TestOwner, customerId: string, price: number, service: string, crew?: TestCrew) {
  const plan = await bookService(owner, customerId, {
    frequency: "one_time",
    start_date: today,
    price,
    service_name: service,
    assigned_crew_member_id: crew?.crewMemberId,
  });
  return (await visitsFor(owner, plan.id))[0].id;
}

describe("time tracking", () => {
  let alpha: TestOwner;
  let bravo: TestOwner;
  let maria: TestCrew;
  let sam: TestCrew;
  let mowing: string;
  let mulch: string;
  let samsJob: string;
  let unassigned: string;
  let theirs: string;

  beforeAll(async () => {
    alpha = await signUpOwner("time-alpha", "Alpha Lawn");
    bravo = await signUpOwner("time-bravo", "Bravo Lawn");
    maria = await joinCrew(alpha, "Maria");
    sam = await joinCrew(alpha, "Sam");
    const alice = (await addCustomer(alpha, { first_name: "Alice", last_name: "Ames" })).id;
    mowing = await visit(alpha, alice, 100, "Mowing", maria);
    mulch = await visit(alpha, alice, 200, "Mulch", maria);
    samsJob = await visit(alpha, alice, 60, "Edging", sam);
    unassigned = await visit(alpha, alice, 30, "Trimming");
    theirs = await visit(bravo, (await addCustomer(bravo, { first_name: "Zed" })).id, 900, "Mowing");
  });

  it("lets crew clock in only to their own visits", async () => {
    expect((await sam.client.rpc("clock_in", { job_id: mowing })).error?.code).toBe(NOT_FOUND);
    expect((await maria.client.rpc("clock_in", { job_id: unassigned })).error?.code).toBe(NOT_FOUND);
    expect((await bravo.client.rpc("clock_in", { job_id: mowing })).error?.code).toBe(NOT_FOUND);
    expect((await anonClient().rpc("clock_in", { job_id: mowing })).error).not.toBeNull();
    expect((await maria.client.rpc("clock_in", { job_id: mowing })).error).toBeNull();
  });

  it("allows only one open entry at a time", async () => {
    const again = await maria.client.rpc("clock_in", { job_id: mowing });
    expect(again.error).toBeNull(); // same visit: nothing changes
    const other = await maria.client.rpc("clock_in", { job_id: mulch });
    expect(other.error?.code).toBe(ALREADY_OPEN);
    expect(other.error?.message).toContain("Mowing");
    const open = await maria.client.rpc("my_open_time_entry");
    expect(open.data).toMatchObject([{ job_id: mowing, service_name: "Mowing" }]);
    expect((await sam.client.rpc("my_open_time_entry")).data).toEqual([]);
    expect((await sam.client.rpc("clock_in", { job_id: samsJob })).error).toBeNull();
  });

  it("only the person clocked in can clock out", async () => {
    expect((await sam.client.rpc("clock_out", { job_id: mowing })).error?.code).toBe(NOT_FOUND);
    expect((await bravo.client.rpc("clock_out", { job_id: mowing })).error?.code).toBe(NOT_FOUND);
    expect((await maria.client.rpc("clock_out", { job_id: mulch })).error?.code).toBe(NOT_FOUND);
    expect((await maria.client.rpc("clock_out", { job_id: mowing })).error).toBeNull();
    expect((await maria.client.rpc("clock_out", { job_id: mowing })).error?.code).toBe(NOT_FOUND);
    expect((await maria.client.rpc("clock_in", { job_id: mulch })).error).toBeNull();
    expect((await maria.client.rpc("clock_out", { job_id: mulch })).error).toBeNull();
  });

  it("hides time, worth and revenue per hour from crew and other businesses", async () => {
    expect((await maria.client.from("time_entries").select("id")).data).toEqual([]);
    expect((await bravo.client.from("time_entries").select("id")).data).toEqual([]);
    expect((await maria.client.from("time_entries").update({ note: "x" }).eq("job_id", mowing)).error).not.toBeNull();
    for (const name of ["time_by_job", "time_by_crew", "time_by_customer"] as const) {
      expect((await maria.client.rpc(name, RANGE)).error?.code).toBe(DENIED);
      expect((await anonClient().rpc(name, RANGE)).error).not.toBeNull();
    }
    const { data } = await bravo.client.rpc("time_by_job", RANGE);
    expect(data).toEqual([]);
  });

  it("gives the owner hours and revenue per hour", async () => {
    const { data: jobs } = await alpha.client.rpc("time_by_job", RANGE);
    const byService = Object.fromEntries(jobs!.map((j) => [j.service_name, j]));
    expect(byService.Mowing.job_value).toBe(100);
    expect(byService.Mulch.job_value).toBe(200);
    expect(byService.Mowing.hours).toBeGreaterThanOrEqual(0);
    const { data: crew } = await alpha.client.rpc("time_by_crew", RANGE);
    expect(crew!.map((c) => c.crew_name).sort()).toEqual(["Maria", "Sam"]);
    expect(crew!.find((c) => c.crew_name === "Sam")).toMatchObject({ open_entries: 1 });
    const { data: customers } = await alpha.client.rpc("time_by_customer", RANGE);
    expect(customers).toHaveLength(1);
  });

  it("lets the owner fix a forgotten clock-out with a note, and nobody else", async () => {
    const { data: entry } = await alpha.client.from("time_entries").select("id").eq("job_id", samsJob).single();
    const id = entry!.id;
    const start = "2030-01-01 08:00:00";
    expect((await sam.client.rpc("edit_time_entry", { entry_id: id, started_local: start, ended_local: "2030-01-01 10:00:00", note: "x" })).error?.code).toBe(DENIED);
    expect((await bravo.client.rpc("edit_time_entry", { entry_id: id, started_local: start, ended_local: "2030-01-01 10:00:00", note: "x" })).error?.code).toBe(NOT_FOUND);
    expect((await alpha.client.rpc("edit_time_entry", { entry_id: id, started_local: start, ended_local: "2030-01-01 10:00:00", note: " " })).error?.code).toBe(INVALID);
    expect((await alpha.client.rpc("edit_time_entry", { entry_id: id, started_local: "2030-01-01 10:00:00", ended_local: start, note: "oops" })).error?.code).toBe(INVALID);
    expect((await alpha.client.rpc("edit_time_entry", { entry_id: id, started_local: start, ended_local: "2099-01-01 10:00:00", note: "oops" })).error?.code).toBe(INVALID);
    expect((await alpha.client.rpc("edit_time_entry", { entry_id: id, started_local: start, ended_local: "2030-01-03 10:00:00", note: "oops" })).error?.code).toBe(INVALID);
    expect((await alpha.client.rpc("edit_time_entry", { entry_id: id, started_local: start, ended_local: "2030-01-01 10:00:00", note: "Forgot to clock out" })).error).toBeNull();
    const { data } = await alpha.client.from("time_entries").select("started_at, ended_at, note, edited_at").eq("id", id).single();
    expect(Date.parse(data!.ended_at!) - Date.parse(data!.started_at)).toBe(2 * 3_600_000);
    expect(data).toMatchObject({ note: "Forgot to clock out" });
    expect(data!.edited_at).not.toBeNull();
    // They're free to clock in again.
    expect((await sam.client.rpc("clock_in", { job_id: samsJob })).error).toBeNull();
    expect((await bravo.client.rpc("delete_time_entry", { entry_id: id })).error?.code).toBe(NOT_FOUND);
    expect((await sam.client.rpc("delete_time_entry", { entry_id: id })).error?.code).toBe(DENIED);
    expect((await alpha.client.rpc("delete_time_entry", { entry_id: id })).error).toBeNull();
    expect(theirs).toBeTruthy();
  });
});
