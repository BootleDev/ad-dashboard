/**
 * Dashboard auth (WEBDEV-211). Ported from the social-dashboard pattern so all
 * three internal dashboards share one hardened scheme.
 *
 * The pre-WEBDEV-211 gate stored a STATIC literal cookie
 * (`bootle_dash_auth === "authenticated"`) that anyone could forge with a
 * single curl header, fully bypassing /api/auth — proven live before the fix.
 * The session cookie now holds an HMAC-SHA256 value derived from the server
 * secret (DASHBOARD_PASSWORD); it cannot be produced without the secret, and
 * the middleware / API routes re-derive and constant-time-compare it on every
 * request. There is NO default password fallback — every entry point fails
 * closed when DASHBOARD_PASSWORD is unset.
 *
 * Web Crypto (crypto.subtle) is used so the same module works in both the Edge
 * (middleware) and Node (route handler) runtimes — do NOT import next/headers
 * here, that would break the Edge bundle.
 *
 * ACCEPTED LIMITATION (WEBDEV-211 review): the token is HMAC(password, fixed
 * context), so it is CONSTANT per password — there is no per-session nonce or
 * server-side session store. A leaked cookie stays valid until DASHBOARD_PASSWORD
 * is rotated (which logs everyone out), and the only expiry is the 7-day cookie
 * maxAge. This is an accepted trade-off for an internal single-user dashboard
 * and matches the social-dashboard / social-studio scheme; adding per-session
 * revocation across all three apps is a tracked follow-up, not a blocker here.
 * The rate limiter below is in-memory and per-serverless-instance (resets on
 * cold start) — adequate against online guessing of the 16-char secret, not a
 * distributed-store guarantee.
 */

const COOKIE_NAME = "bootle_dash_auth";
const SIGNING_CONTEXT = "bootle_ad_dashboard_v1";

async function hmacSign(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The session-cookie value for a given password: HMAC(password, context). */
export async function createAuthToken(password: string): Promise<string> {
  return hmacSign(password, SIGNING_CONTEXT);
}

/** Constant-time check that `token` is the HMAC for `password`. */
export async function verifyAuthToken(
  token: string,
  password: string,
): Promise<boolean> {
  if (!token || !password) return false;
  const expected = await createAuthToken(password);
  if (token.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export function getAuthCookieName(): string {
  return COOKIE_NAME;
}

/** Simple in-memory, per-IP rate limiter for the login endpoint. */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  ip: string,
  maxAttempts = 5,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxAttempts) return false;
  attempts.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
  return true;
}
