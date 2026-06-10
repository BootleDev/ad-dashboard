/**
 * Supabase (Postgres) read layer for the ad dashboard's migrated tables.
 *
 * WEBDEV-194 (ad dashboard, third cutover after social-studio + social-
 * dashboard): ONLY the four fully-migrated, machine-written tables are
 * repointed here:
 *   - marketing.ad_snapshots        (-> getAdSnapshots)
 *   - marketing.daily_aggregates    (-> getDailyAggregates; a VIEW, read-only)
 *   - marketing.ad_alerts           (-> getAlerts)
 *   - marketing.shopify_daily_sales (-> getShopifySales)
 * getCreativeTags stays on Airtable BY DESIGN: CREATIVE_TAGS is hybrid
 * human+machine data and is NOT migrated. See ./airtable.ts.
 *
 * Mechanism: a direct node-pg connection over SUPABASE_DB_URL, SERVER-SIDE ONLY
 * (the `import "server-only"` below turns any client import into a build error).
 * SUPABASE_DB_URL must be the Supabase TRANSACTION POOLER
 * (...pooler.supabase.com:6543) — short-lived serverless invocations should
 * never hold a direct-Postgres connection. The connection string is read from
 * process.env at runtime and must never be exposed to the client (no PUBLIC_/
 * NEXT_PUBLIC_ prefix). The connection gotchas below mirror the hardened
 * social-dashboard/social-studio layer and
 * ~/Projects/Bootle/shared/cc-bridge/db.js:
 *   - the Supabase DB-URL password can contain % or ?, which makes WHATWG
 *     `new URL()` (and pg-connection-string) throw "Invalid URL", so we parse
 *     the URL into discrete fields and hand the password to the driver verbatim
 *   - TLS is verified against the pinned Supabase Root 2021 CA (the pooler
 *     presents a private chain whose self-signed root is not in the system
 *     trust store), so rejectUnauthorized stays true (full cert + hostname
 *     verification) instead of an accept-anything posture
 *   - a `pool.on('error')` listener so an idle backend drop (pooler idle
 *     timeout, DB restart, network blip) is logged and swallowed instead of
 *     escalating to an uncaught exception that crashes the process
 *   - the connect/query timeouts below time-bound a slow/hung pooler, and every
 *     read is additionally wrapped in a Promise.race(4000ms) so a stall ALWAYS
 *     fails over to Airtable fast (the Supavisor pooler may not honour
 *     statement_timeout) — hang-not-failover was a real blocker on the first
 *     cutover
 *   - setTypeParser(1082, identity) so a `date` column comes back as its raw
 *     "YYYY-MM-DD" string (matching the Airtable date strings exactly) rather
 *     than a JS Date, which would shift under the server's timezone.
 *
 * Every reader returns the SAME envelope the Airtable getters return: an
 * AirtableRecord ({ id, fields: { <Airtable display-name keys> }, createdTime })
 * so the components and /api routes are untouched. A field key is only emitted
 * when its DB value is non-null, reproducing Airtable's sparse-record shape
 * (Airtable omits empty cells).
 */

import "server-only";
import pg from "pg";
import type { AirtableRecord } from "./utils";
import { SUPABASE_ROOT_CA_2021 } from "./supabase-ca";
import {
  mapSnapshotRow,
  mapDailyAggregateRow,
  mapAlertRow,
  mapShopifySalesRow,
} from "./supabaseMappers";

// int8 (OID 20): return as a JS number, not a string. The daily_aggregates
// view computes bigint columns (count(*)/sum() -> Impressions, Reach, Clicks,
// Total Purchases, Active Ads, Active Campaigns); Airtable returns plain JS
// numbers for those fields, so parse to Number for exact parity. All live
// values are small counts — nowhere near Number.MAX_SAFE_INTEGER.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// date (OID 1082): return the raw "YYYY-MM-DD" string verbatim. The default
// parser builds a local-midnight JS Date that would then stringify with a
// timezone offset; we need the exact Airtable string. This parser IS load-
// bearing for snapshot_date / date / alert_date — the dashboard's date-range
// filter and dedupe both do str(x).split("T")[0] — do not remove it.
pg.types.setTypeParser(1082, (v) => v);

