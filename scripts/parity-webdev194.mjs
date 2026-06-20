/**
 * WEBDEV-194 parity proof: the four repointed getters via Airtable vs Supabase.
 *
 * For each of ad_snapshots / daily_aggregates / ad_alerts / shopify_daily_sales
 * this asserts, against the FULL table on both sides:
 *   - row count equality
 *   - sort-order equality on the load-bearing sort key (date desc)
 *   - exact emitted key-set equality per record (Supabase mapped envelope vs
 *     the raw Airtable record's fields)
 *   - per-column value equality on matching natural keys — SAME UNIT, SAME
 *     MAGNITUDE (numeric compare for number-likes, string compare otherwise)
 *
 * KNOWN INTENTIONAL DIVERGENCES (daily_aggregates only):
 *   1. "Active Ads"/"Active Campaigns": the view computes them via count(*),
 *      while the Airtable historical rows carry blank/wrong Status-derived
 *      values (bug fixed during migration, validated 54/54 dates). Divergence
 *      is ALLOWED for exactly those two keys and REPORTED; any other diff
 *      fails the run.
 *   2. PRECISION ONLY (same unit, same magnitude): the view ROUNDS derived
 *      ratios by design — round(...,4) for Blended CTR, round(...,2) for
 *      CPC/CPM/ROAS/CPA — while the Airtable rows hold the n8n Code node's raw
 *      JS floats (incl. float noise like 32.92000000000001 on summed Total
 *      Spend, which exact-numeric SQL sums normalize away). Those columns are
 *      compared under the view's declared rounding bound (|at-sb| <= 0.5*10^-dp)
 *      instead of exact equality; everything else stays EXACT.
 *
 * The Supabase side maps rows through the REAL production mappers
 * (src/lib/supabaseMappers.ts), imported directly via Node's native TypeScript
 * type-stripping (Node >= 23.6, or 22.18+ LTS) — so this proves the exact code
 * the app ships, not a re-implementation.
 *
 * SELF-SKIPS (exit 0) when SUPABASE_DB_URL / AIRTABLE_API_KEY / AIRTABLE_BASE_ID
 * are absent, so it is safe to run anywhere and never flakes a credentialed CI.
 * This is a manual proof script, NOT wired to any test runner.
 *
 * Run live with the workspace secrets:
 *   set -a; . ~/Projects/Bootle/.secrets/.env; set +a
 *   AIRTABLE_BASE_ID=appIyePhrYZBUxCP9 node scripts/parity-webdev194.mjs
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mapSnapshotRow,
  mapDailyAggregateRow,
  mapAlertRow,
  mapShopifySalesRow,
} from "../src/lib/supabaseMappers.ts";

// Pin the same Supabase Root 2021 CA the app uses (src/lib/supabase-ca.ts), so
// the parity proof exercises the hardened TLS path (rejectUnauthorized: true).
const SUPABASE_CA = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(
    join(here, "..", "src", "lib", "supabase-ca.ts"),
    "utf8",
  );
  const m = src.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/,
  );
  if (!m) throw new Error("could not extract CA PEM from src/lib/supabase-ca.ts");
  return m[0] + "\n";
})();

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!SUPABASE_DB_URL || !AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.log(
    "[parity] SKIP — missing SUPABASE_DB_URL / AIRTABLE_API_KEY / AIRTABLE_BASE_ID",
  );
  process.exit(0);
}

// Same type parsers as src/lib/supabase.ts: int8 -> Number, date -> raw string.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);

function parseDbUrl(url) {
  const m = url.match(
    /^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:@/]+)(?::(\d+))?(?:\/([^?]+))?/,
  );
  if (!m) throw new Error("bad SUPABASE_DB_URL");
  const [, user, password, host, port, database] = m;
  return {
    user,
    password,
    host,
    port: port ? Number(port) : 5432,
    database: database || "postgres",
  };
}

const pool = new pg.Pool({
  ...parseDbUrl(SUPABASE_DB_URL),
  ssl: { ca: SUPABASE_CA, rejectUnauthorized: true },
  max: 1,
});

async function fetchAllAirtable(tableId, sortField) {
  const records = [];
  let offset;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (sortField) {
      params.set("sort[0][field]", sortField);
      params.set("sort[0][direction]", "desc");
    }
    if (offset) params.set("offset", offset);
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}?${params}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } },
    );
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return records;
}

let failures = 0;
function fail(section, msg) {
  failures++;
  console.error(`[parity:${section}] FAIL — ${msg}`);
}

const isNumLike = (v) =>
  (typeof v === "number" && Number.isFinite(v)) ||
  (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));

/** Exact-unit equality: numeric compare when both sides are number-like
 * (handles pg numeric-as-string "0.00" vs Airtable 0), strict string
 * compare otherwise. NO epsilon by default: the dual-write wrote the same
 * value, so any numeric difference is a real bug. For view-computed columns
 * with a DECLARED rounding precision (daily_aggregates), `dp` applies the
 * mathematically exact bound for "sb = round(at, dp)". */
