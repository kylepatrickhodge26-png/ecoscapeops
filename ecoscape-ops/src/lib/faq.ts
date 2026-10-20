import { z } from "zod";

// The questions and answers an owner writes for their customers. Limits mirror the
// faq_items table, so a mistake gets a friendly message instead of a database error.
export const FAQ_QUESTION_MAX = 200;
export const FAQ_ANSWER_MAX = 2000;
export const FAQ_MAX_ITEMS = 50;

export const faqSchema = z.object({
  question: z.string().trim().min(1, "Write the question").max(FAQ_QUESTION_MAX, `Keep the question under ${FAQ_QUESTION_MAX} characters`),
  answer: z.string().trim().min(1, "Write the answer").max(FAQ_ANSWER_MAX, `Keep the answer under ${FAQ_ANSWER_MAX} characters`),
});

export type FaqValues = { question: string; answer: string };
export type FaqField = keyof FaqValues;

export function parseFaq(values: FaqValues): { success: true; data: FaqValues } | { success: false; fieldErrors: Partial<Record<FaqField, string>> } {
  const result = faqSchema.safeParse(values);
  if (result.success) return { success: true, data: result.data };
  const fieldErrors: Partial<Record<FaqField, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as FaqField;
    fieldErrors[field] ??= issue.message;
  }
  return { success: false, fieldErrors };
}

// Questions customers often ask, to start from. The owner writes their own answers.
export const FAQ_SUGGESTIONS = [
  "What happens if it rains?",
  "How do I pay?",
  "Do I need to be home?",
  "What's included in a mow?",
  "How do I skip or cancel a visit?",
  "When does the season start and end?",
  "Do you take away the clippings and leaves?",
];

// The suggestions the owner hasn't used yet.
export function unusedSuggestions(existing: string[]): string[] {
  const have = new Set(existing.map((q) => q.trim().toLowerCase()));
  return FAQ_SUGGESTIONS.filter((s) => !have.has(s.toLowerCase()));
}