const DB_URL = process.env.SUPABASE_DB_URL;

// Hard ceiling on the whole Supabase read (connect + TLS + query). Belt-and-
// suspenders over the pg-level timeouts below: the Supavisor pooler may not
// honour statement_timeout, so a Promise.race guarantees each getter fails over
// to Airtable rather than hanging the dashboard / chat route.
const SUPABASE_READ_TIMEOUT_MS = 4000;

let pool: pg.Pool | null = null;

/**
 * Parse postgres://user:password@host[:port]/db into discrete fields. We do NOT
 * hand the raw URL to pg's connectionString option: Supabase DB passwords can
 * contain characters (e.g. % or ?) that are not percent-encoded, which makes
 * WHATWG `new URL()` throw. The password group is greedy up to the LAST '@' so
 * an '@' inside it is tolerated; the host segment after it never contains '@'.
 *
 * Module-private on purpose: it returns the cleartext password, so we keep the
 * surface narrow (not exported).
 */
function parseDbUrl(url: string): {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
} {
  const m = url.match(
    /^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:@/]+)(?::(\d+))?(?:\/([^?]+))?/,
  );
  if (!m) {
    throw new Error(
      "SUPABASE_DB_URL must look like postgres://user:password@host[:port]/database",
    );
  }
  const [, user, password, host, port, database] = m;
  return {
    user,
    password,
    host,
    port: port ? Number(port) : 5432,
    database: database || "postgres",
  };
}

function getPool(): pg.Pool {
  if (!DB_URL) {
    throw new Error("SUPABASE_DB_URL is not set");
  }
  if (!pool) {
    pool = new pg.Pool({
      ...parseDbUrl(DB_URL),
      // Full TLS verification against the pinned Supabase root (the pooler's
      // self-signed root is not in the system trust store). See ./supabase-ca.
      ssl: { ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true },
      max: 2,
      // Time-bound a slow/hung pooler so a stall fails over to Airtable fast.
      // NOTE: the connect (2500) and query (3500) budgets are SEQUENTIAL, so
      // they do NOT individually sit under the 4000ms ceiling. The actual
      // guarantee: failover is guaranteed at 4000ms by the Promise.race in
      // withTimeout(); an orphaned in-flight query is then destroyed by
      // query_timeout, bounded at ~6s worst case (2500 connect + 3500 query),
      // briefly holding one of the pool's 2 slots after the failover.
      connectionTimeoutMillis: 2500,
      query_timeout: 3500,
      statement_timeout: 3500,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
      keepAlive: true,
    });
    // Without this listener pg escalates an idle-client error to an uncaught
    // exception that would crash the server. Log and swallow; the next query
    // reconnects.
    pool.on("error", (err) => {
      console.error("[supabase] idle pg client error:", err.message);
    });
  }
  return pool;
}

/** True when SUPABASE_DB_URL is configured (so the Supabase path is usable). */
export function hasSupabaseDbUrl(): boolean {
  return Boolean(DB_URL);
}

/**
 * Race a read against SUPABASE_READ_TIMEOUT_MS so a stall at connect / TLS /
 * query rejects fast and lands in the caller's Airtable fallback. Every public
 * reader below goes through this — a hung pooler must never hang the dashboard.
 */
