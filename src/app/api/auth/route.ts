import { NextResponse } from "next/server";
import { createAuthToken, checkRateLimit, getAuthCookieName } from "@/lib/auth";

export async function POST(request: Request) {
  // Fail closed: no committed default password (WEBDEV-211).
  if (!process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a minute." },
      { status: 429 },
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.password !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cookie value is HMAC(password, context) — unforgeable without the secret.
  const token = await createAuthToken(process.env.DASHBOARD_PASSWORD);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(getAuthCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });

  return response;
}
