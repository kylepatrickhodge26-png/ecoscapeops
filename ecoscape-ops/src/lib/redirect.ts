// Only allow redirects to paths on this site, never to another origin
// ("//evil.com" and "/\evil.com" are treated as absolute URLs by browsers).
export function safeNextPath(value: FormDataEntryValue | string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}
