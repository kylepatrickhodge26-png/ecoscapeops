"use client";

import { useEffect, useState } from "react";

import { formatElapsed } from "@/lib/time/format";

// "3h 05m" since a moment, kept up to date while the page is open.
export function LiveTimer({ since, className }: { since: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className={className} data-testid="live-timer" suppressHydrationWarning>
      {formatElapsed(now - new Date(since).getTime())}
    </span>
  );
}
