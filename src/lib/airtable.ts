import {
  getAdSnapshotsFromSupabase,
  getDailyAggregatesFromSupabase,
  getAlertsFromSupabase,
  getShopifySalesFromSupabase,
} from "./supabase";

const BASE_URL = "https://api.airtable.com/v0";
const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const API_KEY = process.env.AIRTABLE_API_KEY!;

export const TABLES = {
  CREATIVE_TAGS: "tblUh80aj6pvPhBRj",
} as const;

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime: string;
}

interface AirtableResponse {
  records: AirtableRecord[];
  offset?: string;
}

async function fetchAllRecords(
  tableId: string,
  options: {
    filterByFormula?: string;
    sort?: Array<{ field: string; direction: "asc" | "desc" }>;
    fields?: string[];
    maxRecords?: number;
  } = {},
): Promise<AirtableRecord[]> {
  const allRecords: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams();
    if (options.filterByFormula)
      params.set("filterByFormula", options.filterByFormula);
    if (options.maxRecords)
      params.set("maxRecords", String(options.maxRecords));
    if (offset) params.set("offset", offset);

    if (options.sort) {
      options.sort.forEach((s, i) => {
        params.set(`sort[${i}][field]`, s.field);
        params.set(`sort[${i}][direction]`, s.direction);
      });
    }

    if (options.fields) {
      options.fields.forEach((f) => params.append("fields[]", f));
    }

    const url = `${BASE_URL}/${BASE_ID}/${tableId}?${params.toString()}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      next: { revalidate: 1800 }, // cache 30 min (n8n refreshes every 6h)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Airtable error ${res.status}: ${err}`);
    }

    const data: AirtableResponse = await res.json();
    allRecords.push(...data.records);
    offset = data.offset;
  } while (offset);

  return allRecords;
}

// ---------------------------------------------------------------------------
// WEBDEV-216 (Step 7a): four getters now read Supabase ONLY. The Airtable read
// fallbacks and per-table kill switches were retired — the Supabase reads have
// been the sole source since the WEBDEV-194 cutover, and the dual-write is being
// wound down. Each Supabase read returns the SAME
// { id, fields:{<Airtable display names>}, createdTime } envelope, so the /api
// routes and components are untouched. On any Supabase error the exception now
// propagates to the caller (the route's try/catch → 500) instead of silently
// serving stale Airtable data. CREATIVE_TAGS is NOT migrated (hybrid
// human+machine data) and stays on Airtable below.
// ---------------------------------------------------------------------------

// Reads Supabase only (WEBDEV-216). marketing.ad_snapshots.
export async function getAdSnapshots() {
  return getAdSnapshotsFromSupabase();
}

// CREATIVE_TAGS stays on Airtable BY DESIGN (hybrid human tags + machine
// composite scores; not migrated). Do not repoint.
export async function getCreativeTags() {
  return fetchAllRecords(TABLES.CREATIVE_TAGS);
}

// Reads Supabase only (WEBDEV-216). marketing.daily_aggregates (view).
export async function getDailyAggregates() {
  return getDailyAggregatesFromSupabase();
}

// Reads Supabase only (WEBDEV-216). marketing.ad_alerts currently has 0 rows
// while the ad account is paused, so an empty [] is expected here, not an error.
export async function getAlerts() {
  return getAlertsFromSupabase();
}

// Reads Supabase only (WEBDEV-216). marketing.shopify_daily_sales.
export async function getShopifySales() {
  return getShopifySalesFromSupabase();
}

// Convenience: get all data for dashboard
export async function getAllDashboardData() {
  const [snapshots, tags, dailyAggregates, alerts, shopifySales] =
    await Promise.all([
      getAdSnapshots(),
      getCreativeTags(),
      getDailyAggregates(),
      getAlerts(),
      getShopifySales(),
    ]);

  return { snapshots, tags, dailyAggregates, alerts, shopifySales };
}
