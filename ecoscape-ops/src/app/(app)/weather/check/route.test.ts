import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DayRain } from "@/lib/weather/hourly";

// The automatic rain check, with the sign-in, database and forecast stood in for.
const state = vi.hoisted(() => ({
  user: { id: "u1", email: "kyle@example.test" } as { id: string; email: string } | null,
  role: "owner" as "owner" | "crew",
  autoMove: true,
  rain: [] as DayRain[],
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getUser: async () => state.user }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { role: state.role, business: { id: "b1", time_zone: "America/New_York" } }, error: null }),
        }),
      }),
    }),
    rpc: state.rpc,
  }),
}));
vi.mock("@/lib/weather/queries", () => ({
  getWorkSettings: async () => ({ work: { start: 480, end: 960 }, autoMove: state.autoMove }),
  getWorkdayRain: async () => ({ status: "ok", work: { start: 480, end: 960 }, days: state.rain }),
}));

import { POST } from "./route";

const wet = (date: string): DayRain => ({ date, windows: [{ start: 600, end: 840 }], chance: 80, covered: true, snow: false });
const dry = (date: string): DayRain => ({ date, windows: [], chance: 10, covered: true, snow: false });
const post = (headers: Record<string, string> = { origin: "https://ops.example.com", host: "ops.example.com" }) =>
  POST(new NextRequest("https://ops.example.com/weather/check", { method: "POST", headers }));
const answer = async (response: Response) => [response.status, await response.json()];
// Sunday Nov 8, 2026, 6pm in New York: the evening before Monday.
const SUNDAY_EVENING = new Date("2026-11-08T18:00:00-05:00");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUNDAY_EVENING);
  state.user = { id: "u1", email: "kyle@example.test" };
  state.role = "owner";
  state.autoMove = true;
  state.rain = [wet("2026-11-09"), dry("2026-11-10")];
  state.rpc.mockReset().mockResolvedValue({ data: "d1", error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the automatic rain check", () => {
  it("moves a rainy Monday's repeat visits to Tuesday the evening before", async () => {
    expect(await answer(await post())).toEqual([200, { moved: true }]);
    expect(state.rpc).toHaveBeenCalledWith("auto_rain_move", { rain_day: "2026-11-09", move_to: "2026-11-10", rain_hours: "10am–2pm" });
  });

  it("skips a wet Tuesday too", async () => {
    state.rain = [wet("2026-11-09"), wet("2026-11-10"), dry("2026-11-11")];
    await post();
    expect(state.rpc.mock.calls[0][1].move_to).toBe("2026-11-11");
  });

  it("checks the same day in the morning before work", async () => {
    vi.setSystemTime(new Date("2026-11-09T07:00:00-05:00"));
    await post();
    expect(state.rpc.mock.calls[0][1].rain_day).toBe("2026-11-09");
  });

  it("does nothing during the work day, on a dry day, or when the day was already handled", async () => {
    vi.setSystemTime(new Date("2026-11-09T10:00:00-05:00"));
    expect(await answer(await post())).toEqual([200, { moved: false }]);
    vi.setSystemTime(SUNDAY_EVENING);
    state.rain = [dry("2026-11-09")];
    expect(await answer(await post())).toEqual([200, { moved: false }]);
    expect(state.rpc).not.toHaveBeenCalled();

    state.rain = [wet("2026-11-09")];
    state.rpc.mockResolvedValue({ data: null, error: null });
    expect(await answer(await post())).toEqual([200, { moved: false }]);
  });

  it("only runs for an owner who turned it on", async () => {
    state.autoMove = false;
    expect(await answer(await post())).toEqual([200, { moved: false }]);
    state.autoMove = true;
    state.role = "crew";
    expect(await answer(await post())).toEqual([200, { moved: false }]);
    state.user = null;
    expect((await post()).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("refuses requests from other sites", async () => {
    expect((await post({ origin: "https://evil.example.com", host: "ops.example.com" })).status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("says so when the database refuses", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "turned off" } });
    expect(await answer(await post())).toEqual([500, { moved: false }]);
  });
});
