import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import { config } from "@/proxy";

const root = process.cwd();
const sw = readFileSync(join(root, "public/sw.js"), "utf8");

describe("installable app", () => {
  it("has a standalone manifest with real icon files", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    for (const icon of m.icons ?? []) {
      expect(() => readFileSync(join(root, "public", icon.src))).not.toThrow();
    }
    expect(m.icons?.some((i) => i.sizes === "192x192")).toBe(true);
    expect(m.icons?.some((i) => i.sizes === "512x512")).toBe(true);
  });

  it("service worker never caches private data: only the offline page is ever stored", () => {
    // The only thing added to a cache is the fixed offline page.
    expect(sw.match(/cache\.add\(/g)).toHaveLength(1);
    expect(sw).toContain("cache.add(OFFLINE_URL)");
    expect(sw).not.toMatch(/\.put\(|\.addAll\(/);
    // It only ever answers page navigations, never API/data requests.
    expect(sw).toContain('event.request.mode !== "navigate"');
    expect(sw).toMatch(/fetch\(event\.request\)\.catch/);
  });

  it("offline page exists and contains no app data", () => {
    const html = readFileSync(join(root, "public/offline.html"), "utf8");
    expect(html).toContain("offline");
    expect(html).not.toMatch(/supabase|customer|invoice/i);
  });

  it("serves the worker, manifest and offline page without requiring sign-in", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/sw.js", "/offline.html", "/manifest.webmanifest", "/icons/icon-192.png"]) {
      expect(re.test(path), path).toBe(false);
    }
    // Real pages still go through the sign-in check.
    for (const path of ["/", "/customers", "/schedule/day/2026-10-14", "/pay/abc"]) {
      expect(re.test(path), path).toBe(true);
    }
  });
});
