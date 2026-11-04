// Rain days, handled automatically: work hours and the on/off switch (owner only), the app's
// automatic move of a rainy day's repeat visits (once per day, never one-time jobs or visits
// under way), and Undo for any rain delay.
import { beforeAll, describe, expect, it } from "vitest";

import { addCustomer, addDays, anonClient, bookService, joinCrew, signUpOwner, todayIn, visitsFor, type TestCrew, type TestOwner } from "./helpers";

const DENIED = "42501";
const NOT_FOUND = "P0002";
const INVALID = "22023";
const CHECK_VIOLATION = "23514";
const today = todayIn("America/New_York");
const isSunday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
// The rainy day: tomorrow, unless tomorrow is a Sunday (then today, a Saturday).
const rainDay = isSunday(addDays(today, 1)) ? today : addDays(today, 1);
const nextDay = isSunday(addDays(rainDay, 1)) ? addDays(rainDay, 2) : addDays(rainDay, 1);

describe("moving visits for rain automatically", () => {
  let alpha: TestOwner;
  let bravo: TestOwner;
  let crew: TestCrew;
  let mowing: string;
  let weekly: string;
  let hedges: string;

  const auto = (who: { client: TestOwner["client"] }, day = rainDay, to = nextDay, hours = "10am–2pm") =>
    who.client.rpc("auto_rain_move", { rain_day: day, move_to: to, rain_hours: hours });

  beforeAll(async () => {
    alpha = await signUpOwner("rain-alpha", "Alpha Lawn");
    bravo = await signUpOwner("rain-bravo", "Bravo Lawn");
    crew = await joinCrew(alpha, "Casey");
    const john = (await addCustomer(alpha, { first_name: "John" })).id;
    const karen = (await addCustomer(alpha, { first_name: "Karen" })).id;
    mowing = (await bookService(alpha, john, { frequency: "biweekly", start_date: rainDay })).id;
    hedges = (await bookService(alpha, john, { frequency: "one_time", service_name: "Hedges", start_date: rainDay })).id;
    weekly = (await bookService(alpha, karen, { frequency: "weekly", start_date: rainDay })).id;
  });

  it("starts with 8am–4pm and the switch off, which only the owner can change", async () => {
    const read = async () =>
      (await alpha.client.from("businesses").select("work_start, work_end, rain_auto_move").eq("id", alpha.businessId).single()).data;
    expect(await read()).toEqual({ work_start: "08:00:00", work_end: "16:00:00", rain_auto_move: false });

    const byCrew = await crew.client.from("businesses").update({ rain_auto_move: true }).eq("id", alpha.businessId).select("id");
    expect(byCrew.data ?? []).toHaveLength(0);
    const byOther = await bravo.client.from("businesses").update({ rain_auto_move: true }).eq("id", alpha.businessId).select("id");
    expect(byOther.data ?? []).toHaveLength(0);
    expect((await read())?.rain_auto_move).toBe(false);

    const bad = await alpha.client.from("businesses").update({ work_start: "15:00", work_end: "09:00" }).eq("id", alpha.businessId);
    expect(bad.error?.code).toBe(CHECK_VIOLATION);
    const ok = await alpha.client
      .from("businesses")
      .update({ work_start: "07:30", work_end: "15:30", rain_auto_move: true })
      .eq("id", alpha.businessId)
      .select("id");
    expect(ok.data).toHaveLength(1);
    expect(await read()).toEqual({ work_start: "07:30:00", work_end: "15:30:00", rain_auto_move: true });
  });

  it("lets only the owner move, only with the switch on, and refuses bad days", async () => {
    expect((await auto(crew)).error?.code).toBe(DENIED);
    expect((await auto(bravo)).error?.code).toBe(DENIED); // bravo's switch is off
    expect((await anonClient().rpc("auto_rain_move", { rain_day: rainDay, move_to: nextDay, rain_hours: "" })).error).not.toBeNull();
    expect((await auto(alpha, addDays(today, -1))).error?.code).toBe(INVALID);
    expect((await auto(alpha, addDays(today, 2), addDays(today, 3))).error?.code).toBe(INVALID);
    expect((await auto(alpha, rainDay, rainDay)).error?.code).toBe(INVALID);
    expect((await auto(alpha, rainDay, addDays(rainDay, 8))).error?.code).toBe(INVALID);
    expect((await auto(alpha, rainDay, nextDay, "x".repeat(61))).error?.code).toBe(INVALID);
  });

  it("moves the day's repeat visits once, and leaves one-time jobs", async () => {
    const { data: delayId, error } = await auto(alpha);
    expect(error).toBeNull();
    expect(delayId).toMatch(/^[0-9a-f-]{36}$/);

    const [john] = await visitsFor(alpha, mowing);
    const [karen, karenNext] = await visitsFor(alpha, weekly);
    const [hedge] = await visitsFor(alpha, hedges);
    expect([john.scheduled_date, karen.scheduled_date, hedge.scheduled_date]).toEqual([nextDay, nextDay, rainDay]);
    expect(john.status).toBe("weather_delay");
    expect(john.notes).toMatch(/^Moved from \w{3}, \w{3} \d{1,2} due to rain \(likely 10am–2pm\)$/);
    expect(karenNext.scheduled_date).toBe(addDays(rainDay, 7));

    const { data: delay } = await alpha.client.from("rain_delays").select("automatic, rain_window").eq("id", delayId!).single();
    expect(delay).toEqual({ automatic: true, rain_window: "10am–2pm" });
    expect((await crew.client.from("rain_delays").select("id")).data).toEqual([]);

    // Asking again for the same day does nothing.
    expect((await auto(alpha, rainDay, addDays(rainDay, 2))).data).toBeNull();
    expect((await visitsFor(alpha, mowing))[0].scheduled_date).toBe(nextDay);
  });

  it("undoes a rain delay while its day is ahead, for the owner only", async () => {
    const { data: delay } = await alpha.client.from("rain_delays").select("id").eq("automatic", true).single();
    expect((await crew.client.rpc("undo_rain_delay", { rain_delay_id: delay!.id })).error?.code).toBe(DENIED);
    expect((await bravo.client.rpc("undo_rain_delay", { rain_delay_id: delay!.id })).error?.code).toBe(NOT_FOUND);

    const { data: back, error } = await alpha.client.rpc("undo_rain_delay", { rain_delay_id: delay!.id });
    expect(error).toBeNull();
    expect(back).toBe(2);
    const [john] = await visitsFor(alpha, mowing);
    expect([john.scheduled_date, john.status, john.notes]).toEqual([rainDay, "scheduled", ""]);

    expect((await alpha.client.rpc("undo_rain_delay", { rain_delay_id: delay!.id })).error?.code).toBe(INVALID);
    // The app doesn't move that day again on its own.
    expect((await auto(alpha)).data).toBeNull();
    expect((await visitsFor(alpha, mowing))[0].scheduled_date).toBe(rainDay);
  });

  it("undoes a day moved by hand, putting statuses back", async () => {
    const { data: delayId, error } = await alpha.client.rpc("move_day_visits", { from_date: rainDay, to_date: addDays(rainDay, 2) });
    expect(error).toBeNull();
    const { data: back } = await alpha.client.rpc("undo_rain_delay", { rain_delay_id: delayId! });
    expect(back).toBe(3);
    const [hedge] = await visitsFor(alpha, hedges);
    expect([hedge.scheduled_date, hedge.status]).toEqual([rainDay, "scheduled"]);
  });
});
