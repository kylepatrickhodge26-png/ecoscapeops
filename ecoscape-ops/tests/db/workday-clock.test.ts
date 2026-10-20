// The workday clock and the one-tap job clock: start the day, clock in to a visit (which starts
// the day and the visit), clock out with or without finishing it, end the day. Checks that crew
// can only use their own visits, one clock at a time, that forgotten clocks get closed and
// flagged instead of getting anyone stuck, and that only the owner reads or fixes workdays —
// never another business, crew member or signed-out visitor.
import { beforeAll, describe, expect, it } from "vitest";

import { addCustomer, adminClient, anonClient, bookService, joinCrew, signUpOwner, todayIn, visitsFor, type Client, type TestCrew, type TestOwner } from "./helpers";

const DENIED = "42501";
const NOT_FOUND = "P0002";
const INVALID = "22023";
const ALREADY_OPEN = "23505";
const TZ = "America/New_York";
const today = todayIn(TZ);

async function visit(owner: TestOwner, customerId: string, service: string, crew?: TestCrew) {
  const plan = await bookService(owner, customerId, { frequency: "one_time", start_date: today, service_name: service, assigned_crew_member_id: crew?.crewMemberId ?? null });
  return (await visitsFor(owner, plan.id))[0].id;
}

const clock = async (client: Client) => (await client.rpc("my_clock")).data?.[0] ?? null;
const statusOf = async (owner: TestOwner, jobId: string) => (await owner.client.from("jobs").select("status").eq("id", jobId).single()).data!.status;
const shiftsOf = async (owner: TestOwner, crewMemberId: string) =>
  (await owner.client.from("work_shifts").select("id, started_at, ended_at, auto_closed, note").eq("crew_member_id", crewMemberId).order("started_at")).data!;
const entriesOf = async (owner: TestOwner, jobId: string) =>
  (await owner.client.from("time_entries").select("crew_name, started_at, ended_at, note").eq("job_id", jobId)).data!;

