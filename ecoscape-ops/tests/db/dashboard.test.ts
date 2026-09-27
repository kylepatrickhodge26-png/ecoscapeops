// dashboard_summary(): exact numbers for owners, and proof that a crew member's
// dashboard only ever reflects their own jobs — never another crew member's, never
// another business's, and never any money.
import { beforeAll, describe, expect, it } from "vitest";

import {
  addCustomer,
  addDays,
  anonClient,
  bookService,
  joinCrew,
  signUp,
  signUpOwner,
  todayIn,
  visitsFor,
  type Client,
  type TestCrew,
  type TestOwner,
} from "./helpers";

const TZ = "America/New_York";

type Visit = { date: string; price: number; status?: "completed" | "cancelled" | "in_progress"; crew?: string | null };

// Books one-time visits (each its own plan) and sets their statuses, as the owner.
async function seedVisits(owner: TestOwner, customerId: string, visits: Visit[]) {
  for (const v of visits) {
    const plan = await bookService(owner, customerId, {
      frequency: "one_time",
      start_date: v.date,
      price: v.price,
      assigned_crew_member_id: v.crew ?? null,
    });
    if (v.status) {
      const [job] = await visitsFor(owner, plan.id);
      const { error } = await owner.client.from("jobs").update({ status: v.status }).eq("id", job.id);
      expect(error).toBeNull();
    }
  }
}

async function summaryOf(client: Client) {
  const { data, error } = await client.rpc("dashboard_summary");
  expect(error).toBeNull();
  return data!;
}

const monthOf = (d: string) => d.slice(0, 7);

// What the dashboard should say for a set of visits, computed independently.
function expected(visits: Visit[], today: string, withMoney: boolean) {
  const live = visits.filter((v) => v.status !== "cancelled");
  const inMonth = live.filter((v) => monthOf(v.date) === monthOf(today));
  return {
    today,
    today_total: live.filter((v) => v.date === today).length,
    today_completed: live.filter((v) => v.date === today && v.status === "completed").length,
    tomorrow_total: live.filter((v) => v.date === addDays(today, 1)).length,
    week_total: live.filter((v) => v.date >= today && v.date <= addDays(today, 6)).length,
    month_booked: withMoney ? inMonth.reduce((sum, v) => sum + v.price, 0) : null,
    month_completed: withMoney
      ? inMonth.filter((v) => v.status === "completed").reduce((sum, v) => sum + v.price, 0)
      : null,
  };
}

