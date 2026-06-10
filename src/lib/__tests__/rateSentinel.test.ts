/**
 * Locks the runtime unit-scale sentinel (WEBDEV-210): a throwOn rate column
 * outside [0, 1] must THROW (so the getter fails over to Airtable), warnOn
 * columns must only console.warn, and multiples (ROAS / Frequency) must never
 * be subject to either — they are simply not listed.
 *
 * Column policy mirror of src/lib/supabase.ts: ctr is throwOn; cvr is
 * warn-only (purchases include Meta view-through attribution, so
 * purchases/clicks can legitimately exceed 1 on low-click days); hook/hold
 * rates warn-only (re-watch overshoot).
 *
 * The fixtures use pg-shaped rows: numeric columns arrive as STRINGS from
 * node-pg (e.g. "0.04054054"), so the sentinel must parse, not typeof-gate.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { assertFractionScale } from "../rateSentinel";

// Mirrors the production policy for marketing.ad_snapshots in supabase.ts.
const SNAPSHOT_COLS = {
  throwOn: ["ctr"],
  warnOn: ["cvr", "hook_rate", "hold_rate"],
  idCols: ["snapshot_id"],
} as const;

/** A healthy fraction-scale row as pg returns it (numerics as strings). */
function healthyRow(overrides: Record<string, unknown> = {}) {
  return {
    snapshot_id: "120237211556740289-2026-01-26",
    ctr: "0.04054054",
    cvr: "0.02272727",
    hook_rate: "0.31",
    hold_rate: "0.12",
    roas: "3.17",
    frequency: "1.28",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assertFractionScale — pass cases", () => {
  it("passes on healthy fraction-scale rows (pg numeric strings)", () => {
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow(), healthyRow({ snapshot_id: "x-2026-01-27" })],
        SNAPSHOT_COLS,
      ),
    ).not.toThrow();
  });

  it("passes on an empty result set", () => {
    expect(() =>
      assertFractionScale("marketing.ad_snapshots", [], SNAPSHOT_COLS),
    ).not.toThrow();
  });

  it("passes at exactly 0 and exactly 1 (true 0% / 100% rates; the range check is exclusive)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ ctr: "1", cvr: 0, hook_rate: "0" })],
        SNAPSHOT_COLS,
      ),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("skips null / undefined / missing cells (Airtable-sparse parity)", () => {
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ ctr: null, cvr: undefined, hook_rate: null })],
        SNAPSHOT_COLS,
      ),
    ).not.toThrow();
  });

  it("skips non-numeric junk — scale is this sentinel's job, shape is the mappers'/parity's", () => {
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ ctr: "not-a-number", cvr: "" })],
        SNAPSHOT_COLS,
      ),
    ).not.toThrow();
  });

  it("ignores multiples > 1 on columns that are not listed (ROAS 317.5, Frequency 12.8)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ roas: "317.5", frequency: "12.8" })],
        SNAPSHOT_COLS,
      ),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("assertFractionScale — throwOn (percent-scale drift)", () => {
  it("throws when ctr is percent-scale, naming source, column, count and example row", () => {
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [
          healthyRow(),
          healthyRow({ snapshot_id: "drifted-2026-01-27", ctr: "4.05" }),
        ],
        SNAPSHOT_COLS,
      ),
    ).toThrow(
      // The sentinel's error is a single line, so plain `.*` spans it (the
      // repo tsconfig target predates the es2018 `s` flag).
      /marketing\.ad_snapshots.*ctr outside \[0, 1\] in 1\/2 rows.*drifted-2026-01-27.*"4\.05".*FRACTIONS/,
    );
  });

  it("throws on a NEGATIVE throwOn value — a rate outside [0, 1] is corrupt in either direction", () => {
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ ctr: "-0.04" })],
        SNAPSHOT_COLS,
      ),
    ).toThrow(/ctr outside \[0, 1\] in 1\/1 rows/);
  });

  it("throws on a plain-number percent value too (not just pg strings)", () => {
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ ctr: 4.05 })],
        SNAPSHOT_COLS,
      ),
    ).toThrow(/ctr outside \[0, 1\]/);
  });

  it("reports every drifted throwOn column in one error (generic multi-column policy)", () => {
    expect(() =>
      assertFractionScale(
        "test.source",
        [{ id: "r1", a: "4.05", b: "2.27" }],
        { throwOn: ["a", "b"], idCols: ["id"] },
      ),
    ).toThrow(/a outside \[0, 1\] in 1\/1 rows.*b outside \[0, 1\] in 1\/1 rows/);
  });

  it("throws for blended_ctr with the daily_aggregates column policy", () => {
    expect(() =>
      assertFractionScale(
        "marketing.daily_aggregates",
        [{ date: "2026-01-26", blended_ctr: "2.36", roas: "3.1" }],
        { throwOn: ["blended_ctr"], idCols: ["date"] },
      ),
    ).toThrow(/blended_ctr outside \[0, 1\].*2026-01-26/);
  });

  it("falls back to the row index when every id column is absent from the row", () => {
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ snapshot_id: null, ctr: "4.05" })],
        SNAPSHOT_COLS,
      ),
    ).toThrow(/row 0/);
  });

  it("joins composite idCols with | in the example id", () => {
    expect(() =>
      assertFractionScale(
        "test.source",
        [{ platform: "Instagram", date: "2026-06-01", er: "8.7" }],
        { throwOn: ["er"], idCols: ["platform", "date"] },
      ),
    ).toThrow(/Instagram\|2026-06-01/);
  });
});

describe("assertFractionScale — warnOn (tolerated overshoot)", () => {
  it("console.warns without throwing when cvr exceeds 1 (view-through purchases > clicks)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ cvr: "2.0" })],
        SNAPSHOT_COLS,
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/cvr outside \[0, 1\] in 1\/1 rows/);
  });

  it("console.warns without throwing when hook_rate exceeds 1", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ hook_rate: "1.23" })],
        SNAPSHOT_COLS,
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/hook_rate outside \[0, 1\] in 1\/1 rows/);
  });

  it("still throws on a throwOn violation when a warnOn column also trips (warn first, then throw)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ ctr: "4.05", hold_rate: "1.5" })],
        SNAPSHOT_COLS,
      ),
    ).toThrow(/ctr outside \[0, 1\]/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/hold_rate outside \[0, 1\]/);
  });
});
