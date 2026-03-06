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
