/**
 * Unit tests for the per-table kill switch (WEBDEV-194). forcedToAirtable is
 * the ONLY manual rollback mechanism, so the match must survive the values a
 * human actually pastes into Vercel (trailing newline, stray spaces, odd
 * casing), and any unrecognized non-empty value must WARN so the typo is
 * visible in the Vercel logs instead of silently no-oping the rollback.
 *
 * Run manually via `npm test` — there is NO CI in this repo yet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { forcedToAirtable } from "../sourceSwitch";

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("forcedToAirtable — per-table kill switch", () => {
  it('exact "airtable" forces Airtable, no warning', () => {
    expect(forcedToAirtable("airtable", "AD_SNAPSHOTS_SOURCE")).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('tolerates a trailing newline: "airtable\\n" forces Airtable, no warning', () => {
    expect(forcedToAirtable("airtable\n", "AD_SNAPSHOTS_SOURCE")).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('tolerates whitespace + casing: "  Airtable " forces Airtable, no warning', () => {
    expect(forcedToAirtable("  Airtable ", "SHOPIFY_SALES_SOURCE")).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("unset (undefined) stays on the Supabase-first path, no warning", () => {
    expect(forcedToAirtable(undefined, "AD_ALERTS_SOURCE")).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("empty / whitespace-only values behave as unset, no warning", () => {
    expect(forcedToAirtable("", "DAILY_AGGREGATES_SOURCE")).toBe(false);
    expect(forcedToAirtable("  \n", "DAILY_AGGREGATES_SOURCE")).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('an unrecognized value ("airtabel" typo) does NOT force Airtable and WARNS with the var name', () => {
    expect(forcedToAirtable("airtabel", "AD_SNAPSHOTS_SOURCE")).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0][0]);
    expect(message).toContain("AD_SNAPSHOTS_SOURCE");
    expect(message).toContain("airtabel");
  });

  it("warns on EVERY call while misconfigured (no memo — stays visible in logs)", () => {
    forcedToAirtable("supabase", "AD_ALERTS_SOURCE");
    forcedToAirtable("supabase", "AD_ALERTS_SOURCE");
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
