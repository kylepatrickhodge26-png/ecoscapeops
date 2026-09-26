import { describe, expect, it } from "vitest";

import { JOB_STATUSES, isOverdue, matchesFilter, needsAttention, type JobStatus } from "./constants";

const TODAY = "2026-09-26";
const job = (status: JobStatus, scheduled_date: string) => ({ status, scheduled_date });

describe("schedule filters", () => {
  it("Upcoming: today or later, and not completed or cancelled", () => {
    expect(matchesFilter(job("scheduled", TODAY), "upcoming", TODAY)).toBe(true);
    expect(matchesFilter(job("weather_delay", "2026-10-01"), "upcoming", TODAY)).toBe(true);
    expect(matchesFilter(job("completed", TODAY), "upcoming", TODAY)).toBe(false);
    expect(matchesFilter(job("cancelled", "2026-10-01"), "upcoming", TODAY)).toBe(false);
    expect(matchesFilter(job("scheduled", "2026-09-25"), "upcoming", TODAY)).toBe(false);
  });

  it("Today: every visit dated today, whatever its status", () => {
    for (const status of JOB_STATUSES) expect(matchesFilter(job(status, TODAY), "today", TODAY)).toBe(true);
    expect(matchesFilter(job("scheduled", "2026-09-27"), "today", TODAY)).toBe(false);
  });

  it("Completed: only completed visits", () => {
    expect(JOB_STATUSES.filter((s) => matchesFilter(job(s, TODAY), "completed", TODAY))).toEqual(["completed"]);
  });

  it("Needs attention: unable to complete, weather delay, or overdue", () => {
    expect(needsAttention(job("unable_to_complete", "2026-10-01"), TODAY)).toBe(true);
    expect(needsAttention(job("weather_delay", "2026-10-01"), TODAY)).toBe(true);
    expect(needsAttention(job("scheduled", "2026-09-25"), TODAY)).toBe(true);
    expect(needsAttention(job("in_progress", "2026-09-20"), TODAY)).toBe(true);

    expect(needsAttention(job("scheduled", TODAY), TODAY)).toBe(false);
    expect(needsAttention(job("completed", "2026-09-20"), TODAY)).toBe(false);
    expect(needsAttention(job("cancelled", "2026-09-20"), TODAY)).toBe(false);
  });

  it("a visit is overdue only once its day has passed without being closed out", () => {
    expect(isOverdue(job("scheduled", "2026-09-25"), TODAY)).toBe(true);
    expect(isOverdue(job("scheduled", TODAY), TODAY)).toBe(false);
    expect(isOverdue(job("completed", "2026-09-25"), TODAY)).toBe(false);
  });

  it("All: everything", () => {
    expect(JOB_STATUSES.every((s) => matchesFilter(job(s, "2020-01-01"), "all", TODAY))).toBe(true);
  });
});
