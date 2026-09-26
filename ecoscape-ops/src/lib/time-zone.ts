export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// The browser's time zone from a form's hidden time_zone field, if it's a real one.
// (The database falls back to America/New_York otherwise.)
export function timeZoneFromFormData(formData: FormData): string | undefined {
  const value = formData.get("time_zone");
  return isValidTimeZone(value) ? value : undefined;
}
