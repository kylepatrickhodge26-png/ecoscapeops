import { describe, expect, it } from "vitest";

import { isPastDueDraft } from "./constants";

describe("drafts past their due date", () => {
  it("flags a draft whose due date has passed", () => {
    expect(isPastDueDraft({ status: "draft", due_date: "2026-11-03" }, "2026-11-05")).toBe(true);
    expect(isPastDueDraft({ status: "draft", due_date: "2026-11-04" }, "2026-11-05")).toBe(true);
  });
  it("doesn't flag a draft due today or later", () => {
    expect(isPastDueDraft({ status: "draft", due_date: "2026-11-05" }, "2026-11-05")).toBe(false);
    expect(isPastDueDraft({ status: "draft", due_date: "2026-11-19" }, "2026-11-05")).toBe(false);
  });
  it("leaves sent and cancelled invoices alone", () => {
    expect(isPastDueDraft({ status: "sent", due_date: "2026-11-03" }, "2026-11-05")).toBe(false);
    expect(isPastDueDraft({ status: "cancelled", due_date: "2026-11-03" }, "2026-11-05")).toBe(false);
  });
});
