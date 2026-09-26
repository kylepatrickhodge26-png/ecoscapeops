import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { JOB_STATUSES } from "@/lib/schedule/constants";

import { STATUS_SHAPES } from "./job-status";

describe("job status visuals", () => {
  it("gives every status its own shape", () => {
    const shapes = JOB_STATUSES.map((s) => STATUS_SHAPES[s]);
    expect(new Set(shapes).size).toBe(JOB_STATUSES.length);
  });

  it("gives every status its own color, in both light and dark themes", () => {
    const css = readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");
    const colorsIn = (block: string) =>
      JOB_STATUSES.map((s) => block.match(new RegExp(`--status-${s}:\\s*(#[0-9a-f]{6})`, "i"))?.[1]?.toLowerCase());

    const light = css.slice(css.indexOf("/* ---------- Job statuses"));
    const dark = light.slice(light.indexOf(":root[data-theme=\"dark\"]"));
    for (const colors of [colorsIn(light), colorsIn(dark)]) {
      expect(colors.every(Boolean)).toBe(true);
      expect(new Set(colors).size).toBe(JOB_STATUSES.length);
    }
  });
});
