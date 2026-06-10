/**
 * WEBDEV-211 wiring guard: the data routes (/api/airtable, /api/chat) are NOT
 * gated by the middleware (it allow-lists all /api/*), so each MUST enforce
 * auth itself via isAuthenticatedRequest(). These tests lock that wiring — a
 * future edit that drops the guard from either route goes red here. This is
 * the other half of the forged-cookie regression lock (the pure verifyAuthToken
 * test covers the token; this covers that the routes actually call it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIsAuth = vi.fn();
vi.mock("@/lib/authServer", () => ({
  isAuthenticatedRequest: () => mockIsAuth(),
}));

// Data layer is mocked so an authenticated request doesn't hit Airtable/pg.
const mockGetAdSnapshots = vi.fn();
const mockGetAllDashboardData = vi.fn();
vi.mock("@/lib/airtable", () => ({
  getAdSnapshots: () => mockGetAdSnapshots(),
  getCreativeTags: vi.fn(),
  getDailyAggregates: vi.fn(),
  getAlerts: vi.fn(),
  getShopifySales: vi.fn(),
  getAllDashboardData: () => mockGetAllDashboardData(),
}));

import { GET } from "../airtable/route";
import { POST } from "../chat/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/airtable auth gate", () => {
  it("returns 401 when the request is not authenticated (no data fetched)", async () => {
    mockIsAuth.mockResolvedValue(false);
    const res = await GET(new Request("http://localhost/api/airtable?table=snapshots"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
    expect(mockGetAdSnapshots).not.toHaveBeenCalled();
  });

  it("serves data once authenticated", async () => {
    mockIsAuth.mockResolvedValue(true);
    mockGetAdSnapshots.mockResolvedValue([{ id: "s1", fields: {}, createdTime: "" }]);
    const res = await GET(new Request("http://localhost/api/airtable?table=snapshots"));
    expect(res.status).toBe(200);
    expect((await res.json()).records).toHaveLength(1);
  });
});

describe("POST /api/chat auth gate", () => {
  function makeRequest(body: unknown): Request {
    return new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 401 when not authenticated, before parsing the body", async () => {
    mockIsAuth.mockResolvedValue(false);
    const res = await POST(makeRequest({ message: "hi" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
    expect(mockGetAllDashboardData).not.toHaveBeenCalled();
  });

  it("passes the auth gate when authenticated (then 400s on a missing message — proves auth runs first)", async () => {
    mockIsAuth.mockResolvedValue(true);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400); // got past auth, failed validation
  });
});
