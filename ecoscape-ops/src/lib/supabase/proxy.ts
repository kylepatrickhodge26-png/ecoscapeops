import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "./database.types";
import { supabasePublishableKey, supabaseUrl } from "./env";

// Pages anyone can open without signing in. /pay is a customer's invoice pay link.
const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/join", "/pay"];
// Pages a signed-in user has no reason to see.
const SIGNED_OUT_ONLY_PATHS = ["/login", "/signup"];

const matches = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

// Refreshes the auth session cookie on every request and bounces signed-out users to
// /login. This is a convenience layer only; pages and server actions re-check auth,
// and row-level security in the database is what actually isolates tenants.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  // No-cache headers Supabase asks for whenever auth cookies change; they must go on
  // whichever response we end up returning.
  let authHeaders: Record<string, string> = {};

  const supabase = createServerClient<Database>(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        authHeaders = headers;
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Don't put code between createServerClient and getClaims(): getClaims() is what
  // refreshes an expired session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;

  if (!signedIn && !matches(pathname, PUBLIC_PATHS)) {
    return redirectPreservingSession(request, response, authHeaders, "/login", pathname === "/" ? null : pathname);
  }
  if (signedIn && matches(pathname, SIGNED_OUT_ONLY_PATHS)) {
    return redirectPreservingSession(request, response, authHeaders, "/");
  }

  return response;
}

function redirectPreservingSession(
  request: NextRequest,
  sessionResponse: NextResponse,
  authHeaders: Record<string, string>,
  to: string,
  next?: string | null,
) {
  const url = request.nextUrl.clone();
  url.pathname = to;
  url.search = "";
  if (next) url.searchParams.set("next", next);

  const redirect = NextResponse.redirect(url);
  sessionResponse.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  Object.entries(authHeaders).forEach(([key, value]) => redirect.headers.set(key, value));
  return redirect;
}
