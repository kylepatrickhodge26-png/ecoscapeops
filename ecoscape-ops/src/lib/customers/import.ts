// Importing customers: a list pasted from a spreadsheet, or a spreadsheet saved as a CSV
// file, one customer per row. The same code builds the preview in the browser and the
// customers on the server, so what's shown is what's added.

export const IMPORT_ROLES = ["name", "first_name", "last_name", "phone", "email", "address", "city", "state", "zip", "notes", "skip"] as const;
export type ImportRole = (typeof IMPORT_ROLES)[number];
export const IMPORT_ROLE_LABELS: Record<ImportRole, string> = {
  name: "Full name",
  first_name: "First name",
  last_name: "Last name",
  phone: "Phone",
  email: "Email",
  address: "Street address",
  city: "Town or city",
  state: "State",
  zip: "ZIP code",
  notes: "Notes",
  skip: "Leave out",
};
export const isImportRole = (v: unknown): v is ImportRole => typeof v === "string" && (IMPORT_ROLES as readonly string[]).includes(v);

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_CHARS = 500_000;

export type ImportRow = {
  line: number;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  property_address: string;
  service_notes: string;
  // Something left out of this row (shown in the preview).
  warning?: string;
};
export type ImportSkip = { line: number; reason: string };
export type ImportResult = {
  roles: ImportRole[];
  hasHeader: boolean;
  columns: number;
  rows: ImportRow[];
  skipped: ImportSkip[];
};

// Mirrors the customers table's email check.
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;
const cut = (v: string, max: number) => v.trim().slice(0, max);

// Rows of cells. Tabs when it was copied from a spreadsheet; otherwise commas, with
// "quoted, values" and "" for a quote, as in a CSV file.
export function splitRows(text: string): string[][] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = clean.split("\n");
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  rows.push(row);
  return rows;
}

const HEADERS: [RegExp, ImportRole][] = [
  [/^(first|first ?name|given ?name|fname)$/i, "first_name"],
  [/^(last|last ?name|surname|family ?name|lname)$/i, "last_name"],
  [/^(name|full ?name|customer|client|customer ?name|client ?name|contact|contact ?name)$/i, "name"],
  [/(phone|mobile|cell|tel\b|number)/i, "phone"],
  [/e-?mail/i, "email"],
  [/^(address|street|street ?address|property|property ?address|service ?address|address ?1|address line ?1|location)$/i, "address"],
  [/^(city|town)$/i, "city"],
  [/^(state|st|province)$/i, "state"],
  [/^(zip|zip ?code|postal ?code|postcode)$/i, "zip"],
  [/(note|comment|gate|instruction|access)/i, "notes"],
];

