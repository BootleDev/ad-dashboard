"use client";

import { useMemo } from "react";
import { num, str } from "@/lib/utils";
import type { Fields } from "@/lib/utils";

interface Props {
  mergedAds: Fields[];
}

interface DNAInsight {
  combo: string;
  count: number;
  avgCTR: number;
  avgROAS: number;
  avgCPA: number;
  avgScore: number;
  topAd: string;
}

export default function CreativeDNA({ mergedAds }: Props) {
  const insights = useMemo(() => {
    // Group by Format × Hook Type combination
    const combos: Record<string, { ads: Fields[] }> = {};

    for (const ad of mergedAds) {
      const format = str(ad["Format"]) || "Unknown";
      const hook = str(ad["Hook Type"]) || "Unknown";
      const key = `${format} + ${hook}`;
      if (!combos[key]) combos[key] = { ads: [] };
      combos[key].ads.push(ad);
    }

    const results: DNAInsight[] = Object.entries(combos)
      .filter(([, v]) => v.ads.length >= 1)
      .map(([combo, { ads }]) => {
        const ctrs = ads.map((a) => num(a["CTR"]) * 100);
        const roass = ads.map((a) => num(a["ROAS"]));
        const cpas = ads.map((a) => num(a["CPA"]));
        const scores = ads.map((a) => num(a["Composite Score"]));
        const avg = (arr: number[]) =>
          arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

        // Find top performer by score
        const topIdx = scores.indexOf(Math.max(...scores));
        const topAd = str(ads[topIdx]?.["Ad Name"]) || "—";

        return {
          combo,
          count: ads.length,
          avgCTR: avg(ctrs),
          avgROAS: avg(roass),
          avgCPA: avg(cpas),
          avgScore: avg(scores),
          topAd,
        };
      })
      .sort((a, b) => b.avgScore - a.avgScore);

    return results;
  }, [mergedAds]);

  // Compute overall averages for comparison
  const overallAvg = useMemo(() => {
    if (mergedAds.length === 0)
      return { ctr: 0, roas: 0, cpa: 0, score: 0 };
    const avg = (field: string, mult = 1) =>
      mergedAds.reduce((a, ad) => a + num(ad[field]) * mult, 0) /
      mergedAds.length;
    return {
      ctr: avg("CTR", 100),
      roas: avg("ROAS"),
      cpa: avg("CPA"),
      score: avg("Composite Score"),
    };
  }, [mergedAds]);

  // Generate narrative insights
  const narratives = useMemo(() => {
    const lines: string[] = [];
    const top = insights[0];
    if (top && top.avgScore > 0) {
      lines.push(
        `Best creative DNA: ${top.combo} (avg score ${top.avgScore.toFixed(1)}, ${top.count} ad${top.count > 1 ? "s" : ""}).`
      );
    }

    // Find combos that beat the average by >50%
    for (const i of insights) {
      if (i.avgCTR > overallAvg.ctr * 1.5 && i.avgCTR > 0) {
        lines.push(
          `${i.combo} drives ${(i.avgCTR / Math.max(0.01, overallAvg.ctr)).toFixed(1)}x the average CTR.`
        );
        break;
      }
    }

    // Find worst performer
    const worst = insights[insights.length - 1];
    if (worst && worst.avgScore < overallAvg.score * 0.5 && insights.length > 2) {
      lines.push(
        `Underperformer: ${worst.combo} scores ${worst.avgScore.toFixed(1)} — consider retiring this combination.`
      );
    }

    if (lines.length === 0) {
      lines.push("Not enough variety in creative combinations to identify patterns yet.");
    }

    return lines;
  }, [insights, overallAvg]);

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
    >
      <h3
        className="text-sm font-medium mb-4"
        style={{ color: "var(--text-secondary)" }}
      >
        Creative DNA Analysis
      </h3>

      {/* Narrative insights */}
      <div className="space-y-2 mb-4">
        {narratives.map((line, i) => (
          <p key={i} className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {line}
          </p>
        ))}
      </div>

      {/* Combo table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th className="px-3 py-2 text-left" style={{ color: "var(--text-secondary)" }}>
                Format + Hook
              </th>
              <th className="px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                Ads
              </th>
              <th className="px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                Avg CTR
              </th>
              <th className="px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                Avg Score
              </th>
              <th className="px-3 py-2 text-left" style={{ color: "var(--text-secondary)" }}>
                Top Ad
              </th>
            </tr>
          </thead>
          <tbody>
            {insights.slice(0, 10).map((row, i) => (
              <tr
                key={i}
                className="hover:bg-white/5 transition-colors"
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td className="px-3 py-2 font-medium">{row.combo}</td>
                <td className="px-3 py-2 text-right">{row.count}</td>
                <td className="px-3 py-2 text-right">
                  <span
                    className={
                      row.avgCTR > overallAvg.ctr
                        ? "text-green-400"
                        : "text-red-400"
                    }
                  >
                    {row.avgCTR.toFixed(2)}%
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span
                    className={
                      row.avgScore > overallAvg.score
                        ? "text-green-400"
                        : row.avgScore > overallAvg.score * 0.7
                          ? "text-amber-400"
                          : "text-red-400"
                    }
                  >
                    {row.avgScore.toFixed(1)}
                  </span>
                </td>
                <td className="px-3 py-2 truncate max-w-[150px]">{row.topAd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