describe("dashboard numbers", () => {
  const today = todayIn(TZ);
  let acme: TestOwner;
  let maria: TestCrew;
  let luis: TestCrew;
  let idle: TestCrew;
  let birch: TestOwner;
  let zoe: TestCrew;
  let acmeVisits: Visit[];
  let birchVisits: Visit[];

  beforeAll(async () => {
    acme = await signUpOwner("dash-acme", "Acme Lawn Care", { time_zone: TZ });
    maria = await joinCrew(acme, "Maria");
    luis = await joinCrew(acme, "Luis");
    idle = await joinCrew(acme, "Idle");
    const customer = await addCustomer(acme);

    acmeVisits = [
      { date: today, price: 100, crew: maria.crewMemberId },
      { date: today, price: 50, status: "completed" },
      { date: today, price: 999, status: "cancelled", crew: maria.crewMemberId },
      { date: today, price: 75, status: "in_progress", crew: luis.crewMemberId },
      { date: addDays(today, 1), price: 70, crew: luis.crewMemberId },
      { date: addDays(today, 6), price: 30, crew: maria.crewMemberId },
      { date: addDays(today, 7), price: 40, crew: maria.crewMemberId },
      { date: addDays(today, -1), price: 20, status: "completed", crew: maria.crewMemberId },
      { date: addDays(today, -40), price: 500, status: "completed" },
      { date: addDays(today, 40), price: 600 },
    ];
    await seedVisits(acme, customer.id, acmeVisits);

    // A second business with lots going on today, to make any leak obvious.
    birch = await signUpOwner("dash-birch", "Birch Tree Services", { time_zone: TZ });
    zoe = await joinCrew(birch, "Zoe");
    const birchCustomer = await addCustomer(birch);
    birchVisits = [
      { date: today, price: 1000, crew: zoe.crewMemberId },
      { date: today, price: 2000, crew: zoe.crewMemberId, status: "completed" },
      { date: addDays(today, 1), price: 3000 },
    ];
    await seedVisits(birch, birchCustomer.id, birchVisits);
  });

  it("gives the owner business-wide counts and this month's booked and completed revenue", async () => {
    const [summary] = await summaryOf(acme.client);
    expect(summary).toEqual(expected(acmeVisits, today, true));
    // Spot-check the counts that don't depend on where today falls in the month.
    expect(summary).toMatchObject({ today_total: 3, today_completed: 1, tomorrow_total: 1, week_total: 5 });
  });

  it("gives a crew member counts of only their own jobs, and no money", async () => {
    const mariaVisits = acmeVisits.filter((v) => v.crew === maria.crewMemberId);
    const [summary] = await summaryOf(maria.client);
    expect(summary).toEqual(expected(mariaVisits, today, false));
    expect(summary).toMatchObject({ today_total: 1, today_completed: 0, tomorrow_total: 0, week_total: 2 });
    expect(summary.month_booked).toBeNull();
    expect(summary.month_completed).toBeNull();
  });

  it("never mixes one crew member's jobs into another's numbers", async () => {
    const [luisSummary] = await summaryOf(luis.client);
    expect(luisSummary).toEqual(
      expected(acmeVisits.filter((v) => v.crew === luis.crewMemberId), today, false),
    );
    expect(luisSummary).toMatchObject({ today_total: 1, tomorrow_total: 1, week_total: 2 });

    const [idleSummary] = await summaryOf(idle.client);
    expect(idleSummary).toMatchObject({ today_total: 0, today_completed: 0, tomorrow_total: 0, week_total: 0 });
  });

  it("never mixes another business's jobs into anyone's numbers", async () => {
    const [birchSummary] = await summaryOf(birch.client);
    expect(birchSummary).toEqual(expected(birchVisits, today, true));

    const [zoeSummary] = await summaryOf(zoe.client);
    expect(zoeSummary).toEqual(
      expected(birchVisits.filter((v) => v.crew === zoe.crewMemberId), today, false),
    );

    // And Acme's numbers are unchanged by everything Birch has booked.
    const [acmeSummary] = await summaryOf(acme.client);
    expect(acmeSummary).toEqual(expected(acmeVisits, today, true));
  });

  it("a removed crew member gets no summary at all", async () => {
    const leaving = await joinCrew(acme, "Leaving");
    await acme.client.rpc("remove_crew_member", { crew_member_id: leaving.crewMemberId });
    expect(await summaryOf(leaving.client)).toEqual([]);
  });

  it("gives nothing to someone without a business, or to signed-out visitors", async () => {
    const loner = await signUp("dash-loner");
    expect(await summaryOf(loner.client)).toEqual([]);

    const { data, error } = await anonClient().rpc("dashboard_summary");
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});

describe("dashboard dates follow the business's time zone", () => {
  // Two zones that are almost a full day apart: at any moment they're on different
  // calendar days for most of the day, so the summary's "today" must follow each one.
  it.each(["Pacific/Kiritimati", "Pacific/Pago_Pago"])("%s", async (timeZone) => {
    const owner = await signUpOwner("dash-tz", "Zone Lawns", { time_zone: timeZone });
    const customer = await addCustomer(owner);
    const today = todayIn(timeZone);
    await seedVisits(owner, customer.id, [{ date: today, price: 10 }]);

    const [summary] = await summaryOf(owner.client);
    expect(summary.today).toBe(today);
    expect(summary.today_total).toBe(1);
  });
});