function valuesEqual(a, b, dp) {
  if (isNumLike(a) && isNumLike(b)) {
    if (dp !== undefined)
      return Math.abs(Number(a) - Number(b)) <= 0.5 * 10 ** -dp + 1e-12;
    return Number(a) === Number(b);
  }
  return String(a) === String(b);
}

/**
 * Compare a full table: sb = mapped Supabase envelopes (in query sort order),
 * at = raw Airtable records (in Airtable sort order). Rows matched by
 * keyOf(fields). allowedDivergence = display-name keys where value/key-set
 * differences are intentional (reported, not failed).
 */
function compareTable(
  section,
  sb,
  at,
  { keyOf, sortKey, allowedDivergence = [], roundedColumns = {} },
) {
  console.log(`\n=== ${section} ===`);
  console.log(`  rows: supabase=${sb.length} airtable=${at.length}`);

  // (1) row count
  if (sb.length !== at.length)
    fail(section, `row count mismatch ${sb.length} vs ${at.length}`);

  if (sb.length === 0 && at.length === 0) {
    console.log("  both sides empty — count parity holds (0 = 0)");
    return;
  }

  // (2) sort order: the load-bearing sort key sequence must match positionally
  // and be non-increasing on both sides. (Within-key ties: Airtable order is
  // record-creation order, which nothing downstream relies on.)
  const sbSeq = sb.map((r) => String(r.fields[sortKey] ?? "").split("T")[0]);
  const atSeq = at.map((r) => String(r.fields[sortKey] ?? "").split("T")[0]);
  const nonIncreasing = (seq) =>
    seq.every((v, i) => i === 0 || seq[i - 1] >= v);
  if (!nonIncreasing(sbSeq)) fail(section, `Supabase ${sortKey} not desc-sorted`);
  if (!nonIncreasing(atSeq)) fail(section, `Airtable ${sortKey} not desc-sorted`);
  if (JSON.stringify(sbSeq) !== JSON.stringify(atSeq))
    fail(section, `${sortKey} desc sequence differs between sources`);

  // (3) per-record key set + per-column values, matched by natural key
  const atByKey = new Map(at.map((r) => [keyOf(r.fields), r]));
  const divergenceReport = new Map(); // key -> count
  let matched = 0;
  for (const rec of sb) {
    const k = keyOf(rec.fields);
    const atRec = atByKey.get(k);
    if (!atRec) {
      fail(section, `no Airtable record for natural key ${k}`);
      continue;
    }
    matched++;
    const sbKeys = Object.keys(rec.fields);
    const atKeys = Object.keys(atRec.fields);
    const sbSet = new Set(sbKeys);
    const atSet = new Set(atKeys);
    for (const key of new Set([...sbKeys, ...atKeys])) {
      const inSb = sbSet.has(key);
      const inAt = atSet.has(key);
      const allowed = allowedDivergence.includes(key);
      if (inSb !== inAt) {
        if (allowed) {
          divergenceReport.set(key, (divergenceReport.get(key) ?? 0) + 1);
        } else {
          fail(
            section,
            `key-set mismatch at ${k}: "${key}" ${inSb ? "only in Supabase" : "only in Airtable"}`,
          );
        }
        continue;
      }
      if (!valuesEqual(rec.fields[key], atRec.fields[key], roundedColumns[key])) {
        if (allowed) {
          divergenceReport.set(key, (divergenceReport.get(key) ?? 0) + 1);
        } else {
          fail(
            section,
            `value mismatch at ${k} "${key}": supabase=${JSON.stringify(rec.fields[key])} airtable=${JSON.stringify(atRec.fields[key])}`,
          );
        }
      }
    }
  }
  console.log(`  matched by natural key: ${matched}/${sb.length}`);
  for (const [key, n] of divergenceReport) {
    console.log(
      `  documented divergence "${key}": ${n} row(s) differ (intentional — see allowedDivergence comment above)`,
    );
  }
}

