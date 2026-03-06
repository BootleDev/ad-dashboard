export interface CampaignDateInfo {
  campaigns: Array<{ name: string; spend: number; fraction: number }>;
}

export interface CampaignShopifyData {
  campaignName: string;
  dateRange: string;
  metaSpend: number;
  shopifyRevenue: number;
  shopifyOrders: number;
  trueROAS: number;
  trueCPA: number;
  impressions: number;
  clicks: number;
  ctr: number;
}

/**
 * Build a map of date → which campaigns were active (spend > 0) with spend fractions.
 * For days with multiple campaigns, fractions are proportional to spend.
 */
export function buildCampaignDateMap(
  snapshots: AirtableRecord[],
): Map<string, CampaignDateInfo> {
  // Group spend by date + campaign
  const dateSpend = new Map<string, Map<string, number>>();
  for (const s of snapshots) {
    const spend = num(s.fields["Spend"]);
    if (spend <= 0) continue;
    const date = str(s.fields["Snapshot Date"]).split("T")[0];
    const campaign = str(s.fields["Campaign Name"]);
    if (!date || !campaign) continue;
    if (!dateSpend.has(date)) dateSpend.set(date, new Map());
    const campaignMap = dateSpend.get(date)!;
    campaignMap.set(campaign, (campaignMap.get(campaign) ?? 0) + spend);
  }

  const result = new Map<string, CampaignDateInfo>();
  for (const [date, campaignMap] of dateSpend) {
    const totalDaySpend = Array.from(campaignMap.values()).reduce(
      (a, b) => a + b,
      0,
    );
    const campaigns = Array.from(campaignMap.entries()).map(
      ([name, spend]) => ({
        name,
        spend,
        fraction: totalDaySpend > 0 ? spend / totalDaySpend : 0,
      }),
    );
    result.set(date, { campaigns });
  }
  return result;
}

/**
 * Attribute Shopify orders/revenue to campaigns by matching dates.
 * For overlap days, attribution is proportional to campaign spend.
 */
