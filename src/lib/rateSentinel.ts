/**
 * Runtime unit-scale sentinel for the Supabase read path (WEBDEV-210).
 *
 * WHY THIS EXISTS: the dashboard renders rate metrics as `num(value) * 100`,
 * so the stored values MUST be fractions (ctr 0.0405 = 4.05%). Today that
 * invariant is enforced upstream by Airtable's `percent` field type (the
 * dual-write would visibly break in Airtable if the writer switched to
 * percents) and locked at the mapper layer by supabaseMappers.test.ts — but
 * the mapper tests run on FIXTURES, so nothing at runtime notices if the
 * upstream writer ever starts storing percent-scale values in Postgres. Once
 * the WEBDEV-191 ETL rewrite retires the Airtable dual-write, this sentinel
 * is the ONLY thing standing between writer drift and every CTR rendering
 * 100x too large.
 *
 * Mechanism: scan the raw pg rows inside each Supabase getter, BEFORE the
 * mapped envelope is returned. A violation on a throwOn column throws, which
 * lands in the caller's existing catch in airtable.ts and FAILS OVER to the
 * Airtable read — a loud, correct degradation instead of silently-wrong
 * charts. (After dual-write retirement that failover serves stale-but-
 * correctly-scaled data, with the error in the Vercel logs — still the right
 * trade.)
 *
 * Column policy (from the WEBDEV-194 deep review):
 *   - throwOn:  ctr / cvr / blended_ctr — clicks-per-impression and
 *     purchases-per-click cannot legitimately exceed 1 (100%) at fraction
 *     scale; a value > 1 means percent-scale drift.
 *   - warnOn:   hook_rate / hold_rate — video-view rates CAN edge past 1 in
 *     rare legitimate cases (re-watches count multiple views against one
 *     impression), so they only console.warn.
 *   - NEVER list roas / frequency — they are multiples (3.17x, 1.28) and
 *     legitimately exceed 1.
 *
 * LIMITATION (by design): a tripwire, not a proof. Percent-scale drift on a
 * metric whose real value is under 1% (e.g. ctr 0.5% stored as 0.5) stays
 * under the threshold; the scheduled parity run
 * (.github/workflows/parity.yml) covers that gap while the dual-write window
 * lasts. Pure module (no I/O) so vitest exercises it directly.
 */

type Row = Record<string, unknown>;

export interface RateSentinelCols {
  /** Columns whose value > 1 throws (fails the Supabase read over to Airtable). */
  throwOn: readonly string[];
  /** Columns whose value > 1 only logs a console.warn. */
  warnOn?: readonly string[];
  /** Column used to identify the first offending row in messages (e.g. "snapshot_id"). */
  idCol?: string;
}

/** Number(v) for numbers and pg numeric strings; NaN for everything else. */
function asNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

interface ColumnViolation {
  column: string;
  count: number;
  max: number;
  exampleId: string;
  exampleValue: unknown;
}

function scanColumn(
  rows: Row[],
  column: string,
  idCol: string | undefined,
): ColumnViolation | null {
  let count = 0;
  let max = -Infinity;
  let exampleId = "";
  let exampleValue: unknown;
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i][column];
    // null/undefined = sparse cell, skip. Non-numeric junk is a SHAPE
    // problem, not a scale problem — the mapper tests and parity run own
    // that class; the sentinel stays narrowly about magnitude.
    if (v === null || v === undefined) continue;
    const n = asNumber(v);
    if (!Number.isFinite(n)) continue;
    if (n > 1) {
      count++;
      if (n > max) max = n;
      if (count === 1) {
        exampleId = idCol ? String(rows[i][idCol] ?? `row ${i}`) : `row ${i}`;
        exampleValue = v;
      }
    }
  }
  return count > 0
    ? { column, count, max, exampleId, exampleValue }
    : null;
}

/**
 * Assert that the listed rate columns are fraction-scale (<= 1) across all
 * rows. Throws on any throwOn violation; console.warns on warnOn violations.
 * Values of exactly 1 (a true 100% rate) pass.
 */
export function assertFractionScale(
  source: string,
  rows: Row[],
  cols: RateSentinelCols,
): void {
  for (const column of cols.warnOn ?? []) {
    const v = scanColumn(rows, column, cols.idCol);
    if (v) {
      console.warn(
        `[unit-sentinel] ${source}: ${v.column} > 1 in ${v.count}/${rows.length} rows ` +
          `(max ${v.max}, e.g. ${v.exampleId} = ${JSON.stringify(v.exampleValue)}) — ` +
          `tolerated (this rate can legitimately exceed 1), but if a throwOn ` +
          `metric also trips, suspect percent-scale writer drift.`,
      );
    }
  }

  const violations = cols.throwOn
    .map((column) => scanColumn(rows, column, cols.idCol))
    .filter((v): v is ColumnViolation => v !== null);

  if (violations.length > 0) {
    const detail = violations
      .map(
        (v) =>
          `${v.column} > 1 in ${v.count}/${rows.length} rows ` +
          `(max ${v.max}, e.g. ${v.exampleId} = ${JSON.stringify(v.exampleValue)})`,
      )
      .join("; ");
    throw new Error(
      `[unit-sentinel] ${source}: ${detail}. Rate columns must be FRACTIONS ` +
        `(0.0405 = 4.05%) — values above 1 mean the upstream writer drifted to ` +
        `percent scale, which the dashboard would render 100x too large. ` +
        `Failing this read so the caller falls back to Airtable.`,
    );
  }
}
