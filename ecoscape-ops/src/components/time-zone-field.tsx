"use client";

import { useEffect, useRef } from "react";

// Hidden field carrying the browser's time zone, so the business's "today" matches
// where the owner actually is.
export function TimeZoneField() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }, []);
  return <input ref={ref} type="hidden" name="time_zone" defaultValue="" />;
}
