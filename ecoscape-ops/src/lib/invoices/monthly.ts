import { addMonths, isISODate, monthOf } from "@/lib/dates";

// The months the "Generate invoices" button offers: this month and the last few, so on the
// 1st you can bill the month that just ended. Values are the first day of the month.
export function monthlyOptions(today: string, count = 4): string[] {
  const options: string[] = [];
  for (let i = 0; i < count; i++) {
    const month = addMonths(monthOf(today), -i);
    options.push(`${month}-01`);
  }
  return options;
}

// A month typed or posted by the form: must be a real first-of-month date, not in the future.
export function parseBillingMonth(value: unknown, today: string): string | null {
  if (!isISODate(value) || !value.endsWith("-01")) return null;
  return value.slice(0, 7) > monthOf(today) ? null : value;
}

export function describeRun(created: number, added: number, visits: number): string {
  if (created === 0 && added === 0) return "Nothing to bill: no monthly customer has completed visits waiting for that month.";
  const parts: string[] = [];
  if (created > 0) parts.push(`${created} ${created === 1 ? "draft invoice" : "draft invoices"} made`);
  if (added > 0) parts.push(`${added} existing ${added === 1 ? "draft" : "drafts"} updated`);
  return `${parts.join(" and ")}, covering ${visits} ${visits === 1 ? "visit" : "visits"}. Review them, then send.`;
}
