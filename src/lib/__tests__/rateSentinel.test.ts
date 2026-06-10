/**
 * Locks the runtime unit-scale sentinel (WEBDEV-210): percent-scale drift on
 * a throwOn rate column must THROW (so the getter fails over to Airtable),
 * warnOn columns must only console.warn, and multiples (ROAS / Frequency)
 * must never be subject to either — they are simply not listed.
 *
 * The fixtures use pg-shaped rows: numeric columns arrive as STRINGS from
 * node-pg (e.g. "0.04054054"), so the sentinel must parse, not typeof-gate.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { assertFractionScale } from "../rateSentinel";

const SNAPSHOT_COLS = {
  throwOn: ["ctr", "cvr"],
  warnOn: ["hook_rate", "hold_rate"],
  idCol: "snapshot_id",
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

  it("passes at exactly 1 (a true 100% rate is legitimate; the check is strictly > 1)", () => {
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ ctr: "1", cvr: 1 })],
        SNAPSHOT_COLS,
      ),
    ).not.toThrow();
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

  it("ignores multiples > 1 on columns that are not listed (ROAS 3.17, Frequency 1.28)", () => {
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
      /marketing\.ad_snapshots.*ctr > 1 in 1\/2 rows.*drifted-2026-01-27.*"4\.05".*FRACTIONS/,
    );
  });

  it("throws on percent-scale cvr (plain number, not just pg string)", () => {
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ cvr: 2.27 })],
        SNAPSHOT_COLS,
      ),
    ).toThrow(/cvr > 1/);
  });

  it("reports every drifted throwOn column in one error", () => {
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ ctr: "4.05", cvr: "2.27" })],
        SNAPSHOT_COLS,
      ),
    ).toThrow(/ctr > 1 in 1\/1 rows.*cvr > 1 in 1\/1 rows/);
  });

  it("throws for blended_ctr with the daily_aggregates column policy", () => {
    expect(() =>
      assertFractionScale(
        "marketing.daily_aggregates",
        [{ date: "2026-01-26", blended_ctr: "2.36", roas: "3.1" }],
        { throwOn: ["blended_ctr"], idCol: "date" },
      ),
    ).toThrow(/blended_ctr > 1.*2026-01-26/);
  });

  it("falls back to the row index when idCol is absent from the row", () => {
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ snapshot_id: null, ctr: "4.05" })],
        SNAPSHOT_COLS,
      ),
    ).toThrow(/row 0/);
  });
});

describe("assertFractionScale — warnOn (tolerated overshoot)", () => {
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
    expect(warn.mock.calls[0][0]).toMatch(/hook_rate > 1 in 1\/1 rows/);
  });

  it("still throws on a throwOn violation when a warnOn column also trips (warn first, then throw)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      assertFractionScale(
        "marketing.ad_snapshots",
        [healthyRow({ ctr: "4.05", hold_rate: "1.5" })],
        SNAPSHOT_COLS,
      ),
    ).toThrow(/ctr > 1/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/hold_rate > 1/);
  });
});
