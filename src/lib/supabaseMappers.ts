/**
 * Pure row -> envelope mappers for the four Supabase-migrated marketing tables
 * (WEBDEV-194, third cutover after social-studio + social-dashboard).
 *
 * Extracted from supabase.ts so the shape-critical mapping logic is
 * unit-testable WITHOUT a live DB and without importing the `server-only` /
 * `pg` connection layer. supabase.ts runs the queries and hands each raw pg row
 * to the matching pure mapper here; these functions contain no I/O and no side
 * effects, so they can be exercised directly in vitest.
 *
 * Every mapper returns the SAME envelope the Airtable getters return:
 *   { id, fields: { <Airtable display-name keys> }, createdTime }
 * A field key is emitted ONLY when its DB value is non-null, reproducing
 * Airtable's sparse-record shape (Airtable omits empty cells from `fields`).
 * A SQL 0 is a real value and IS emitted; only null/undefined is dropped.
 *
 * Column -> display-name maps verified three ways (2026-06-10):
 *   1. tools/supabase-migration/backfill-marketing.mjs + generate-dualwrites.mjs
 *      (authoritative — they produced the pg data)
 *   2. Airtable schema metadata API (complete field list per table)
 *   3. every key the app reads (components / utils.ts / api routes)
 *
 * UNIT-SCALE CONTRACT (this repoint's analog of the social ER 100x bug):
 * the dual-write wrote the SAME value to both stores, so every mapped value
 * must equal the Airtable value EXACTLY (same unit, same magnitude).
 * Empirically confirmed on matching snapshot_ids (2026-06-10):
 *   - CTR / CVR / Hook Rate / Hold Rate / Blended CTR are FRACTIONS
 *     (e.g. ctr 0.04054054 = 4.05%; Airtable `percent` fields store fractions).
 *     BudgetRecommendations does (ctr*100).toFixed(1)+'%' and CreativeDNA does
 *     num(a["CTR"])*100, so a percent-shaped value (4.05) would render 405%.
 *   - ROAS / Frequency are MULTIPLES (e.g. roas 3.17x, frequency 1.28) — they
 *     legitimately exceed 1 and must NOT be given a <1 fraction guard.
 * The mappers pass values through VERBATIM (pg numeric arrives as a string;
 * num() in the components parses it identically). supabaseMappers.test.ts
 * locks the MAPPERS to that verbatim passthrough — a mapper that starts
 * scaling or normalizing rate values fails `npm test` (run manually; this
 * repo has NO CI yet, so nothing runs the suite automatically). Upstream ETL
 * drift (the writer starting to store percents instead of fractions) is NOT
 * caught by those fixture tests — only the manual
 * scripts/parity-webdev194.mjs covers that.
 *
 * CRITICAL cross-source join: src/lib/utils.ts merges Creative Tags (which
 * stay on Airtable) into snapshots keyed by the "Ad ID" display field. The
 * snapshot mapper MUST emit "Ad ID" string-identical to Airtable's value or
 * CreativeDNA / CreativePerformance silently lose all tags.
 */

import type { AirtableRecord } from "./utils";

/**
 * Build a fields object from a row, emitting a key only when the column value
 * is non-null/undefined. Reproduces Airtable's sparse-record shape.
 */
export function buildFields(
  row: Record<string, unknown>,
  map: Array<[column: string, displayName: string]>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [column, displayName] of map) {
    const v = row[column];
    if (v !== null && v !== undefined) {
      fields[displayName] = v;
    }
  }
  return fields;
}

