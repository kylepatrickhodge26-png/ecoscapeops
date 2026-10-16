// CSV for the accountant. Spreadsheet programs run any cell that starts with = + - @ (or a
// tab or carriage return) as a formula, so text from customers, notes or form submissions could
// run commands or leak data when the file is opened. Text cells that start that way get a
// leading apostrophe, which makes the spreadsheet show them as plain text. Real numbers (money,
// counts) come from the database as numbers and are written as they are.

export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "number") text = Number.isFinite(value) ? String(value) : "";
  else if (typeof value === "boolean") text = value ? "yes" : "no";
  else text = neutralizeFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// A header row, then one row per record. A byte-order mark first so Excel reads accents right.
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
