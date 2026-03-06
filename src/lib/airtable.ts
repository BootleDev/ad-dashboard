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

export async function getAdSnapshots() {
  return fetchAllRecords(TABLES.AD_SNAPSHOTS, {
    sort: [{ field: "Snapshot Date", direction: "desc" }],
  });
}

export async function getCreativeTags() {
  return fetchAllRecords(TABLES.CREATIVE_TAGS);
}

export async function getDailyAggregates() {
  return fetchAllRecords(TABLES.DAILY_AGGREGATES, {
    sort: [{ field: "Date", direction: "desc" }],
  });
}

export async function getAlerts() {
  return fetchAllRecords(TABLES.ALERTS_LOG, {
    sort: [{ field: "Alert Date", direction: "desc" }],
  });
}

export async function getShopifySales() {
  return fetchAllRecords(TABLES.SHOPIFY_DAILY_SALES, {
    sort: [{ field: "Date", direction: "desc" }],
  });
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
