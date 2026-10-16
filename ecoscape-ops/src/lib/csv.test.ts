import { describe, expect, it } from "vitest";

import { csvCell, neutralizeFormula, toCsv } from "./csv";

describe("csv", () => {
  it("neutralizes anything a spreadsheet would run as a formula", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1", "=HYPERLINK(\"http://evil\",\"x\")", "-2+3+cmd|' /C calc'!A0"]) {
      expect(neutralizeFormula(bad).startsWith("'")).toBe(true);
    }
  });
  it("leaves ordinary text alone", () => {
    expect(neutralizeFormula("Spring cleanup")).toBe("Spring cleanup");
    expect(neutralizeFormula("12 Oak St = home")).toBe("12 Oak St = home");
    expect(neutralizeFormula("")).toBe("");
  });
  it("writes real numbers as numbers, even negative ones", () => {
    expect(csvCell(-12.5)).toBe("-12.5");
    expect(csvCell(65)).toBe("65");
    expect(csvCell(Number.NaN)).toBe("");
  });
  it("neutralizes text that only looks like a number", () => {
    expect(csvCell("-12.5")).toBe("'-12.5");
  });
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
  it("neutralizes before quoting", () => {
    expect(csvCell('=A1,"x"')).toBe('"\'=A1,""x"""');
  });
  it("handles empties and booleans", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("yes");
    expect(csvCell(false)).toBe("no");
  });
  it("builds a file with a header and CRLF rows", () => {
    expect(toCsv(["a", "b"], [["=x", 1]])).toBe("﻿a,b\r\n'=x,1\r\n");
  });
});
