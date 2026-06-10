/**
 * WEBDEV-211: locks the login endpoint's fail-closed behaviour — no committed
 * default password, rate limiting, and an HMAC cookie (never the old static
 * "authenticated" literal).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth module before importing the route so the rate limiter is
// controllable and the token is deterministic.
vi.mock("@/lib/auth", () => ({
  createAuthToken: vi.fn().mockResolvedValue("mock-hmac-token"),
  checkRateLimit: vi.fn().mockReturnValue(true),
  getAuthCookieName: () => "bootle_dash_auth",
}));

import { POST } from "../auth/route";
import { checkRateLimit } from "@/lib/auth";

function makeRequest(body: unknown, ip = "127.0.0.1"): Request {
  return new Request("http://localhost/api/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (checkRateLimit as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it("returns 500 when DASHBOARD_PASSWORD is not set (no default fallback)", async () => {
    const original = process.env.DASHBOARD_PASSWORD;
    delete process.env.DASHBOARD_PASSWORD;
    const res = await POST(makeRequest({ password: "dashboard1" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Server misconfigured");
    process.env.DASHBOARD_PASSWORD = original;
  });

  it("returns 429 when rate limited", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    (checkRateLimit as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const res = await POST(makeRequest({ password: "secret" }));
    expect(res.status).toBe(429);
  });

  it("returns 400 for an invalid JSON body", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    const req = new Request("http://localhost/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: "not-json",
    });
    expect((await POST(req)).status).toBe(400);
  });

  it("returns 401 for the wrong password", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    expect((await POST(makeRequest({ password: "wrong" }))).status).toBe(401);
  });

  it("returns 401 for the old default 'dashboard1' once a real password is set", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    expect((await POST(makeRequest({ password: "dashboard1" }))).status).toBe(401);
  });

  it("returns 200 and sets the HMAC cookie for the correct password", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    const res = await POST(makeRequest({ password: "secret" }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("bootle_dash_auth=mock-hmac-token");
    expect(setCookie).not.toContain("authenticated");
    expect(setCookie.toLowerCase()).toContain("httponly");
  });
});
