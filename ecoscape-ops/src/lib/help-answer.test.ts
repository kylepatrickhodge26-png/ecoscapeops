import { describe, expect, it } from "vitest";

import { HELP_TOPICS, helpFor } from "./help";
import { answerFor, helpMatches, keywordTopicIds, POPULAR_QUESTIONS, stem, terms } from "./help-answer";
import { searchHelp } from "./help";

const top = (q: string, role: "owner" | "crew" = "owner") => answerFor(q, role)[0]?.id;
const ids = (q: string, role: "owner" | "crew" = "owner") => answerFor(q, role).map((t) => t.id);

describe("asking Help a question", () => {
  it("understands everyday wording, not just the app's words", () => {
    const cases: [string, string][] = [
      ["how do i delay a client", "move"],
      ["we had to push john to wednesday", "move"],
      ["how do I bill someone", "invoice"],
      ["how do customers pay me", "get-paid"],
      ["send an estimate", "quote"],
      ["my guy forgot to clock out", "forgot-clock-out-owner"],
      ["add a worker", "add-crew"],
      ["hours for payroll", "payroll"],
      ["raise a customer's price", "change-price"],
      ["log gas", "expenses"],
      ["put the app on my phone", "home-screen"],
      ["what day does a customer get mowed", "customer-day"],
      ["I marked a lawn done by accident", "undo-completed"],
      ["skip one visit", "cancel-visit"],
      ["customer is done for the season", "stop-service"],
      ["how much money did I make", "reports"],
      ["what does overdue mean", "overdue"],
      ["delete a client", "delete-customer"],
      ["can my customers log in", "customer-account"],
      ["they paid me cash", "record-payment"],
    ];
    for (const [q, want] of cases) expect(top(q), q).toBe(want);
  });

  it("doesn't confuse moving a job with a work shift", () => {
    expect(ids("how do i delay a client")).not.toContain("workday");
  });

  it("offers the rain-day answer when it rains", () => {
    expect(ids("it's raining, what do I do with today's jobs")).toContain("move");
  });

  it("answers crew questions for crew, and never shows them money topics", () => {
    expect(top("how do i clock in", "crew")).toBe("clock-in");
    expect(top("I finished a job by mistake", "crew")).toBe("undo-crew");
    expect(top("where are my jobs this week", "crew")).toBe("my-jobs");
    const owner = new Set(helpFor("owner").filter((t) => !t.for.includes("crew")).map((t) => t.id));
    for (const q of ["how do I send an invoice", "how do customers pay me", "raise the price", "hours for payroll"]) {
      for (const id of ids(q, "crew")) expect(owner.has(id), `${q} -> ${id}`).toBe(false);
    }
  });

  it("says nothing rather than something unrelated", () => {
    expect(ids("zzzz qqqq")).toEqual([]);
    expect(ids("how do I")).toEqual([]);
    expect(ids("   ")).toEqual([]);
    expect(ids("pizza")).toEqual([]);
  });

  it("shows at most three answers, best first", () => {
    expect(answerFor("customer", "owner").length).toBeLessThanOrEqual(3);
    expect(answerFor("how do I move a job to another day?", "owner")[0].id).toBe("move");
  });

  it("stems words so different forms match", () => {
    expect(stem("booking")).toBe(stem("book"));
    expect(stem("booked")).toBe(stem("books"));
    expect(stem("cancelled")).toBe(stem("cancel"));
    expect(stem("invoices")).toBe(stem("invoice"));
    expect(stem("scheduled")).toBe(stem("schedule"));
    expect(stem("moving")).toBe(stem("move"));
    expect(terms("How do I add a customer?")).toEqual(["add", stem("customer")]);
  });

  it("only has extra keywords for topics that exist", () => {
    const known = new Set(HELP_TOPICS.map((t) => t.id));
    for (const id of keywordTopicIds()) expect(known.has(id), id).toBe(true);
  });

  it("keeps the search box's exact matches, and answers questions when there are none", () => {
    expect(helpMatches("clock out", "owner")).toEqual(searchHelp("clock out", "owner"));
    expect(helpMatches("delay a client", "owner").map((t) => t.id)).toContain("move");
    expect(helpMatches("Smith", "owner")).toEqual([]);
  });

  it("suggests questions each person can actually see", () => {
    for (const role of ["owner", "crew"] as const) {
      const visible = new Set(helpFor(role).map((t) => t.id));
      for (const id of POPULAR_QUESTIONS[role]) expect(visible.has(id), `${role}: ${id}`).toBe(true);
    }
  });
});