/** ISO createdTime for the envelope, from a timestamptz `updated_at`. */
export function toCreatedTime(updatedAt: unknown): string {
  if (updatedAt instanceof Date) return updatedAt.toISOString();
  if (typeof updatedAt === "string") {
    const d = new Date(updatedAt);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date(0).toISOString();
}

// ---------------------------------------------------------------------------
// marketing.ad_snapshots -> getAdSnapshots
// ---------------------------------------------------------------------------
export const SNAPSHOT_MAP: Array<[string, string]> = [
  ["snapshot_id", "Snapshot ID"],
  ["snapshot_date", "Snapshot Date"],
  ["campaign_id", "Campaign ID"],
  ["campaign_name", "Campaign Name"],
  ["campaign_status", "Campaign Status"],
  ["ad_set_id", "Ad Set ID"],
  ["ad_set_name", "Ad Set Name"],
  ["ad_id", "Ad ID"],
  ["ad_name", "Ad Name"],
  ["ad_status", "Ad Status"],
  ["spend", "Spend"],
  ["impressions", "Impressions"],
  ["reach", "Reach"],
  ["frequency", "Frequency"],
  ["clicks", "Clicks"],
  ["ctr", "CTR"],
  ["cpc", "CPC"],
  ["cpm", "CPM"],
  ["purchases", "Purchases"],
  ["purchase_value", "Purchase Value"],
  ["roas", "ROAS"],
  ["cpa", "CPA"],
  ["cvr", "CVR"],
  ["video_views_3s", "Video Views 3s"],
  ["thruplay", "ThruPlay"],
  ["video_25", "Video 25%"],
  ["video_50", "Video 50%"],
  ["video_75", "Video 75%"],
  ["video_100", "Video 100%"],
  ["avg_watch_time", "Avg Watch Time"],
  ["hook_rate", "Hook Rate"],
  ["hold_rate", "Hold Rate"],
  ["creative_type", "Creative Type"],
  ["ad_copy", "Ad Copy"],
  ["headline", "Headline"],
  ["cta_type", "CTA Type"],
  ["thumbnail_url", "Thumbnail URL"],
  ["video_url", "Video URL"],
];

/**
 * Map an ad_snapshots row to the Airtable envelope.
 * id = snapshot_id (text pk, e.g. "120237211556740289-2026-01-22").
 */
export function mapSnapshotRow(row: Record<string, unknown>): AirtableRecord {
  return {
    id: String(row.snapshot_id),
    fields: buildFields(row, SNAPSHOT_MAP),
    createdTime: toCreatedTime(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// marketing.daily_aggregates (VIEW over ad_snapshots) -> getDailyAggregates
// ---------------------------------------------------------------------------
//
// KNOWN INTENTIONAL DIVERGENCE: the view computes active_ads/active_campaigns
// via count(*); the Airtable historical rows had blank/wrong Status-derived
// values (bug fixed during the migration, validated 54/54 dates). Do NOT
// "fix" this back — the view values are the correct ones.
export const DAILY_AGGREGATE_MAP: Array<[string, string]> = [
  ["date", "Date"],
  ["total_spend", "Total Spend"],
  ["impressions", "Impressions"],
  ["reach", "Reach"],
  ["clicks", "Clicks"],
  ["blended_ctr", "Blended CTR"],
  ["cpc", "CPC"],
  ["cpm", "CPM"],
  ["roas", "ROAS"],
  ["cpa", "CPA"],
  ["total_purchases", "Total Purchases"],
  ["revenue", "Revenue"],
  ["active_ads", "Active Ads"],
  ["active_campaigns", "Active Campaigns"],
];

/**
 * Map a daily_aggregates view row to the Airtable envelope.
 * The view is read-only and has no updated_at column, so:
 *   id = `daily|<date>` (one row per date),
 *   createdTime is synthesized from the row's date (midnight UTC).
 */
export function mapDailyAggregateRow(
  row: Record<string, unknown>,
): AirtableRecord {
  return {
    id: `daily|${row.date}`,
    fields: buildFields(row, DAILY_AGGREGATE_MAP),
    createdTime: row.date
      ? `${row.date}T00:00:00.000Z`
      : new Date(0).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// marketing.ad_alerts -> getAlerts
// ---------------------------------------------------------------------------
export const ALERT_MAP: Array<[string, string]> = [
  ["alert_id", "Alert ID"],
  ["alert_date", "Alert Date"],
  ["type", "Type"],
  ["severity", "Severity"],
  ["ad_id", "Ad ID"],
  ["ad_name", "Ad Name"],
  ["message", "Message"],
  ["metric_value", "Metric Value"],
  ["threshold", "Threshold"],
];

/**
 * Map an ad_alerts row to the Airtable envelope. id = alert_id (text pk).
 *
 * "Acknowledged" is an Airtable CHECKBOX: Airtable returns `true` when checked
 * and OMITS the key entirely when unchecked. The pg `acknowledged` column is
 * excluded from dual-write (human field) and defaults false, so we emit the
 * key only for a literal true — exact Airtable checkbox parity.
 */
export function mapAlertRow(row: Record<string, unknown>): AirtableRecord {
  const fields = buildFields(row, ALERT_MAP);
  if (row.acknowledged === true) {
    fields["Acknowledged"] = true;
  }
  return {
    id: String(row.alert_id),
    fields,
    createdTime: toCreatedTime(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// marketing.shopify_daily_sales -> getShopifySales
// ---------------------------------------------------------------------------
export const SHOPIFY_MAP: Array<[string, string]> = [
  ["date", "Date"],
  ["currency", "Currency"],
  ["total_orders", "Total Orders"],
  ["gross_revenue", "Gross Revenue"],
  ["net_revenue", "Net Revenue"],
  ["total_discounts", "Total Discounts"],
  ["last_synced", "Last Synced"],
];

/**
 * Map a shopify_daily_sales row to the Airtable envelope.
 * id is synthesized from the table's composite pk (date, currency) so it stays
 * unique if a second currency ever appears: `shopify|<date>|<currency>`.
 * createdTime <- updated_at.
 *
 * last_synced is timestamptz, which pg parses to a JS Date; Airtable returns
 * an ISO string ("...T...Z"), so normalize to toISOString() — /api/airtable
 * and /api/chat serialize whole fields objects and must emit the same shape.
 */
export function mapShopifySalesRow(
  row: Record<string, unknown>,
): AirtableRecord {
  const fields = buildFields(row, SHOPIFY_MAP);
  if (fields["Last Synced"] instanceof Date) {
    fields["Last Synced"] = (fields["Last Synced"] as Date).toISOString();
  }
  return {
    id: `shopify|${row.date}|${row.currency}`,
    fields,
    createdTime: toCreatedTime(row.updated_at),
  };
}
