/**
 * Server-side (Node runtime) auth check for the API route handlers
 * (WEBDEV-211). Kept separate from ./auth because it imports next/headers,
 * which is not available in the Edge middleware bundle. Both /api/airtable and
 * /api/chat call this instead of the old forgeable
 * `cookie === "authenticated"` literal.
 */
import { cookies } from "next/headers";
import { verifyAuthToken, getAuthCookieName } from "./auth";

/** True only when the request carries a valid HMAC session cookie. */
export async function isAuthenticatedRequest(): Promise<boolean> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return false; // fail closed when unconfigured
  const cookieStore = await cookies();
  const token = cookieStore.get(getAuthCookieName())?.value ?? "";
  return verifyAuthToken(token, password);
}
