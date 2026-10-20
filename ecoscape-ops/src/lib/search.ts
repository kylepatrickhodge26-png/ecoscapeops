// The owner's search: what was typed, cleaned up the same way the database does, and the
// results grouped for the page.

export const SEARCH_MAX_LENGTH = 100;
export const SEARCH_MIN_LENGTH = 2;

export type SearchKind = "customer" | "visit" | "quote" | "invoice" | "request";

export type SearchHit = {
  kind: string;
  id: string;
  title: string;
  detail: string | null;
  on_date: string | null;
  status: string | null;
  amount: number | null;
  number: number | null;
};

export const SEARCH_GROUPS: { kind: SearchKind; label: string }[] = [
  { kind: "customer", label: "Customers" },
  { kind: "visit", label: "Visits" },
  { kind: "quote", label: "Quotes" },
  { kind: "invoice", label: "Invoices" },
  { kind: "request", label: "Requests" },
];

export function cleanSearchTerm(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH);
}

export function groupHits(hits: SearchHit[]): { kind: SearchKind; label: string; hits: SearchHit[] }[] {
  return SEARCH_GROUPS.map((g) => ({ ...g, hits: hits.filter((h) => h.kind === g.kind) })).filter((g) => g.hits.length > 0);
}

// Where each kind of result opens.
export function hitHref(hit: Pick<SearchHit, "kind" | "id">): string {
  switch (hit.kind) {
    case "customer":
      return `/customers/${hit.id}`;
    case "visit":
      return `/schedule/jobs/${hit.id}`;
    case "quote":
      return `/quotes/${hit.id}`;
    case "invoice":
      return `/invoices/${hit.id}`;
    default:
      return "/requests";
  }
}