export function attributeShopifyToCampaigns(
  shopifySales: AirtableRecord[],
  snapshots: AirtableRecord[],
): CampaignShopifyData[] {
  const dateMap = buildCampaignDateMap(snapshots);

  // Aggregate per-campaign: spend, attributed Shopify revenue/orders, impressions, clicks
  const campaignAgg = new Map<
    string,
    {
      dates: Set<string>;
      metaSpend: number;
      shopifyRevenue: number;
      shopifyOrders: number;
      impressions: number;
      clicks: number;
    }
  >();

  // Sum Meta metrics per campaign from snapshots
  for (const s of snapshots) {
    const spend = num(s.fields["Spend"]);
    if (spend <= 0) continue;
    const campaign = str(s.fields["Campaign Name"]);
    const date = str(s.fields["Snapshot Date"]).split("T")[0];
    if (!campaign || !date) continue;
    if (!campaignAgg.has(campaign)) {
      campaignAgg.set(campaign, {
        dates: new Set(),
        metaSpend: 0,
        shopifyRevenue: 0,
        shopifyOrders: 0,
        impressions: 0,
        clicks: 0,
      });
    }
    const agg = campaignAgg.get(campaign)!;
    agg.dates.add(date);
    agg.metaSpend += spend;
    agg.impressions += num(s.fields["Impressions"]);
    agg.clicks += num(s.fields["Clicks"]);
  }

  // Attribute Shopify data using date map fractions
  for (const r of shopifySales) {
    const date = str(r.fields["Date"]).split("T")[0];
    if (!date) continue;
    const info = dateMap.get(date);
    if (!info) continue;
    const revenue = num(r.fields["Gross Revenue"]);
    const orders = num(r.fields["Total Orders"]);
    for (const c of info.campaigns) {
      const agg = campaignAgg.get(c.name);
      if (!agg) continue;
      agg.shopifyRevenue += revenue * c.fraction;
      agg.shopifyOrders += orders * c.fraction;
    }
  }

  // Build results sorted by earliest date (most recent first)
  return Array.from(campaignAgg.entries())
    .map(([name, agg]) => {
      const sortedDates = Array.from(agg.dates).sort();
      const first = sortedDates[0] ?? "";
      const last = sortedDates[sortedDates.length - 1] ?? "";
      const fmtDate = (d: string) => {
        if (!d) return "";
        const [, m, day] = d.split("-");
        const months = [
          "",
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return `${months[parseInt(m, 10)]} ${parseInt(day, 10)}`;
      };
      const dateRange =
        first === last
          ? fmtDate(first)
          : `${fmtDate(first)} – ${fmtDate(last)}`;
      return {
        campaignName: name,
        dateRange,
        metaSpend: agg.metaSpend,
        shopifyRevenue: agg.shopifyRevenue,
        shopifyOrders: agg.shopifyOrders,
        trueROAS: agg.metaSpend > 0 ? agg.shopifyRevenue / agg.metaSpend : 0,
        trueCPA: agg.shopifyOrders > 0 ? agg.metaSpend / agg.shopifyOrders : 0,
        impressions: agg.impressions,
        clicks: agg.clicks,
        ctr: agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0,
        _firstDate: first,
      };
    })
    .sort((a, b) => b._firstDate.localeCompare(a._firstDate))
    .map(({ _firstDate, ...rest }) => rest);
}

export function formatCurrency(value: number, decimals = 2): string {
  return `€${value.toFixed(decimals)}`;
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

export function pctChange(
  current: number,
  previous: number,
): number | undefined {
  if (previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

/** Deduplicate Daily Aggregates by Date field, keeping first occurrence per date. */
export function deduplicateByDate(records: AirtableRecord[]): AirtableRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const date = str(r.fields.Date).split("T")[0];
    if (!date || seen.has(date)) return false;
    seen.add(date);
    return true;
  });
}

export type Fields = Record<string, unknown>;
export type AirtableRecord = {
  id: string;
  fields: Fields;
  createdTime: string;
};

export function num(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  return 0;
}

export function str(val: unknown): string {
  if (typeof val === "string") return val;
  return String(val ?? "");
}

const SUM_FIELDS = [
  "Spend",
  "Impressions",
  "Reach",
  "Clicks",
  "Purchases",
  "Purchase Value",
  "Video Views 3s",
  "ThruPlay",
  "Video 25%",
  "Video 50%",
  "Video 75%",
  "Video 100%",
];

/**
 * Aggregate all snapshots per Ad ID — sums metrics, computes derived ratios.
 * Optionally merges tag data. Returns one record per unique ad.
 */
export function aggregateSnapshots(
  snapshots: AirtableRecord[],
  tagMap?: Map<string, Fields>,
): Fields[] {
  const adAgg = new Map<
    string,
    { latest: Fields; sums: Record<string, number> }
  >();

  const sorted = [...snapshots].sort((a, b) =>
    String(b.fields["Snapshot Date"] ?? "").localeCompare(
      String(a.fields["Snapshot Date"] ?? ""),
    ),
  );

  for (const s of sorted) {
    const adId = str(s.fields["Ad ID"]);
    if (!adId) continue;
    // Skip zero-activity snapshots (paused days with no real data)
    const hasActivity =
      num(s.fields["Spend"]) > 0 || num(s.fields["Impressions"]) > 0;
    if (!adAgg.has(adId)) {
      const tag = tagMap?.get(adId) || {};
      adAgg.set(adId, {
        latest: { ...s.fields, ...tag },
        sums: Object.fromEntries(SUM_FIELDS.map((f) => [f, 0])),
      });
    }
    const entry = adAgg.get(adId)!;
    if (hasActivity) {
      for (const f of SUM_FIELDS) {
        entry.sums[f] += num(s.fields[f]);
      }
    }
  }

  return Array.from(adAgg.values()).map(({ latest, sums }) => {
    const spend = sums["Spend"];
    const impressions = sums["Impressions"];
    const clicks = sums["Clicks"];
    const purchases = sums["Purchases"];
    const purchaseValue = sums["Purchase Value"];
    const views3s = sums["Video Views 3s"];
    const thruPlay = sums["ThruPlay"];
    return {
      ...latest,
      ...sums,
      ROAS: spend > 0 ? purchaseValue / spend : 0,
      CPA: purchases > 0 ? spend / purchases : 0,
      CTR: impressions > 0 ? clicks / impressions : 0,
      CPC: clicks > 0 ? spend / clicks : 0,
      CPM: impressions > 0 ? (spend / impressions) * 1000 : 0,
      CVR: clicks > 0 ? purchases / clicks : 0,
      Frequency: sums["Reach"] > 0 ? impressions / sums["Reach"] : 0,
      "Hook Rate": impressions > 0 ? (views3s / impressions) * 100 : 0,
      "Hold Rate": views3s > 0 ? thruPlay / views3s : 0,
    };
  });
}
