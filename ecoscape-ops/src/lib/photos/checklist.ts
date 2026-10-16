import { z } from "zod";

// One checklist item per line, up to the database's limits (30 items, 120 characters each).
export const MAX_CHECKLIST_ITEMS = 30;
export const MAX_ITEM_LENGTH = 120;

export function parseChecklistLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line !== "");
}

export const checklistSchema = z.object({
  service_name: z.string().trim().min(1, "Enter the service this checklist is for").max(100, "The name must be 100 characters or fewer"),
  items: z
    .array(z.string().max(MAX_ITEM_LENGTH, `Each item must be ${MAX_ITEM_LENGTH} characters or fewer`))
    .max(MAX_CHECKLIST_ITEMS, `A checklist can have at most ${MAX_CHECKLIST_ITEMS} items`),
});
