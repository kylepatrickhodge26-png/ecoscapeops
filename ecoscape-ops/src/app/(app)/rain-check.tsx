"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Runs the automatic rain check (see weather/check/route.ts) when the owner opens the app and
// when they come back to it, at most every 10 minutes. If visits moved, the page reloads its
// data so the schedule and the rain notice show it. Renders nothing.
const KEY = "rain-check-at";
const EVERY_MS = 10 * 60_000;
let lastCheck = 0;

function due(): boolean {
  let last = lastCheck;
  try {
    last = Math.max(last, Number(sessionStorage.getItem(KEY) ?? 0) || 0);
  } catch {
    // Storage blocked: the in-memory time still keeps it from running too often.
  }
  if (Date.now() - last < EVERY_MS) return false;
  lastCheck = Date.now();
  try {
    sessionStorage.setItem(KEY, String(lastCheck));
  } catch {
    // As above.
  }
  return true;
}

export function RainCheck() {
  const router = useRouter();

  useEffect(() => {
    async function check() {
      if (!due()) return;
      try {
        const response = await fetch("/weather/check", { method: "POST" });
        const result = response.ok ? ((await response.json()) as { moved?: boolean }) : null;
        if (result?.moved) router.refresh();
      } catch {
        // Offline, or the server is busy: the next visit tries again.
      }
    }
    function onVisible() {
      if (document.visibilityState === "visible") void check();
    }
    void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  return null;
}
