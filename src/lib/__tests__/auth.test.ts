/**
 * WEBDEV-211: locks the HMAC session-token scheme that replaced the forgeable
 * `cookie === "authenticated"` literal. The token MUST be unforgeable without
 * the password and verified in constant time.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createAuthToken,
  verifyAuthToken,
  getAuthCookieName,
  checkRateLimit,
} from "../auth";

afterEach(() => {
  vi.useRealTimers();
});

describe("createAuthToken / verifyAuthToken", () => {
  it("is deterministic for a given password (64 hex chars = SHA-256)", async () => {
    const a = await createAuthToken("hunter2");
    const b = await createAuthToken("hunter2");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different passwords", async () => {
    expect(await createAuthToken("a")).not.toBe(await createAuthToken("b"));
  });

  it("verifies a token minted from the same password", async () => {
    const token = await createAuthToken("s3cret");
    expect(await verifyAuthToken(token, "s3cret")).toBe(true);
  });

  it("REJECTS the old forgeable literal — the WEBDEV-211 regression guard", async () => {
    expect(await verifyAuthToken("authenticated", "s3cret")).toBe(false);
  });

  it("rejects a token minted from a different password", async () => {
    const token = await createAuthToken("old-password");
    expect(await verifyAuthToken(token, "new-password")).toBe(false);
  });

  it("rejects empty token or empty password (fail closed)", async () => {
    const token = await createAuthToken("s3cret");
    expect(await verifyAuthToken("", "s3cret")).toBe(false);
    expect(await verifyAuthToken(token, "")).toBe(false);
    expect(await verifyAuthToken("", "")).toBe(false);
  });

  it("rejects a token of the wrong length without throwing (length guard before compare)", async () => {
    expect(await verifyAuthToken("abc", "s3cret")).toBe(false);
  });

  it("rejects a single-hex-digit tampered token of the correct length", async () => {
    const token = await createAuthToken("s3cret");
    const flipped =
      (token[0] === "0" ? "1" : "0") + token.slice(1);
    expect(flipped).toHaveLength(token.length);
    expect(await verifyAuthToken(flipped, "s3cret")).toBe(false);
  });
});

describe("getAuthCookieName", () => {
  it("is the ad-dashboard cookie name", () => {
    expect(getAuthCookieName()).toBe("bootle_dash_auth");
  });
});

describe("checkRateLimit", () => {
  it("allows up to maxAttempts then blocks within the window (unique IP per test)", () => {
    const ip = "10.0.0.1";
    for (let i = 0; i < 5; i++) expect(checkRateLimit(ip, 5, 60_000)).toBe(true);
    expect(checkRateLimit(ip, 5, 60_000)).toBe(false);
  });

  it("tracks IPs independently", () => {
    expect(checkRateLimit("10.0.0.2", 1, 60_000)).toBe(true);
    expect(checkRateLimit("10.0.0.2", 1, 60_000)).toBe(false);
    expect(checkRateLimit("10.0.0.3", 1, 60_000)).toBe(true);
  });

  it("resets after the window elapses", () => {
    vi.useFakeTimers();
    const ip = "10.0.0.4";
    expect(checkRateLimit(ip, 1, 60_000)).toBe(true);
    expect(checkRateLimit(ip, 1, 60_000)).toBe(false); // blocked within window
    vi.advanceTimersByTime(60_001); // window elapses
    expect(checkRateLimit(ip, 1, 60_000)).toBe(true); // allowed again
  });
});
