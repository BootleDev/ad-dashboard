/**
 * Pure unit tests for the Supabase row -> Airtable-envelope mappers
 * (WEBDEV-194). NO live DB: these exercise the pure mappers extracted out of
 * supabase.ts so the shape-critical contract is locked by `npm test`.
 *
 * SCOPE — what this suite does and does NOT cover: it locks the MAPPER to
 * verbatim passthrough — a mapper that starts scaling or normalizing rate
 * values fails `npm test`. That run is MANUAL: this repo has NO CI yet (zero
 * GitHub workflows; the Vercel build is a plain `next build`), so nothing
 * executes the suite automatically. Upstream ETL drift — the writer starting
 * to store percents instead of fractions — sails through these fixture-based
 * specs and is covered only by the manual scripts/parity-webdev194.mjs run
 * against live data.
 *
 * The #1 review risk is the unit scale of the rate columns (this repoint's
 * analog of the social-dashboard ER 100x bug). Empirically verified on
 * matching snapshot_ids across both stores (2026-06-10):
 *   - CTR / CVR / Hook Rate / Hold Rate / Blended CTR are FRACTIONS
 *     (Airtable `percent` fields store fractions; the dual-write copied the
 *     same value to pg). BudgetRecommendations renders (ctr*100).toFixed(1)+'%'
 *     and CreativeDNA renders num(a["CTR"])*100 — a percent-shaped value
 *     (4.05 instead of 0.0405) would silently render 405%.
 *   - ROAS / Frequency are MULTIPLES (3.17x, 1.28) — legitimately > 1; the
 *     fraction guard must NOT be applied to them.
 *
 * Fixture values are REAL values read from BOTH stores for snapshot_id
 * "120237211556740289-2026-01-22" (Airtable recoOL0GU7UbYjn6H), so the
 * fraction assertions encode observed production data, not assumptions.
 */

import { describe, it, expect } from "vitest";
import {
  mapSnapshotRow,
  mapDailyAggregateRow,
  mapAlertRow,
  mapShopifySalesRow,
  SNAPSHOT_MAP,
} from "../supabaseMappers";
import { num, str, aggregateSnapshots } from "../utils";
import type { AirtableRecord, Fields } from "../utils";

// A full ad_snapshots row as it arrives from pg AFTER the type parsers in
// supabase.ts (date stays a "YYYY-MM-DD" string; numeric columns arrive as
// STRINGS, int4 as numbers — mirrored exactly here).
function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    snapshot_id: "120237211556740289-2026-01-22",
    snapshot_date: "2026-01-22",
    campaign_id: "120237211556720289",
    campaign_name: "George of the Forrest",
    campaign_status: "PAUSED",
    ad_set_id: "120237211556730289",
    ad_set_name: "Ad Set",
    ad_id: "120237211556740289",
    ad_name: "Spruce Soda",
    ad_status: "ACTIVE",
    spend: "31.84",
    impressions: 1924,
    reach: 1749,
    frequency: "1.100057",
    clicks: 78,
    ctr: "0.04054054",
    cpc: "0.408205",
    cpm: "16.548857",
    purchases: 0,
    purchase_value: "0",
    roas: "0",
    cpa: "0",
    cvr: "0",
    video_views_3s: 1740,
    thruplay: 460,
    video_25: 525,
    video_50: 449,
    video_75: 347,
    video_100: 124,
    avg_watch_time: "11",
    hook_rate: "0.9043659043659044",
    hold_rate: "0.26436781609195403",
    creative_type: "VIDEO",
    ad_copy: "Forest Fizz …",
    headline: null,
    cta_type: "SHOP_NOW",
    thumbnail_url: "https://scontent.example/thumb.png",
    video_url: "https://www.facebook.com/ads/archive/render_ad/?id=1",
    updated_at: "2026-06-10T01:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// UNIT-SCALE GUARDS (the #1 risk)
