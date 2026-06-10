import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAuthToken, getAuthCookieName } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page, API routes, and static assets. API routes are NOT gated
  // here — each handler enforces its own auth (the /api/auth login endpoint
  // must stay reachable, and /api/airtable + /api/chat verify the HMAC cookie
  // server-side via isAuthenticatedRequest).
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // WEBDEV-211: verify the HMAC session cookie instead of the old forgeable
  // `=== "authenticated"` literal. Fail closed when the secret is unset.
  const password = process.env.DASHBOARD_PASSWORD;
  const token = request.cookies.get(getAuthCookieName())?.value ?? "";
  if (!password || !(await verifyAuthToken(token, password))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
