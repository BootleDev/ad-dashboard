import {
  hasSupabaseDbUrl,
  getAdSnapshotsFromSupabase,
  getDailyAggregatesFromSupabase,
  getAlertsFromSupabase,
  getShopifySalesFromSupabase,
} from "./supabase";

const BASE_URL = "https://api.airtable.com/v0";
const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const API_KEY = process.env.AIRTABLE_API_KEY!;

export const TABLES = {
  AD_SNAPSHOTS: "tblzn5odeQKZUWNGb",
  CREATIVE_TAGS: "tblUh80aj6pvPhBRj",
  DAILY_AGGREGATES: "tblSYohFmAY3GM22n",
  ALERTS_LOG: "tbloH8ri15R8SHl2h",
  SHOPIFY_DAILY_SALES: "tblhMQwAZkF4A293c",
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
// WEBDEV-194 (ad-dashboard cutover): four getters are repointed to Supabase,
// each behind a per-table kill switch and each FAIL-FAST to the original
// Airtable read on ANY error, timeout, or empty result. The Supabase reads
// return the SAME { id, fields:{<Airtable display names>}, createdTime }
// envelope, so the /api routes and components are untouched. CREATIVE_TAGS is
// NOT migrated (hybrid human+machine data) and stays on Airtable below.
//
// Per-table kill switches (force Airtable even when SUPABASE_DB_URL is present):
//   AD_SNAPSHOTS_SOURCE=airtable
//   DAILY_AGGREGATES_SOURCE=airtable
//   AD_ALERTS_SOURCE=airtable
//   SHOPIFY_SALES_SOURCE=airtable
//
// CACHING NOTE: the Airtable fetch path uses next:{revalidate:1800}; the pg
// path is per-request (no Next data cache). Internal dashboard behind cookie
// auth — acceptable.
// ---------------------------------------------------------------------------

function forcedToAirtable(envVar: string | undefined): boolean {
  return envVar?.toLowerCase() === "airtable";
}

async function getAdSnapshotsFromAirtable() {
  return fetchAllRecords(TABLES.AD_SNAPSHOTS, {
    sort: [{ field: "Snapshot Date", direction: "desc" }],
  });
}

export async function getAdSnapshots() {
  if (
    !forcedToAirtable(process.env.AD_SNAPSHOTS_SOURCE) &&
    hasSupabaseDbUrl()
  ) {
    try {
      const rows = await getAdSnapshotsFromSupabase();
      if (rows.length > 0) return rows;
      console.warn(
        "[ad-snapshots] Supabase returned no rows; falling back to Airtable",
      );
    } catch (err) {
      console.error(
        "[ad-snapshots] Supabase read failed; falling back to Airtable:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return getAdSnapshotsFromAirtable();
}

// CREATIVE_TAGS stays on Airtable BY DESIGN (hybrid human tags + machine
// composite scores; not migrated). Do not repoint.
export async function getCreativeTags() {
  return fetchAllRecords(TABLES.CREATIVE_TAGS);
}

async function getDailyAggregatesFromAirtable() {
  return fetchAllRecords(TABLES.DAILY_AGGREGATES, {
    sort: [{ field: "Date", direction: "desc" }],
  });
}

export async function getDailyAggregates() {
  if (
    !forcedToAirtable(process.env.DAILY_AGGREGATES_SOURCE) &&
    hasSupabaseDbUrl()
  ) {
    try {
      const rows = await getDailyAggregatesFromSupabase();
      if (rows.length > 0) return rows;
      console.warn(
        "[daily-aggregates] Supabase returned no rows; falling back to Airtable",
      );
    } catch (err) {
      console.error(
        "[daily-aggregates] Supabase read failed; falling back to Airtable:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return getDailyAggregatesFromAirtable();
}

async function getAlertsFromAirtable() {
  return fetchAllRecords(TABLES.ALERTS_LOG, {
    sort: [{ field: "Alert Date", direction: "desc" }],
  });
}

// NOTE: marketing.ad_alerts currently has 0 rows on BOTH sides (ad account
// paused), so this getter fails over on-empty to Airtable (also empty) —
// harmless and by design. The mapper is still fully unit-tested from fixtures.
export async function getAlerts() {
  if (!forcedToAirtable(process.env.AD_ALERTS_SOURCE) && hasSupabaseDbUrl()) {
    try {
      const rows = await getAlertsFromSupabase();
      if (rows.length > 0) return rows;
      console.warn(
        "[ad-alerts] Supabase returned no rows; falling back to Airtable",
      );
    } catch (err) {
      console.error(
        "[ad-alerts] Supabase read failed; falling back to Airtable:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return getAlertsFromAirtable();
}

async function getShopifySalesFromAirtable() {
  return fetchAllRecords(TABLES.SHOPIFY_DAILY_SALES, {
    sort: [{ field: "Date", direction: "desc" }],
  });
}

export async function getShopifySales() {
  if (
    !forcedToAirtable(process.env.SHOPIFY_SALES_SOURCE) &&
    hasSupabaseDbUrl()
  ) {
    try {
      const rows = await getShopifySalesFromSupabase();
      if (rows.length > 0) return rows;
      console.warn(
        "[shopify-sales] Supabase returned no rows; falling back to Airtable",
      );
    } catch (err) {
      console.error(
        "[shopify-sales] Supabase read failed; falling back to Airtable:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return getShopifySalesFromAirtable();
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