// ---------------------------------------------------------------------------
describe("mapSnapshotRow — rate-column unit scale", () => {
  it("passes CTR through as a FRACTION (0.04054054 -> components render 4.1%)", () => {
    const rec = mapSnapshotRow(snapshotRow());
    const ctr = rec.fields["CTR"];

    // Exact verbatim passthrough (pg numeric string), no *100 conversion.
    expect(ctr).toBe("0.04054054");

    // Property: fraction in [0, 1).
    expect(num(ctr)).toBeGreaterThan(0);
    expect(num(ctr)).toBeLessThan(1);

    // BudgetRecommendations math: (num(ctr) * 100).toFixed(1) + "%".
    expect((num(ctr) * 100).toFixed(1)).toBe("4.1");
  });

  it("passes CVR / Hook Rate / Hold Rate through as FRACTIONS", () => {
    const rec = mapSnapshotRow(
      snapshotRow({ cvr: "0.0196078431372549" }), // real max_cvr in prod
    );
    for (const key of ["CVR", "Hook Rate", "Hold Rate"]) {
      const v = num(rec.fields[key]);
      expect(v, `${key} must be a fraction`).toBeGreaterThanOrEqual(0);
      // Hook/Hold can legitimately reach exactly 1.0 (100%), never above.
      expect(v, `${key} must be <= 1`).toBeLessThanOrEqual(1);
    }
    // Exact empirical values survive verbatim.
    expect(rec.fields["Hook Rate"]).toBe("0.9043659043659044");
    expect(rec.fields["Hold Rate"]).toBe("0.26436781609195403");
  });

  it("ROAS and Frequency are MULTIPLES — values > 1 are valid and pass through", () => {
    // real prod values: max_roas 3.166…, frequency 1.100057 / 1.284615
    const rec = mapSnapshotRow(
      snapshotRow({ roas: "3.1662504459507668", frequency: "1.284615" }),
    );
    // No <1 fraction guard here: multiples legitimately exceed 1.
    expect(num(rec.fields["ROAS"])).toBeCloseTo(3.16625, 4);
    expect(num(rec.fields["ROAS"])).toBeGreaterThan(1);
    expect(num(rec.fields["Frequency"])).toBeCloseTo(1.284615, 6);
    expect(num(rec.fields["Frequency"])).toBeGreaterThan(1);
  });

  it("REGRESSION GUARD: a percent-shaped CTR (4.054 instead of 0.04054) VIOLATES the fraction invariant", () => {
    // Simulate percent-shaped input. The mapper passes it through verbatim,
    // so the fraction (<1) property FAILS — proving the invariant DETECTS a
    // percent (a mapper that silently rescaled would mask it, and the
    // verbatim-passthrough specs above would go red under a manual `npm test`
    // — there is NO CI in this repo yet). Live ETL drift itself is caught
    // only by scripts/parity-webdev194.mjs, not by this fixture.
    const rec = mapSnapshotRow(snapshotRow({ ctr: "4.054054" }));
    const ctr = rec.fields["CTR"];

    // The value the components would render — catastrophically wrong.
    expect((num(ctr) * 100).toFixed(1)).toBe("405.4");

    // The guard: the fraction invariant does NOT hold for a percent.
    expect(num(ctr) < 1).toBe(false);
  });

  it("REGRESSION GUARD: percent-shaped CVR / Hook Rate / Hold Rate violate the fraction invariant", () => {
    const rec = mapSnapshotRow(
      snapshotRow({
        cvr: "1.96",
        hook_rate: "90.43",
        hold_rate: "26.44",
      }),
    );
    for (const key of ["CVR", "Hook Rate", "Hold Rate"]) {
      expect(
        num(rec.fields[key]) <= 1,
        `${key} fraction invariant must fail for a percent`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// marketing.ad_snapshots — envelope shape
// ---------------------------------------------------------------------------
describe("mapSnapshotRow — envelope shape", () => {
  it("emits the EXACT Airtable display-name key set for a full row", () => {
    const rec = mapSnapshotRow(snapshotRow({ headline: "A headline" }));
    expect(Object.keys(rec.fields).sort()).toEqual(
      [
        "Snapshot ID",
        "Snapshot Date",
        "Campaign ID",
        "Campaign Name",
        "Campaign Status",
        "Ad Set ID",
        "Ad Set Name",
        "Ad ID",
        "Ad Name",
        "Ad Status",
        "Spend",
        "Impressions",
        "Reach",
        "Frequency",
        "Clicks",
        "CTR",
        "CPC",
        "CPM",
        "Purchases",
        "Purchase Value",
        "ROAS",
        "CPA",
        "CVR",
        "Video Views 3s",
        "ThruPlay",
        "Video 25%",
        "Video 50%",
        "Video 75%",
        "Video 100%",
        "Avg Watch Time",
        "Hook Rate",
        "Hold Rate",
        "Creative Type",
        "Ad Copy",
        "Headline",
        "CTA Type",
        "Thumbnail URL",
        "Video URL",
      ].sort(),
    );
    // The map covers all 38 Airtable fields (metadata API, 2026-06-10).
    expect(SNAPSHOT_MAP).toHaveLength(38);
  });

  it("uses snapshot_id as the record id and updated_at as createdTime", () => {
    const rec = mapSnapshotRow(snapshotRow());
    expect(rec.id).toBe("120237211556740289-2026-01-22");
    expect(rec.createdTime).toBe("2026-06-10T01:00:00.000Z");
  });

  it("keeps Snapshot Date as the raw YYYY-MM-DD string (date-range filter does str().split('T'))", () => {
    const rec = mapSnapshotRow(snapshotRow());
    expect(rec.fields["Snapshot Date"]).toBe("2026-01-22");
    expect(str(rec.fields["Snapshot Date"]).split("T")[0]).toBe("2026-01-22");
  });

  it("SPARSE SHAPE: null columns are OMITTED (Airtable empty-cell parity); 0 is kept", () => {
    const rec = mapSnapshotRow(
      snapshotRow({ headline: null, ad_copy: null, video_url: null }),
    );
    expect("Headline" in rec.fields).toBe(false);
    expect("Ad Copy" in rec.fields).toBe(false);
    expect("Video URL" in rec.fields).toBe(false);
    // 0 / "0" are real values and stay.
    expect(rec.fields["Purchases"]).toBe(0);
    expect(rec.fields["ROAS"]).toBe("0");
  });

  it('CRITICAL JOIN: emits "Ad ID" string-identical so the Airtable Creative Tags merge keeps working', () => {
    const rec = mapSnapshotRow(snapshotRow());
    // Exact string equality with the Airtable display value.
    expect(rec.fields["Ad ID"]).toBe("120237211556740289");
    expect(typeof rec.fields["Ad ID"]).toBe("string");

    // End-to-end: aggregateSnapshots merges a tagMap keyed by str(fields["Ad ID"])
    // (exactly how CreativePerformance / Diagnostics / api/chat build it from
    // Airtable Creative Tags records). A mapped Supabase snapshot MUST pick up
    // its tag, or CreativeDNA silently loses Format/Hook Type for every ad.
    const tagMap = new Map<string, Fields>([
      ["120237211556740289", { Format: "UGC", "Hook Type": "Question" }],
    ]);
    const aggregated = aggregateSnapshots(
      [rec as AirtableRecord],
      tagMap,
    );
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]["Format"]).toBe("UGC");
    expect(aggregated[0]["Hook Type"]).toBe("Question");
  });
});

// ---------------------------------------------------------------------------
// marketing.daily_aggregates (VIEW) — envelope shape + Blended CTR unit
// ---------------------------------------------------------------------------
function dailyAggregateRow(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-01-22",
    total_spend: "32.92",
    impressions: 1997, // bigint -> Number via setTypeParser(20)
    reach: 1812,
    clicks: 79,
    blended_ctr: "0.0392",
    cpc: "0.42",
    cpm: "16.48",
    roas: "0.00",
    cpa: "0",
    total_purchases: 0,
    revenue: "0",
    active_ads: 5,
    active_campaigns: 2,
    ...overrides,
  };
}

describe("mapDailyAggregateRow", () => {
  it("emits the EXACT Daily Aggregates display-name key set", () => {
    const rec = mapDailyAggregateRow(dailyAggregateRow());
    expect(Object.keys(rec.fields).sort()).toEqual(
      [
        "Date",
        "Total Spend",
        "Impressions",
        "Reach",
        "Clicks",
        "Blended CTR",
        "CPC",
        "CPM",
        "ROAS",
        "CPA",
        "Total Purchases",
        "Revenue",
        "Active Ads",
        "Active Campaigns",
      ].sort(),
    );
  });

  it("synthesizes id as `daily|<date>` and createdTime from the date (no updated_at on the view)", () => {
    const rec = mapDailyAggregateRow(dailyAggregateRow());
    expect(rec.id).toBe("daily|2026-01-22");
    expect(rec.createdTime).toBe("2026-01-22T00:00:00.000Z");
  });

  it("keeps Date as the raw YYYY-MM-DD string (deduplicateByDate does str(fields.Date).split('T'))", () => {
    const rec = mapDailyAggregateRow(dailyAggregateRow());
    expect(str(rec.fields.Date).split("T")[0]).toBe("2026-01-22");
  });

  it("Blended CTR is a FRACTION (0.0392 = 3.92%); percent-shaped input violates the invariant", () => {
    const rec = mapDailyAggregateRow(dailyAggregateRow());
    expect(num(rec.fields["Blended CTR"])).toBeGreaterThan(0);
    expect(num(rec.fields["Blended CTR"])).toBeLessThan(1);

    // REGRESSION GUARD: percent-shaped (3.92) fails the fraction property.
    const bad = mapDailyAggregateRow(dailyAggregateRow({ blended_ctr: "3.92" }));
    expect(num(bad.fields["Blended CTR"]) < 1).toBe(false);
  });

  it("Active Ads / Active Campaigns arrive as numbers (view count(*); int8 parser)", () => {
    const rec = mapDailyAggregateRow(dailyAggregateRow());
    expect(rec.fields["Active Ads"]).toBe(5);
    expect(rec.fields["Active Campaigns"]).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// marketing.ad_alerts — envelope shape (0 rows in prod; fixtures lock the
// contract for when alerts resume)
// ---------------------------------------------------------------------------
function alertRow(overrides: Record<string, unknown> = {}) {
  return {
    alert_id: "ALERT-2026-01-20-001",
    alert_date: "2026-01-20",
    type: "Fatigue",
    severity: "High",
    ad_id: "120237211556740289",
    ad_name: "Spruce Soda",
    message: "Frequency above threshold",
    metric_value: "3.4",
    threshold: "3",
    acknowledged: false,
    updated_at: "2026-06-10T01:00:00.000Z",
    ...overrides,
  };
}

describe("mapAlertRow", () => {
  it("emits the EXACT Alerts Log display-name key set (unacknowledged row)", () => {
    const rec = mapAlertRow(alertRow());
    expect(Object.keys(rec.fields).sort()).toEqual(
      [
        "Alert ID",
        "Alert Date",
        "Type",
        "Severity",
        "Ad ID",
        "Ad Name",
        "Message",
        "Metric Value",
        "Threshold",
      ].sort(),
    );
  });

  it("uses alert_id (text pk) as the record id", () => {
    const rec = mapAlertRow(alertRow());
    expect(rec.id).toBe("ALERT-2026-01-20-001");
    expect(typeof rec.id).toBe("string");
  });

  it("CHECKBOX PARITY: Acknowledged=false is OMITTED (Airtable omits unchecked boxes); true is emitted", () => {
    const unacked = mapAlertRow(alertRow({ acknowledged: false }));
    expect("Acknowledged" in unacked.fields).toBe(false);

    const acked = mapAlertRow(alertRow({ acknowledged: true }));
    expect(acked.fields["Acknowledged"]).toBe(true);
  });

  it("SPARSE SHAPE: null Ad ID / Ad Name omitted", () => {
    const rec = mapAlertRow(alertRow({ ad_id: null, ad_name: null }));
    expect("Ad ID" in rec.fields).toBe(false);
    expect("Ad Name" in rec.fields).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// marketing.shopify_daily_sales — envelope shape
// ---------------------------------------------------------------------------
function shopifyRow(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-06-02",
    currency: "EUR",
    total_orders: 3,
    gross_revenue: "189.85",
    net_revenue: "171.2",
    total_discounts: "12.5",
    last_synced: new Date("2026-06-03T02:10:29.000Z"), // timestamptz -> JS Date
    updated_at: "2026-06-03T02:10:30.000Z",
    ...overrides,
  };
}

describe("mapShopifySalesRow", () => {
  it("emits the EXACT Shopify Daily Sales display-name key set", () => {
    const rec = mapShopifySalesRow(shopifyRow());
    expect(Object.keys(rec.fields).sort()).toEqual(
      [
        "Date",
        "Currency",
        "Total Orders",
        "Gross Revenue",
        "Net Revenue",
        "Total Discounts",
        "Last Synced",
      ].sort(),
    );
  });

  it("synthesizes id from the composite pk (date, currency) and createdTime from updated_at", () => {
    const rec = mapShopifySalesRow(shopifyRow());
    expect(rec.id).toBe("shopify|2026-06-02|EUR");
    expect(rec.createdTime).toBe("2026-06-03T02:10:30.000Z");
  });

  it("normalizes Last Synced (JS Date from timestamptz) to the Airtable ISO string", () => {
    const rec = mapShopifySalesRow(shopifyRow());
    expect(rec.fields["Last Synced"]).toBe("2026-06-03T02:10:29.000Z");
    expect(typeof rec.fields["Last Synced"]).toBe("string");
  });

  it("keeps Date as the raw YYYY-MM-DD string (utils reads str(fields['Date']).split('T'))", () => {
    const rec = mapShopifySalesRow(shopifyRow());
    expect(str(rec.fields["Date"]).split("T")[0]).toBe("2026-06-02");
  });

  it("SPARSE SHAPE: null Last Synced / Total Discounts omitted; 0 orders kept", () => {
    const rec = mapShopifySalesRow(
      shopifyRow({ last_synced: null, total_discounts: null, total_orders: 0 }),
    );
    expect("Last Synced" in rec.fields).toBe(false);
    expect("Total Discounts" in rec.fields).toBe(false);
    expect(rec.fields["Total Orders"]).toBe(0);
  });
});
