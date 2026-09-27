import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except Next.js internals, static files, and Twilio's webhooks (which
    // have no session; they check Twilio's signature instead).
    "/((?!_next/static|_next/image|favicon.ico|api/twilio/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