describe("workday clock and one-tap job clock", () => {
  let alpha: TestOwner;
  let bravo: TestOwner;
  let maria: TestCrew;
  let sam: TestCrew;
  let ownerCrewId: string;
  const job: Record<string, string> = {};

  beforeAll(async () => {
    alpha = await signUpOwner("clock-alpha", "Alpha Lawn", { time_zone: TZ });
    bravo = await signUpOwner("clock-bravo", "Bravo Lawn", { time_zone: TZ });
    maria = await joinCrew(alpha, "Maria");
    sam = await joinCrew(alpha, "Sam");
    ownerCrewId = (await alpha.client.from("crew_members").select("id").eq("user_id", alpha.userId).single()).data!.id;
    const alice = (await addCustomer(alpha, { first_name: "Alice", last_name: "Ames" })).id;
    const bob = (await addCustomer(alpha, { first_name: "Bob", last_name: "Burns" })).id;
    job.mowing = await visit(alpha, alice, "Mowing", maria);
    job.mulch = await visit(alpha, bob, "Mulch", maria);
    job.edging = await visit(alpha, alice, "Edging", sam);
    job.unassigned = await visit(alpha, bob, "Trimming");
    job.theirs = await visit(bravo, (await addCustomer(bravo, { first_name: "Zed" })).id, "Mowing");
  });

  it("starts and ends a workday, once at a time", async () => {
    expect(await clock(sam.client)).toEqual({ workday_started_at: null, job_id: null, job_started_at: null, service_name: null, customer_name: null });
    const first = await sam.client.rpc("start_workday");
    expect(first.error).toBeNull();
    // A second tap changes nothing.
    expect((await sam.client.rpc("start_workday")).data).toBe(first.data);
    // The table itself refuses a second open workday for one person.
    const second = await adminClient()
      .from("work_shifts")
      .insert({ business_id: alpha.businessId, crew_member_id: sam.crewMemberId, crew_name: "Sam" });
    expect(second.error?.code).toBe(ALREADY_OPEN);
    expect((await clock(sam.client))!.workday_started_at).not.toBeNull();
    expect((await sam.client.rpc("end_workday")).error).toBeNull();
    expect((await clock(sam.client))!.workday_started_at).toBeNull();
    expect((await sam.client.rpc("end_workday")).error?.code).toBe(NOT_FOUND);
    const shifts = await shiftsOf(alpha, sam.crewMemberId);
    expect(shifts).toHaveLength(1);
    expect(shifts[0].ended_at).not.toBeNull();
  });

  it("one tap on a visit starts the day, clocks in and starts the visit", async () => {
    expect((await maria.client.rpc("start_job", { job_id: job.mowing })).error).toBeNull();
    expect(await clock(maria.client)).toMatchObject({ job_id: job.mowing, service_name: "Mowing", customer_name: "Alice Ames" });
    expect((await clock(maria.client))!.workday_started_at).not.toBeNull();
    expect(await statusOf(alpha, job.mowing)).toBe("in_progress");
    // Tapping again changes nothing; another visit has to wait until she clocks out.
    expect((await maria.client.rpc("start_job", { job_id: job.mowing })).error).toBeNull();
    const busy = await maria.client.rpc("start_job", { job_id: job.mulch });
    expect(busy.error?.code).toBe(ALREADY_OPEN);
    expect(busy.error?.message).toBe("You're clocked in at Alice Ames — clock out there first");
    expect(await entriesOf(alpha, job.mowing)).toHaveLength(1);
    expect(await shiftsOf(alpha, maria.crewMemberId)).toHaveLength(1);
  });

  it("clocking out with 'finished' completes the visit; the day keeps running", async () => {
    expect((await maria.client.rpc("finish_job", { job_id: job.mowing, complete: true })).error).toBeNull();
    expect(await statusOf(alpha, job.mowing)).toBe("completed");
    expect((await entriesOf(alpha, job.mowing))[0].ended_at).not.toBeNull();
    expect(await clock(maria.client)).toMatchObject({ job_id: null });
    expect((await clock(maria.client))!.workday_started_at).not.toBeNull();
    // A finished visit can't be clocked into again.
    expect((await maria.client.rpc("start_job", { job_id: job.mowing })).error?.code).toBe(INVALID);
  });

  it("clocking out 'not finished' leaves the visit open to come back to", async () => {
    await maria.client.rpc("start_job", { job_id: job.mulch });
    expect((await maria.client.rpc("finish_job", { job_id: job.mulch, complete: false })).error).toBeNull();
    expect(await statusOf(alpha, job.mulch)).toBe("in_progress");
    expect((await maria.client.rpc("finish_job", { job_id: job.mulch, complete: false })).error?.code).toBe(NOT_FOUND);
    // Back later, then done.
    await maria.client.rpc("start_job", { job_id: job.mulch });
    expect(await entriesOf(alpha, job.mulch)).toHaveLength(2);
  });

  it("ending the day also stops the job clock, without finishing the visit", async () => {
    expect((await maria.client.rpc("end_workday")).error).toBeNull();
    expect(await clock(maria.client)).toMatchObject({ workday_started_at: null, job_id: null });
    expect((await entriesOf(alpha, job.mulch)).every((e) => e.ended_at !== null)).toBe(true);
    expect(await statusOf(alpha, job.mulch)).toBe("in_progress");
  });

  it("crew use only their own visits; the owner can use any visit in the business", async () => {
    for (const id of [job.edging, job.unassigned, job.theirs]) {
      expect((await maria.client.rpc("start_job", { job_id: id })).error?.code).toBe(NOT_FOUND);
      expect((await maria.client.rpc("finish_job", { job_id: id, complete: true })).error?.code).toBe(NOT_FOUND);
    }
    expect(await statusOf(alpha, job.edging)).toBe("scheduled");
    expect((await alpha.client.rpc("start_job", { job_id: job.unassigned })).error).toBeNull();
    expect((await alpha.client.rpc("finish_job", { job_id: job.unassigned, complete: true })).error).toBeNull();
    expect(await statusOf(alpha, job.unassigned)).toBe("completed");
    expect(await shiftsOf(alpha, ownerCrewId)).toHaveLength(1);
    // Another business's owner can't touch Alpha's visits.
    expect((await bravo.client.rpc("start_job", { job_id: job.edging })).error?.code).toBe(NOT_FOUND);
    expect((await bravo.client.rpc("finish_job", { job_id: job.edging, complete: true })).error?.code).toBe(NOT_FOUND);
    expect(await statusOf(alpha, job.edging)).toBe("scheduled");
  });

  it("signed-out visitors can't use the clock at all", async () => {
    const anon = anonClient();
    for (const call of [anon.rpc("start_workday"), anon.rpc("end_workday"), anon.rpc("start_job", { job_id: job.edging }), anon.rpc("finish_job", { job_id: job.edging, complete: true })]) {
      expect((await call).error?.code).toBe(DENIED);
    }
    expect((await anon.from("work_shifts").select("*")).error?.code).toBe(DENIED);
  });

  it("only the owner reads workdays: not crew, not another business", async () => {
    expect((await alpha.client.from("work_shifts").select("id").eq("business_id", alpha.businessId)).data!.length).toBeGreaterThan(0);
    expect((await maria.client.from("work_shifts").select("*")).data).toEqual([]);
    expect((await bravo.client.from("work_shifts").select("*").eq("business_id", alpha.businessId)).data).toEqual([]);
    expect((await maria.client.from("work_shifts").insert({ business_id: alpha.businessId, crew_name: "Fake" })).error?.code).toBe(DENIED);
    expect((await maria.client.rpc("workday_by_crew", { from_date: today, to_date: today })).error?.code).toBe(DENIED);
    expect((await bravo.client.rpc("workday_by_crew", { from_date: today, to_date: today })).data).toEqual([]);
  });

  it("shows the owner each person's workday hours", async () => {
    const { data, error } = await alpha.client.rpc("workday_by_crew", { from_date: today, to_date: today });
    expect(error).toBeNull();
    const byName = Object.fromEntries(data!.map((r) => [r.crew_name, r]));
    expect(byName.Maria).toMatchObject({ days: 1, open_workdays: 0, needs_look: 0 });
    expect(byName.Sam).toMatchObject({ days: 1, open_workdays: 0 });
    expect(byName.Kyle ?? Object.values(byName).find((r) => r.crew_member_id === ownerCrewId)).toMatchObject({ open_workdays: 1 });
  });

  it("closes and flags a clock someone forgot to stop, so they can still clock in today", async () => {
    // Sam forgot to clock out of a visit and end his day 20 hours ago.
    const admin = adminClient();
    const longAgo = new Date(Date.now() - 20 * 3600_000).toISOString();
    const lastOut = new Date(Date.now() - 18 * 3600_000).toISOString();
    await admin.from("work_shifts").insert({ business_id: alpha.businessId, crew_member_id: sam.crewMemberId, crew_name: "Sam", started_at: longAgo });
    await admin.from("time_entries").insert({ business_id: alpha.businessId, job_id: job.edging, crew_member_id: sam.crewMemberId, crew_name: "Sam", started_at: longAgo, ended_at: lastOut });
    const forgotten = await admin.from("time_entries").insert({ business_id: alpha.businessId, job_id: job.edging, crew_member_id: sam.crewMemberId, crew_name: "Sam", started_at: lastOut }).select("id").single();
    // A stale clock doesn't show as running.
    expect(await clock(sam.client)).toMatchObject({ workday_started_at: null, job_id: null });

    expect((await sam.client.rpc("start_job", { job_id: job.edging })).error).toBeNull();
    const shifts = await shiftsOf(alpha, sam.crewMemberId);
    const stale = shifts.find((s) => s.auto_closed)!;
    expect(stale).toMatchObject({ auto_closed: true, note: "Closed automatically: the day was never ended" });
    // Closed at the last clock-out that day, not "now".
    expect(new Date(stale.ended_at!).getTime()).toBe(new Date(lastOut).getTime());
    const entry = (await alpha.client.from("time_entries").select("ended_at, note").eq("id", forgotten.data!.id).single()).data!;
    expect(entry.note).toBe("Closed automatically: never clocked out");
    expect(new Date(entry.ended_at!).getTime() - new Date(lastOut).getTime()).toBe(60_000);
    expect(shifts.filter((s) => s.ended_at === null)).toHaveLength(1);

    const summary = (await alpha.client.rpc("workday_by_crew", { from_date: "2000-01-01", to_date: "2100-01-01" })).data!;
    expect(summary.find((r) => r.crew_member_id === sam.crewMemberId)!.needs_look).toBe(1);
  });

  it("only the owner fixes a workday, with a note", async () => {
    const [shift] = (await shiftsOf(alpha, maria.crewMemberId)).filter((s) => s.ended_at !== null);
    const fix = (client: Client, note = "Forgot to clock out") =>
      client.rpc("edit_work_shift", { shift_id: shift.id, started_local: "2026-01-05 07:00:00", ended_local: "2026-01-05 08:30:00", note });
    expect((await fix(alpha.client, "  ")).error?.code).toBe(INVALID);
    expect((await fix(maria.client)).error?.code).toBe(DENIED);
    expect((await fix(bravo.client)).error?.code).toBe(NOT_FOUND);
    expect((await bravo.client.rpc("delete_work_shift", { shift_id: shift.id })).error?.code).toBe(NOT_FOUND);
    expect((await maria.client.rpc("delete_work_shift", { shift_id: shift.id })).error?.code).toBe(DENIED);
    expect((await fix(alpha.client)).error).toBeNull();
    const fixed = (await alpha.client.from("work_shifts").select("started_at, ended_at, note, edited_at").eq("id", shift.id).single()).data!;
    expect(fixed.note).toBe("Forgot to clock out");
    expect(fixed.edited_at).not.toBeNull();
    expect(new Date(fixed.ended_at!).getTime() - new Date(fixed.started_at).getTime()).toBe(90 * 60_000);
    expect((await alpha.client.rpc("delete_work_shift", { shift_id: shift.id })).error).toBeNull();
  });
});
