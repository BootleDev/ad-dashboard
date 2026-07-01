/**
 * Runtime unit-scale sentinel for the Supabase read path (WEBDEV-210).
 *
 * WHY THIS EXISTS: the dashboard renders rate metrics as `num(value) * 100`,
 * so the stored values MUST be fractions (ctr 0.0405 = 4.05%). Today that
 * invariant is enforced upstream by Airtable's `percent` field type (the
 * dual-write would visibly break in Airtable if the writer switched to
 * percents) and locked at the mapper layer by supabaseMappers.test.ts — but
 * the mapper tests run on FIXTURES, so nothing at runtime notices if the
 * upstream writer ever starts storing percent-scale values in Postgres. With
 * the Supabase read as the sole source (WEBDEV-216 retired the Airtable
 * fallback), this sentinel is the ONLY thing standing between writer drift and
 * every CTR rendering 100x too large.
 *
 * Mechanism: scan the raw pg rows inside each Supabase getter, BEFORE the
 * mapped envelope is returned. A violation on a throwOn column throws; the
 * error propagates to the caller (the route's try/catch → 500) — a loud,
 * correct 500 instead of silently-wrong charts. (WEBDEV-216 retired the
 * Airtable failover this used to trip the read over to.)
 *
 * Column policy (WEBDEV-194 deep review, revised by the WEBDEV-210 review):
 *   - throwOn:  ctr / blended_ctr — clicks-per-impression cannot meaningfully
 *     exceed 1 (100%) at fraction scale; a value > 1 means percent-scale
 *     drift. NEGATIVE values also throw — a rate outside [0, 1] is corrupt
 *     whatever the cause.
 *   - warnOn:   cvr / hook_rate / hold_rate — these CAN legitimately edge
 *     past 1: cvr is purchases/clicks where purchases include Meta
 *     VIEW-THROUGH attribution (purchases can outnumber clicks on low-click
 *     retargeting days — verified in the n8n ETL formula), and video-view
 *     rates can count re-watches against one impression. They only
 *     console.warn. Drift detection is NOT weakened: a writer that drifts to
 *     percents drifts ctr on the same rows, which throws and fails the whole
 *     read anyway.
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
  /** Columns whose value outside [0, 1] throws (fails the Supabase read → 500). */
  throwOn: readonly string[];
  /** Columns whose value outside [0, 1] only logs a console.warn. */
  warnOn?: readonly string[];
  /**
   * Columns concatenated with "|" to identify the first offending row in
   * messages (e.g. ["snapshot_id"]; a composite like ["platform", "date"]
   * when no single column is unique).
   */
  idCols?: readonly string[];
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

function rowId(
  row: Row,
  index: number,
  idCols: readonly string[] | undefined,
): string {
  if (!idCols || idCols.length === 0) return `row ${index}`;
  const parts = idCols.map((c) =>
    row[c] === null || row[c] === undefined ? "?" : String(row[c]),
  );
  // All id columns empty -> fall back to the row index.
  return parts.every((p) => p === "?") ? `row ${index}` : parts.join("|");
}

function scanColumn(
  rows: Row[],
  column: string,
  idCols: readonly string[] | undefined,
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
    // A fraction-scale rate lives in [0, 1]: > 1 is the percent-drift
    // signature, < 0 is corrupt whatever the cause.
    if (n > 1 || n < 0) {
      count++;
      if (n > max) max = n;
      if (count === 1) {
        exampleId = rowId(rows[i], i, idCols);
        exampleValue = v;
      }
    }
  }
  return count > 0
    ? { column, count, max, exampleId, exampleValue }
    : null;
}

/**
 * Assert that the listed rate columns are fraction-scale (within [0, 1])
 * across all rows. Throws on any throwOn violation; console.warns on warnOn
 * violations. Values of exactly 0 or 1 (true 0% / 100% rates) pass.
 */
export function assertFractionScale(
  source: string,
  rows: Row[],
  cols: RateSentinelCols,
): void {
  for (const column of cols.warnOn ?? []) {
    const v = scanColumn(rows, column, cols.idCols);
    if (v) {
      console.warn(
        `[unit-sentinel] ${source}: ${v.column} outside [0, 1] in ${v.count}/${rows.length} rows ` +
          `(max ${v.max}, e.g. ${v.exampleId} = ${JSON.stringify(v.exampleValue)}) — ` +
          `tolerated (this rate can legitimately exceed 1), but if a throwOn ` +
          `metric also trips, suspect percent-scale writer drift.`,
      );
    }
  }

  const violations = cols.throwOn
    .map((column) => scanColumn(rows, column, cols.idCols))
    .filter((v): v is ColumnViolation => v !== null);

  if (violations.length > 0) {
    const detail = violations
      .map(
        (v) =>
          `${v.column} outside [0, 1] in ${v.count}/${rows.length} rows ` +
          `(max ${v.max}, e.g. ${v.exampleId} = ${JSON.stringify(v.exampleValue)})`,
      )
      .join("; ");
    throw new Error(
      `[unit-sentinel] ${source}: ${detail}. Rate columns must be FRACTIONS ` +
        `in [0, 1] (0.0405 = 4.05%) — values above 1 mean the upstream writer ` +
        `drifted to percent scale (rendered 100x too large by the dashboard); ` +
        `negative values are corrupt either way. Failing this read so the ` +
        `caller returns a 500 instead of rendering wrong-scale rates.`,
    );
  }
}
