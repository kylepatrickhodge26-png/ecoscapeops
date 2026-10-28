import { describe, expect, it } from "vitest";

import { dayChoices, movedIds, movedText, suggestedDay, weekdayName } from "./move";

describe("moving visits", () => {
  it("offers Today, Tomorrow and the rest of the week, skipping the visit's own day", () => {
    const choices = dayChoices("2026-10-27", "2026-10-29");
    expect(choices.map((c) => c.label)).toEqual(["Today", "Tomorrow", "Fri 30", "Sat 31", "Sun 1", "Mon 2"]);
    expect(choices[0].date).toBe("2026-10-27");
    expect(dayChoices("2026-10-27", null)).toHaveLength(7);
  });

  it("names weekdays", () => {
    expect(weekdayName("2026-10-28")).toBe("Wednesday");
  });

  it("suggests tomorrow, or the day after a later visit", () => {
    expect(suggestedDay("2026-10-27", "2026-10-27")).toBe("2026-10-28");
    expect(suggestedDay("2026-10-27", "2026-10-28")).toBe("2026-10-29");
    expect(suggestedDay("2026-10-27", "2026-11-02")).toBe("2026-11-03");
    expect(suggestedDay("2026-10-27", "2026-10-20")).toBe("2026-10-28");
  });

  it("keeps only real ids from the link", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(movedIds(`${id},nope,${id}x`)).toEqual([id]);
    expect(movedIds(undefined)).toEqual([]);
    expect(movedIds(["a"])).toEqual([]);
  });

  it("writes a short text for the customer", () => {
    expect(movedText({ firstName: "John", businessName: "EcoScape", service: "Mowing", date: "2026-10-28" })).toBe(
      "Hi John, it's EcoScape. We've moved your mowing to Wednesday, October 28. Thanks!",
    );
    expect(movedText({ firstName: " ", businessName: "EcoScape", service: "Mowing", date: "2026-10-28" })).toMatch(/^Hi, it's/);
  });
});
