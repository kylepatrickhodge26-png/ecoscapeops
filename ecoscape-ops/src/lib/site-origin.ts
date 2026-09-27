import "server-only";

import { headers } from "next/headers";

// This site's origin (e.g. https://app.example.com), for links we hand out.
export async function siteOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}
