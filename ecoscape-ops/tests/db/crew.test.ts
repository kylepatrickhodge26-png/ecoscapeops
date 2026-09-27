// Crew members, invites, assignment, and — above all — isolation: a crew member sees
// and touches only the jobs assigned to them, never prices, never another crew
// member's jobs, and never another business. Every test here runs through the real
// API as the signed-in user it names.
import { beforeAll, describe, expect, it } from "vitest";

import {
  PASSWORD,
  addCrewMember,
  addCustomer,
  addDays,
  adminClient,
  anonClient,
  bookService,
  joinCrew,
  signUp,
  signUpOwner,
  todayIn,
  uniqueEmail,
  visitsFor,
  type TestCrew,
  type TestOwner,
} from "./helpers";

const PERMISSION_DENIED = "42501";
const NOT_FOUND = "P0002";
const FOREIGN_KEY_VIOLATION = "23503";

const ownerView = async (owner: TestOwner, jobId: string) =>
  (await owner.client.from("jobs").select("*").eq("id", jobId).single()).data!;

describe("crew list and invites", () => {
  let owner: TestOwner;

  beforeAll(async () => {
    owner = await signUpOwner("crewlist", "Crew List Lawns", { full_name: "Kyle Hodge" });
  });

  it("puts the owner on their own crew list", async () => {
    const { data } = await owner.client.from("crew_members").select("name, user_id");
    expect(data).toEqual([{ name: "Kyle Hodge", user_id: owner.userId }]);

    const noName = await signUpOwner("noname", "Nameless Lawns");
    const { data: fallback } = await noName.client.from("crew_members").select("name").single();
    expect(fallback!.name).toBe(noName.email.split("@")[0]);
  });

  it("gives each new crew member a one-time invite link", async () => {
    const { token } = await addCrewMember(owner, "Maria");
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // Anyone holding the link can see who it's for, before signing up.
    const { data } = await anonClient().rpc("crew_invite_details", { token });
    expect(data).toEqual([{ business_name: "Crew List Lawns", crew_member_name: "Maria" }]);

    const { data: wrong } = await anonClient().rpc("crew_invite_details", { token: "0".repeat(64) });
    expect(wrong).toEqual([]);

    // Only a hash of the token is stored.
    const { data: stored } = await adminClient()
      .from("crew_members")
      .select("invite_token_hash")
      .eq("business_id", owner.businessId)
      .eq("name", "Maria")
      .single();
    expect(stored!.invite_token_hash).not.toBe(token);
    expect(stored!.invite_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("joining through the link creates a crew login for that business, and the link can't be reused", async () => {
    const { crewMemberId, token } = await addCrewMember(owner, "Luis");
    const luis = await signUp("luis", undefined, { crew_invite_token: token });

    const { data: membership } = await luis.client.from("business_members").select("business_id, role").single();
    expect(membership).toEqual({ business_id: owner.businessId, role: "crew" });

    const { data: record } = await owner.client.from("crew_members").select("user_id, email").eq("id", crewMemberId).single();
    expect(record).toEqual({ user_id: luis.userId, email: luis.email });

    expect((await anonClient().rpc("crew_invite_details", { token })).data).toEqual([]);
    const { error } = await anonClient().auth.signUp({
      email: uniqueEmail("reuse"),
      password: PASSWORD,
      options: { data: { crew_invite_token: token } },
    });
    expect(error).not.toBeNull();
  });

  it("a new link replaces the old one", async () => {
    const { crewMemberId, token: oldToken } = await addCrewMember(owner, "Ana");
    const { data: newToken, error } = await owner.client.rpc("regenerate_crew_invite", { crew_member_id: crewMemberId });
    expect(error).toBeNull();
    expect((await anonClient().rpc("crew_invite_details", { token: oldToken })).data).toEqual([]);
    expect((await anonClient().rpc("crew_invite_details", { token: newToken! })).data).toHaveLength(1);
  });

  it("an expired link doesn't work", async () => {
    const { crewMemberId, token } = await addCrewMember(owner, "Late");
    await adminClient()
      .from("crew_members")
      .update({ invite_expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", crewMemberId);

    expect((await anonClient().rpc("crew_invite_details", { token })).data).toEqual([]);
    const { error } = await anonClient().auth.signUp({
      email: uniqueEmail("expired"),
      password: PASSWORD,
      options: { data: { crew_invite_token: token } },
    });
    expect(error).not.toBeNull();
  });

  it("a signed-in user without a business can accept; one who already has a business can't", async () => {
    const { token } = await addCrewMember(owner, "Sam");
    const otherOwner = await signUpOwner("has-biz", "Already Mine");
    const { error: taken } = await otherOwner.client.rpc("accept_crew_invite", { token });
    expect(taken?.code).toBe("23505");

    const loner = await signUp("loner");
    const { data: businessId, error } = await loner.client.rpc("accept_crew_invite", { token });
    expect(error).toBeNull();
    expect(businessId).toBe(owner.businessId);
  });

  it("the owner can rename crew members; crew members can't", async () => {
    const maria = await joinCrew(owner, "Mariah");
    const { data: renamed } = await owner.client
      .from("crew_members")
      .update({ name: "Maria G." })
      .eq("id", maria.crewMemberId)
      .select("name");
    expect(renamed).toEqual([{ name: "Maria G." }]);

    const { data: selfRename } = await maria.client
      .from("crew_members")
      .update({ name: "Boss" })
      .eq("id", maria.crewMemberId)
      .select();
    expect(selfRename).toEqual([]);
  });

  it("the owner can't be removed from the crew", async () => {
    const { data: me } = await owner.client.from("crew_members").select("id").eq("user_id", owner.userId).single();
    const { error } = await owner.client.rpc("remove_crew_member", { crew_member_id: me!.id });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("assignment", () => {
  let owner: TestOwner;
  let maria: TestCrew;
  let customerId: string;

  beforeAll(async () => {
    owner = await signUpOwner("assign", "Assign Lawns");
    maria = await joinCrew(owner, "Maria");
    customerId = (await addCustomer(owner)).id;
  });

  it("a booked service's visits, including ones added later, go to its crew member", async () => {
    const plan = await bookService(owner, customerId, { assigned_crew_member_id: maria.crewMemberId });
    let visits = await visitsFor(owner, plan.id);
    expect(visits.every((v) => v.assigned_crew_member_id === maria.crewMemberId)).toBe(true);

    await owner.client.from("jobs").update({ status: "completed" }).eq("id", visits[0].id);
    visits = await visitsFor(owner, plan.id);
    expect(visits).toHaveLength(7);
    expect(visits.at(-1)!.assigned_crew_member_id).toBe(maria.crewMemberId);
  });

  it("can't assign work to another business's crew member", async () => {
    const other = await signUpOwner("assign-other", "Other Lawns");
    const theirCrew = await joinCrew(other, "Zoe");

    const { error: planError } = await owner.client.from("service_plans").insert({
      business_id: owner.businessId,
      customer_id: customerId,
      service_name: "Mowing",
      price: 50,
      frequency: "weekly",
      start_date: "2030-03-05",
      assigned_crew_member_id: theirCrew.crewMemberId,
    });
    expect(planError?.code).toBe(FOREIGN_KEY_VIOLATION);

    const plan = await bookService(owner, customerId);
    const [visit] = await visitsFor(owner, plan.id);
    const { error: jobError } = await owner.client
      .from("jobs")
      .update({ assigned_crew_member_id: theirCrew.crewMemberId })
      .eq("id", visit.id);
    expect(jobError?.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("removing a crew member unassigns their work and ends their access", async () => {
    const leaving = await joinCrew(owner, "Leaving");
    const plan = await bookService(owner, customerId, { assigned_crew_member_id: leaving.crewMemberId });
    expect(await leaving.client.rpc("crew_jobs", { from_date: "2030-01-01", to_date: "2030-12-31" })).toMatchObject({
      data: expect.arrayContaining([expect.objectContaining({ service_name: "Mowing" })]),
    });

    const { error } = await owner.client.rpc("remove_crew_member", { crew_member_id: leaving.crewMemberId });
    expect(error).toBeNull();

    const visits = await visitsFor(owner, plan.id);
    expect(visits.every((v) => v.assigned_crew_member_id === null)).toBe(true);
    const { data: planAfter } = await owner.client.from("service_plans").select("assigned_crew_member_id").eq("id", plan.id).single();
    expect(planAfter!.assigned_crew_member_id).toBeNull();

    // Their login still exists but sees nothing of the business any more.
    expect((await leaving.client.rpc("crew_jobs", { from_date: "2030-01-01", to_date: "2030-12-31" })).data).toEqual([]);
    expect((await leaving.client.from("businesses").select("id")).data).toEqual([]);
    expect((await leaving.client.from("business_members").select("business_id")).data).toEqual([]);
  });
});

describe("crew isolation: break-in attempts", () => {
  let acme: TestOwner;
  let maria: TestCrew;
  let luis: TestCrew;
  let birch: TestOwner;
  let zoe: TestCrew;
  let mariaJobs: string[];
  let luisJob: string;
  let unassignedJob: string;
  let ownerJob: string;
  let birchJob: string;
  let luisPlanId: string;
  const range = { from_date: "2030-01-01", to_date: "2030-12-31" };

  beforeAll(async () => {
    acme = await signUpOwner("acme-c", "Acme Lawn Care", { full_name: "Ann Owner" });
    maria = await joinCrew(acme, "Maria");
    luis = await joinCrew(acme, "Luis");
    birch = await signUpOwner("birch-c", "Birch Tree Services");
    zoe = await joinCrew(birch, "Zoe");

    const customer = await addCustomer(acme, { first_name: "John", last_name: "Smith", phone: "(631) 555-0142" });
    const { data: me } = await acme.client.from("crew_members").select("id").eq("user_id", acme.userId).single();

    const mariaPlan = await bookService(acme, customer.id, { assigned_crew_member_id: maria.crewMemberId, price: 65 });
    mariaJobs = (await visitsFor(acme, mariaPlan.id)).map((v) => v.id);
    const luisPlan = await bookService(acme, customer.id, { assigned_crew_member_id: luis.crewMemberId, service_name: "Hedges" });
    luisPlanId = luisPlan.id;
    luisJob = (await visitsFor(acme, luisPlan.id))[0].id;
    unassignedJob = (await visitsFor(acme, (await bookService(acme, customer.id, { frequency: "one_time" })).id))[0].id;
    ownerJob = (
      await visitsFor(acme, (await bookService(acme, customer.id, { frequency: "one_time", assigned_crew_member_id: me!.id })).id)
    )[0].id;

    const birchCustomer = await addCustomer(birch);
    birchJob = (
      await visitsFor(birch, (await bookService(birch, birchCustomer.id, { assigned_crew_member_id: zoe.crewMemberId })).id)
    )[0].id;
  });

  it("a crew member's job list has only their own jobs, and no prices", async () => {
    const { data, error } = await maria.client.rpc("crew_jobs", range);
    expect(error).toBeNull();
    expect(data!.map((j) => j.id).sort()).toEqual([...mariaJobs].sort());
    for (const job of data!) {
      expect(job).not.toHaveProperty("price");
      expect(job).toMatchObject({ service_name: "Mowing", customer_first_name: "John", customer_phone: "(631) 555-0142" });
    }
    expect(data!.map((j) => j.id)).not.toContain(luisJob);
    expect(data!.map((j) => j.id)).not.toContain(unassignedJob);
    expect(data!.map((j) => j.id)).not.toContain(ownerJob);
  });

  it("the owner is on the crew too, and sees their own assigned jobs in the crew view", async () => {
    const { data } = await acme.client.rpc("crew_jobs", range);
    expect(data!.map((j) => j.id)).toEqual([ownerJob]);
  });

  it("crew can't read customers, services, or jobs directly", async () => {
    for (const table of ["customers", "service_plans", "jobs"] as const) {
      const { data } = await maria.client.from(table).select("*");
      expect(data, table).toEqual([]);
    }
    const { data: byId } = await maria.client.from("jobs").select("price").eq("id", mariaJobs[0]);
    expect(byId).toEqual([]);
  });

  it("crew see only their own crew and membership records", async () => {
    const { data: crew } = await maria.client.from("crew_members").select("name");
    expect(crew).toEqual([{ name: "Maria" }]);
    const { data: members } = await maria.client.from("business_members").select("user_id");
    expect(members).toEqual([{ user_id: maria.userId }]);
    const { data: businesses } = await maria.client.from("businesses").select("name");
    expect(businesses).toEqual([{ name: "Acme Lawn Care" }]);
  });

  it("crew can't change, reassign, or delete jobs directly", async () => {
    const { data: updated } = await maria.client
      .from("jobs")
      .update({ assigned_crew_member_id: maria.crewMemberId, price: 1 })
      .eq("id", luisJob)
      .select();
    expect(updated).toEqual([]);
    const { data: deleted } = await maria.client.from("jobs").delete().eq("id", mariaJobs[0]).select();
    expect(deleted).toEqual([]);
    expect((await ownerView(acme, luisJob)).assigned_crew_member_id).toBe(luis.crewMemberId);
    expect(await ownerView(acme, mariaJobs[0])).toBeTruthy();
  });

  it("crew can't add customers, book services, or create jobs", async () => {
    const { error: customerError } = await maria.client
      .from("customers")
      .insert({ business_id: acme.businessId, first_name: "Sneaky" });
    expect(customerError?.code).toBe(PERMISSION_DENIED);

    const { error: planError } = await maria.client.from("service_plans").insert({
      business_id: acme.businessId,
      customer_id: "00000000-0000-0000-0000-000000000000",
      service_name: "Free work",
      price: 0,
      frequency: "weekly",
      start_date: "2030-03-05",
    });
    expect(planError?.code).toBe(PERMISSION_DENIED);
  });

  it("crew can't act on another crew member's job, an unassigned job, or another business's job", async () => {
    for (const jobId of [luisJob, unassignedJob, ownerJob, birchJob]) {
      const status = await maria.client.rpc("crew_set_job_status", { job_id: jobId, new_status: "completed" });
      expect(status.error?.code, `status ${jobId}`).toBe(NOT_FOUND);
      const note = await maria.client.rpc("crew_add_job_note", { job_id: jobId, note: "was here" });
      expect(note.error?.code, `note ${jobId}`).toBe(NOT_FOUND);
      const cns = await maria.client.rpc("crew_could_not_service", {
        job_id: jobId,
        choice: "cancel",
        new_date: null as unknown as string,
        note_line: "nope",
      });
      expect(cns.error?.code, `cns ${jobId}`).toBe(NOT_FOUND);
    }
    const luisView = await ownerView(acme, luisJob);
    expect(luisView).toMatchObject({ status: "scheduled", notes: "" });
    const birchView = (await birch.client.from("jobs").select("status, notes").eq("id", birchJob).single()).data;
    expect(birchView).toEqual({ status: "scheduled", notes: "" });
  });

  it("crew members of another business see nothing of this one", async () => {
    const { data } = await zoe.client.rpc("crew_jobs", range);
    const { data: birchJobs } = await birch.client.from("jobs").select("id").eq("assigned_crew_member_id", zoe.crewMemberId);
    expect(data!.map((j) => j.id).sort()).toEqual(birchJobs!.map((j) => j.id).sort());
    expect(data!.map((j) => j.id)).toContain(birchJob);
    for (const acmeJob of [...mariaJobs, luisJob, unassignedJob, ownerJob]) expect(data!.map((j) => j.id)).not.toContain(acmeJob);
    const status = await zoe.client.rpc("crew_set_job_status", { job_id: mariaJobs[0], new_status: "in_progress" });
    expect(status.error?.code).toBe(NOT_FOUND);
  });

  it("crew can't use owner-only functions", async () => {
    const { error: add } = await maria.client.rpc("add_crew_member", { member_name: "My friend" });
    expect(add?.code).toBe(PERMISSION_DENIED);
    const { error: remove } = await maria.client.rpc("remove_crew_member", { crew_member_id: luis.crewMemberId });
    expect(remove?.code).toBe(NOT_FOUND);
    const { error: regen } = await maria.client.rpc("regenerate_crew_invite", { crew_member_id: luis.crewMemberId });
    expect(regen?.code).toBe(NOT_FOUND);
    const { error: stop } = await maria.client.rpc("stop_service_plan", { plan_id: luisPlanId });
    expect(stop?.code).toBe(NOT_FOUND);

    // Luis is still on the crew with his job.
    const { data: crew } = await acme.client.from("crew_members").select("id").eq("id", luis.crewMemberId);
    expect(crew).toHaveLength(1);
  });

  it("crew can only mark jobs en route, in progress, or completed", async () => {
    for (const status of ["cancelled", "scheduled", "assigned", "weather_delay", "unable_to_complete"] as const) {
      const { error } = await maria.client.rpc("crew_set_job_status", { job_id: mariaJobs[5], new_status: status });
      expect(error?.code, status).toBe(PERMISSION_DENIED);
    }
    expect((await ownerView(acme, mariaJobs[5])).status).toBe("scheduled");
  });

  it("signed-out visitors can't use any crew function", async () => {
    const anon = anonClient();
    expect((await anon.rpc("crew_jobs", range)).error).not.toBeNull();
    expect((await anon.rpc("crew_set_job_status", { job_id: mariaJobs[0], new_status: "completed" })).error).not.toBeNull();
    expect((await anon.rpc("add_crew_member", { member_name: "x" })).error).not.toBeNull();
  });
});

describe("crew actions on their own jobs", () => {
  let owner: TestOwner;
  let maria: TestCrew;
  let customerId: string;
  const today = todayIn("America/New_York");

  beforeAll(async () => {
    owner = await signUpOwner("actions", "Action Lawns", { time_zone: "America/New_York" });
    maria = await joinCrew(owner, "Maria");
    customerId = (await addCustomer(owner)).id;
  });

  const book = async () => {
    const plan = await bookService(owner, customerId, {
      assigned_crew_member_id: maria.crewMemberId,
      start_date: addDays(today, 1),
    });
    return { plan, visits: await visitsFor(owner, plan.id) };
  };

  it("a crew member can start and complete their job, which adds the next visit (to them)", async () => {
    const { plan, visits } = await book();
    for (const status of ["en_route", "in_progress", "completed"] as const) {
      const { error } = await maria.client.rpc("crew_set_job_status", { job_id: visits[0].id, new_status: status });
      expect(error, status).toBeNull();
      expect((await ownerView(owner, visits[0].id)).status).toBe(status);
    }
    const after = await visitsFor(owner, plan.id);
    expect(after).toHaveLength(7);
    expect(after.at(-1)!.assigned_crew_member_id).toBe(maria.crewMemberId);

    const { error } = await maria.client.rpc("crew_set_job_status", { job_id: visits[0].id, new_status: "in_progress" });
    expect(error?.code).toBe("22023"); // already completed
  });

  it("a crew member can add notes, signed with their name", async () => {
    const { visits } = await book();
    await maria.client.rpc("crew_add_job_note", { job_id: visits[0].id, note: "Dog in yard" });
    await maria.client.rpc("crew_add_job_note", { job_id: visits[0].id, note: "Gate code changed" });
    expect((await ownerView(owner, visits[0].id)).notes).toBe("Maria: Dog in yard\nMaria: Gate code changed");

    const { error } = await maria.client.rpc("crew_add_job_note", { job_id: visits[0].id, note: " " });
    expect(error?.code).toBe("22023");
  });

  it("'could not service' reschedules (not into the past) or cancels", async () => {
    const { plan, visits } = await book();

    const past = await maria.client.rpc("crew_could_not_service", {
      job_id: visits[0].id,
      choice: "reschedule",
      new_date: addDays(today, -1),
      note_line: "Gate locked",
    });
    expect(past.error?.code).toBe("22023");

    const moved = await maria.client.rpc("crew_could_not_service", {
      job_id: visits[0].id,
      choice: "reschedule",
      new_date: addDays(today, 2),
      note_line: "Gate locked — rescheduled",
    });
    expect(moved.error).toBeNull();
    expect(await ownerView(owner, visits[0].id)).toMatchObject({
      scheduled_date: addDays(today, 2),
      status: "scheduled",
      notes: "Maria: Gate locked — rescheduled",
    });

    const cancelled = await maria.client.rpc("crew_could_not_service", {
      job_id: visits[1].id,
      choice: "cancel",
      new_date: null as unknown as string,
      note_line: "Customer asked to skip",
    });
    expect(cancelled.error).toBeNull();
    expect((await ownerView(owner, visits[1].id)).status).toBe("cancelled");
    expect(await visitsFor(owner, plan.id)).toHaveLength(7); // next visit added
  });
});