async function withTimeout<T>(label: string, read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Supabase read (${label}) timed out after ${SUPABASE_READ_TIMEOUT_MS}ms`,
          ),
        ),
      SUPABASE_READ_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// The pure row -> envelope mappers (and their column->display-name maps) live
// in ./supabaseMappers so they can be unit-tested without this server-only / pg
// connection layer. The #1 review risk — the CTR/CVR/Hook-Rate/Hold-Rate
// fraction-vs-percent invariant and the exact emitted key set / id synthesis /
// sparse-shape rule / "Ad ID" tag-join identity — is pinned there by
// supabaseMappers.test.ts, which locks the MAPPERS to verbatim passthrough: a
// mapper that starts scaling or normalizing fails `npm test` (run manually —
// this repo has NO CI yet, so nothing runs the suite automatically). Upstream
// ETL drift (the writer starting to store percents) is NOT caught by those
// fixture tests; only the manual scripts/parity-webdev194.mjs covers that.
// Each getter below just runs the query and maps each row through the matching
// pure mapper.

// ---------------------------------------------------------------------------
// marketing.ad_snapshots -> getAdSnapshots
// ---------------------------------------------------------------------------
// Sorted snapshot_date DESC to mirror the Airtable 'Snapshot Date' desc sort;
// snapshot_id is a deterministic tiebreak within a date (Airtable's within-date
// order is record-creation order, which nothing downstream relies on).
export async function getAdSnapshotsFromSupabase(): Promise<AirtableRecord[]> {
  return withTimeout(
    "ad_snapshots",
    (async () => {
      const { rows } = await getPool().query(
        `select snapshot_id, snapshot_date, campaign_id, campaign_name,
                campaign_status, ad_set_id, ad_set_name, ad_id, ad_name,
                ad_status, spend, impressions, reach, frequency, clicks, ctr,
                cpc, cpm, purchases, purchase_value, roas, cpa, cvr,
                video_views_3s, thruplay, video_25, video_50, video_75,
                video_100, avg_watch_time, hook_rate, hold_rate, creative_type,
                ad_copy, headline, cta_type, thumbnail_url, video_url,
                updated_at
           from marketing.ad_snapshots
          order by snapshot_date desc, snapshot_id asc`,
      );
      return rows.map(mapSnapshotRow);
    })(),
  );
}

// ---------------------------------------------------------------------------
// marketing.daily_aggregates (VIEW) -> getDailyAggregates
// ---------------------------------------------------------------------------
// Read-only view over ad_snapshots (no updated_at column; one row per date).
export async function getDailyAggregatesFromSupabase(): Promise<
  AirtableRecord[]
> {
  return withTimeout(
    "daily_aggregates",
    (async () => {
      const { rows } = await getPool().query(
        `select date, total_spend, impressions, reach, clicks, blended_ctr,
                cpc, cpm, roas, cpa, total_purchases, revenue, active_ads,
                active_campaigns
           from marketing.daily_aggregates
          order by date desc`,
      );
      return rows.map(mapDailyAggregateRow);
    })(),
  );
}

// ---------------------------------------------------------------------------
// marketing.ad_alerts -> getAlerts
// ---------------------------------------------------------------------------
// NOTE: currently 0 rows on BOTH sides (the ad account is paused), so this
// path fails over on-empty to Airtable (also empty) — harmless and by design.
export async function getAlertsFromSupabase(): Promise<AirtableRecord[]> {
  return withTimeout(
    "ad_alerts",
    (async () => {
      const { rows } = await getPool().query(
        `select alert_id, alert_date, type, severity, ad_id, ad_name, message,
                metric_value, threshold, acknowledged, updated_at
           from marketing.ad_alerts
          order by alert_date desc, alert_id asc`,
      );
      return rows.map(mapAlertRow);
    })(),
  );
}

// ---------------------------------------------------------------------------
// marketing.shopify_daily_sales -> getShopifySales
// ---------------------------------------------------------------------------
export async function getShopifySalesFromSupabase(): Promise<
  AirtableRecord[]
> {
  return withTimeout(
    "shopify_daily_sales",
    (async () => {
      const { rows } = await getPool().query(
        `select date, currency, total_orders, gross_revenue, net_revenue,
                total_discounts, last_synced, updated_at
           from marketing.shopify_daily_sales
          order by date desc, currency asc`,
      );
      return rows.map(mapShopifySalesRow);
    })(),
  );
}