export function roleFromHeader(cell: string): ImportRole | null {
  const word = cell.trim().replace(/[:#*]/g, "").trim();
  for (const [pattern, role] of HEADERS) if (pattern.test(word)) return role;
  return null;
}

// Column names in the first row: most of its cells name a column we know.
export function headerRoles(row: string[]): ImportRole[] | null {
  const roles = row.map(roleFromHeader);
  const known = roles.filter(Boolean).length;
  const filled = row.filter((c) => c !== "").length;
  if (known === 0 || known * 2 < filled) return null;
  return roles.map((r) => r ?? "skip");
}

const digitsOf = (v: string) => v.replace(/\D/g, "");
const looksLikePhone = (v: string) => digitsOf(v).length >= 7 && digitsOf(v).length <= 15 && !/[a-z]{3,}/i.test(v.replace(/\b(ext|x)\b/gi, ""));
const looksLikeEmail = (v: string) => v.includes("@");
const looksLikeAddress = (v: string) => /^\d+[a-z]?\s+\S+/i.test(v);
const looksLikeZip = (v: string) => /^\d{5}(-\d{4})?$/.test(v);
const looksLikeState = (v: string) => /^[A-Z]{2}$/i.test(v);

// No column names: guess each column from what's in it.
export function guessRoles(rows: string[][], columns: number): ImportRole[] {
  const roles: ImportRole[] = [];
  for (let c = 0; c < columns; c++) {
    const values = rows.map((r) => r[c] ?? "").filter((v) => v !== "");
    const most = (test: (v: string) => boolean) => values.length > 0 && values.filter(test).length * 2 > values.length;
    if (values.length === 0) roles.push("skip");
    else if (most(looksLikeEmail)) roles.push("email");
    else if (most(looksLikeZip)) roles.push("zip");
    else if (most(looksLikePhone)) roles.push("phone");
    else if (most(looksLikeAddress)) roles.push("address");
    else if (most(looksLikeState)) roles.push("state");
    else if (!roles.includes("name")) roles.push("name");
    else if (roles.includes("address") && !roles.includes("city")) roles.push("city");
    else roles.push("notes");
  }
  return roles;
}

// "John Smith" → John / Smith; "Smith, John" → John / Smith; "Cher" → Cher.
export function splitName(full: string): { first: string; last: string } {
  const name = full.trim().replace(/\s+/g, " ");
  const comma = name.match(/^([^,]+),\s*(.+)$/);
  if (comma) return { first: comma[2], last: comma[1] };
  const space = name.lastIndexOf(" ");
  return space > 0 ? { first: name.slice(0, space), last: name.slice(space + 1) } : { first: name, last: "" };
}

// The rows to add (and the ones left out), using the given columns, or ones worked out
// from the list itself.
export function buildImport(text: string, given?: { roles?: ImportRole[]; hasHeader?: boolean }): ImportResult {
  const all = splitRows(text.slice(0, MAX_IMPORT_CHARS));
  const columns = Math.max(0, ...all.map((r) => r.length));
  const detected = all.length > 0 ? headerRoles(all[0]) : null;
  const hasHeader = given?.hasHeader ?? detected !== null;
  const body = all.map((cells, i) => ({ cells, line: i + 1 })).slice(hasHeader ? 1 : 0);
  const filledRows = body.filter((r) => r.cells.some((c) => c !== ""));
  const roles: ImportRole[] =
    given?.roles && given.roles.length > 0
      ? Array.from({ length: columns }, (_, c) => given.roles?.[c] ?? "skip")
      : hasHeader && detected
        ? Array.from({ length: columns }, (_, c) => detected[c] ?? "skip")
        : guessRoles(
            filledRows.map((r) => r.cells),
            columns,
          );

  const rows: ImportRow[] = [];
  const skipped: ImportSkip[] = [];
  for (const { cells, line } of filledRows) {
    if (rows.length >= MAX_IMPORT_ROWS) {
      skipped.push({ line, reason: `Over the ${MAX_IMPORT_ROWS}-row limit` });
      continue;
    }
    const pick = (role: ImportRole) =>
      roles
        .map((r, c) => (r === role ? (cells[c] ?? "") : ""))
        .filter((v) => v !== "")
        .join(" ");
    let first = pick("first_name");
    let last = pick("last_name");
    const full = pick("name");
    if (full && !first && !last) ({ first, last } = splitName(full));
    else if (full && !first) first = full;
    const email = pick("email").toLowerCase();
    const town = [pick("city"), [pick("state").toUpperCase(), pick("zip")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const address = [pick("address"), town].filter(Boolean).join(", ");
    const row: ImportRow = {
      line,
      first_name: cut(first, 100),
      last_name: cut(last, 100),
      phone: cut(pick("phone"), 40),
      email: email && EMAIL_PATTERN.test(email) && email.length <= 254 ? email : "",
      property_address: cut(address, 300),
      service_notes: cut(pick("notes"), 2000),
    };
    if (email && !row.email) row.warning = `Email "${cut(email, 60)}" left out (it doesn't look like an email)`;
    if (!row.first_name && !row.last_name && !row.phone && !row.email) {
      skipped.push({ line, reason: "No name, phone or email" });
      continue;
    }
    rows.push(row);
  }
  return { roles, hasHeader, columns, rows, skipped };
}
