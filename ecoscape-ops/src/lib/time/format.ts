// Time entries are stored as exact moments and shown in the business's own time zone.

export function formatHours(hours: number): string {
  return `${hours.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} h`;
}

export function formatClock(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
}

export function formatDateTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// The value for a <input type="datetime-local"> showing that moment on the business's clock.
export function toLocalInput(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(iso))
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// A datetime-local value as the plain timestamp the database converts using the business's zone
// (so daylight-saving changes come out right). Anything else is rejected.
export function localInputToTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !LOCAL_INPUT.test(value)) return null;
  if (Number.isNaN(Date.parse(`${value}:00Z`))) return null;
  return `${value.replace("T", " ")}:00`;
}
