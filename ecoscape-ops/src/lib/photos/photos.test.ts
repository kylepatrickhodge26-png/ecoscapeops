import { describe, expect, it } from "vitest";

import { fitWithin, formatBytes, photoPath } from "./constants";

describe("photo sizing", () => {
  it("shrinks the longer side to the limit and keeps the shape", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });
  it("never enlarges", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });
  it("never goes to zero", () => {
    expect(fitWithin(100000, 1, 1600).height).toBe(1);
  });
});

describe("photo paths and sizes", () => {
  it("builds the business/job/file path the storage rules expect", () => {
    const biz = "6f4c1a52-3e7b-4a63-8d2a-0b9d6a1c7e11";
    const job = "1b9d6a1c-7e11-4a63-8d2a-6f4c1a523e7b";
    const path = photoPath(biz, job, "abc");
    expect(path).toBe(`${biz}/${job}/abc.jpg`);
    expect(path).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,100}$/);
  });
  it("formats sizes", () => {
    expect(formatBytes(500)).toBe("0 KB");
    expect(formatBytes(250_000)).toBe("244 KB");
    expect(formatBytes(3_250_000)).toBe("3.1 MB");
    expect(formatBytes(1_200_000_000)).toBe("1.12 GB");
  });
});
