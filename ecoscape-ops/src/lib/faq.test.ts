import { describe, expect, it } from "vitest";

import { FAQ_SUGGESTIONS, parseFaq, unusedSuggestions } from "./faq";

describe("customer FAQ", () => {
  it("needs a question and an answer, within the limits", () => {
    expect(parseFaq({ question: "  How do I pay? ", answer: " Venmo " })).toEqual({ success: true, data: { question: "How do I pay?", answer: "Venmo" } });
    expect(parseFaq({ question: " ", answer: "" })).toEqual({ success: false, fieldErrors: { question: "Write the question", answer: "Write the answer" } });
    const long = parseFaq({ question: "x".repeat(201), answer: "y".repeat(2001) });
    expect(long.success).toBe(false);
    if (!long.success) expect(Object.keys(long.fieldErrors).sort()).toEqual(["answer", "question"]);
  });

  it("only suggests questions the owner hasn't added", () => {
    expect(unusedSuggestions([])).toEqual(FAQ_SUGGESTIONS);
    expect(unusedSuggestions([" how do I PAY? "])).not.toContain("How do I pay?");
  });
});