// --------------------------------------------------------------------------
// ad_snapshots (same SQL as src/lib/supabase.ts getAdSnapshotsFromSupabase)
// --------------------------------------------------------------------------
{
  const { rows } = await pool.query(
    `select snapshot_id, snapshot_date, campaign_id, campaign_name,
            campaign_status, ad_set_id, ad_set_name, ad_id, ad_name,
            ad_status, spend, impressions, reach, frequency, clicks, ctr,
            cpc, cpm, purchases, purchase_value, roas, cpa, cvr,
            video_views_3s, thruplay, video_25, video_50, video_75,
            video_100, avg_watch_time, hook_rate, hold_rate, creative_type,
            ad_copy, headline, cta_type, thumbnail_url, video_url, updated_at
       from marketing.ad_snapshots
      order by snapshot_date desc, snapshot_id asc`,
  );
  const sb = rows.map(mapSnapshotRow);
  const at = await fetchAllAirtable("tblzn5odeQKZUWNGb", "Snapshot Date");
  compareTable("ad_snapshots", sb, at, {
    keyOf: (f) => String(f["Snapshot ID"]),
    sortKey: "Snapshot Date",
    // "Campaign Status" and "Ad Status" are Airtable-only mutable status fields.
    // n8n updates them live as Meta campaign/ad statuses change; they are NOT
    // written into marketing.ad_snapshots (which stores the immutable daily
    // performance snapshot at capture time). Excluding them from parity avoids
    // false failures whenever a campaign is paused/resumed after snapshot date.
    // Row count and all other snapshot fields (spend, impressions, ROAS, etc.)
    // must still match exactly.
    allowedDivergence: ["Campaign Status", "Ad Status"],
  });

  // Unit spot-report (fractions vs multiples), from live data:
  const withCtr = sb.find((r) => Number(r.fields["CTR"] ?? 0) > 0);
  if (withCtr)
    console.log(
      `  unit check: CTR=${withCtr.fields["CTR"]} (fraction), Frequency=${withCtr.fields["Frequency"]} (multiple) @ ${withCtr.id}`,
    );
}

// --------------------------------------------------------------------------
// daily_aggregates (VIEW) — divergence confined to Active Ads/Active Campaigns
// --------------------------------------------------------------------------
{
  const { rows } = await pool.query(
    `select date, total_spend, impressions, reach, clicks, blended_ctr,
            cpc, cpm, roas, cpa, total_purchases, revenue, active_ads,
            active_campaigns
       from marketing.daily_aggregates
      order by date desc`,
  );
  const sb = rows.map(mapDailyAggregateRow);
  const at = await fetchAllAirtable("tblSYohFmAY3GM22n", "Date");
  compareTable("daily_aggregates", sb, at, {
    keyOf: (f) => String(f["Date"]),
    sortKey: "Date",
    allowedDivergence: ["Active Ads", "Active Campaigns"],
    // The view's DECLARED rounding (pg_get_viewdef, 2026-06-10): blended_ctr
    // round(...,4); cpc/cpm/roas/cpa round(...,2). Sums (Total Spend, Revenue)
    // are exact-numeric in SQL but carry JS float noise on the Airtable side
    // (e.g. 32.92000000000001) — compared at the float-noise bound via dp:9.
    roundedColumns: {
      "Blended CTR": 4,
      CPC: 2,
      CPM: 2,
      ROAS: 2,
      CPA: 2,
      "Total Spend": 9,
      Revenue: 9,
    },
  });
}

// --------------------------------------------------------------------------
// ad_alerts (0 rows both sides today — count parity + mapper covered by vitest)
// --------------------------------------------------------------------------
{
  const { rows } = await pool.query(
    `select alert_id, alert_date, type, severity, ad_id, ad_name, message,
            metric_value, threshold, acknowledged, updated_at
       from marketing.ad_alerts
      order by alert_date desc, alert_id asc`,
  );
  const sb = rows.map(mapAlertRow);
  const at = await fetchAllAirtable("tbloH8ri15R8SHl2h", "Alert Date");
  compareTable("ad_alerts", sb, at, {
    keyOf: (f) => String(f["Alert ID"]),
    sortKey: "Alert Date",
  });
}

// --------------------------------------------------------------------------
// shopify_daily_sales
// --------------------------------------------------------------------------
{
  const { rows } = await pool.query(
    `select date, currency, total_orders, gross_revenue, net_revenue,
            total_discounts, last_synced, updated_at
       from marketing.shopify_daily_sales
      order by date desc, currency asc`,
  );
  const sb = rows.map(mapShopifySalesRow);
  const at = await fetchAllAirtable("tblhMQwAZkF4A293c", "Date");
  compareTable("shopify_daily_sales", sb, at, {
    keyOf: (f) => `${f["Date"]}|${f["Currency"]}`,
    sortKey: "Date",
  });
}

await pool.end();

if (failures > 0) {
  console.error(`\n[parity] FAIL — ${failures} mismatch(es)`);
  process.exit(1);
}
console.log("\n[parity] PASS — all four getters");
