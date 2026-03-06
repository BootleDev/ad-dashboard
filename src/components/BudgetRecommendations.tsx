"use client";

import { useMemo } from "react";
import { num, str } from "@/lib/utils";
import type { Fields } from "@/lib/utils";

interface Props {
  mergedAds: Fields[];
}

interface BudgetRec {
  action: "increase" | "decrease" | "pause";
  adName: string;
  reason: string;
  currentSpend: number;
  suggestedChange: string;
}

export default function BudgetRecommendations({ mergedAds }: Props) {
  const recommendations = useMemo(() => {
    const recs: BudgetRec[] = [];

    // Only consider ads with actual spend
    const adsWithSpend = mergedAds.filter((a) => num(a["Spend"]) > 0);
    if (adsWithSpend.length === 0) return recs;

    // Calculate averages
    const avgCTR =
      adsWithSpend.reduce((s, a) => s + num(a["CTR"]), 0) / adsWithSpend.length;
    const avgCPA =
      adsWithSpend.reduce((s, a) => s + num(a["CPA"]), 0) / adsWithSpend.length;
    const totalSpend = adsWithSpend.reduce((s, a) => s + num(a["Spend"]), 0);

    for (const ad of adsWithSpend) {
      const name = str(ad["Ad Name"]);
      const spend = num(ad["Spend"]);
      const ctr = num(ad["CTR"]);
      const cpa = num(ad["CPA"]);
      const roas = num(ad["ROAS"]);
      const score = num(ad["Composite Score"]);
      const spendShare = totalSpend > 0 ? spend / totalSpend : 0;

      // High performer with low spend share → scale up
      if (score >= 7 && ctr > avgCTR * 1.2 && spendShare < 0.3) {
        recs.push({
          action: "increase",
          adName: name,
          reason: `Score ${score.toFixed(1)}, CTR ${(ctr * 100).toFixed(1)}% (${((ctr / Math.max(0.001, avgCTR)) * 100 - 100).toFixed(0)}% above avg)`,
          currentSpend: spend,
          suggestedChange: `+${Math.round(spend * 0.5)}€/day`,
        });
      }

      // Low performer with high spend → scale down
      if (score <= 3 && spend > totalSpend * 0.1) {
        recs.push({
          action: "decrease",
          adName: name,
          reason: `Score ${score.toFixed(1)}, consuming ${(spendShare * 100).toFixed(0)}% of budget`,
          currentSpend: spend,
          suggestedChange: `-${Math.round(spend * 0.5)}€/day`,
        });
      }

      // Very high CPA with low ROAS → pause
      if (cpa > avgCPA * 2 && cpa > 0 && roas < 1 && spend > 10) {
        recs.push({
          action: "pause",
          adName: name,
          reason: `CPA €${cpa.toFixed(2)} (${((cpa / Math.max(0.01, avgCPA)) * 100 - 100).toFixed(0)}% above avg), ROAS ${roas.toFixed(2)}x`,
          currentSpend: spend,
          suggestedChange: "Pause",
        });
      }

      // High frequency (fatigue) → reduce
      if (num(ad["Frequency"]) > 3 && spend > 5) {
        recs.push({
          action: "decrease",
          adName: name,
          reason: `Frequency ${num(ad["Frequency"]).toFixed(1)} — audience fatigue`,
          currentSpend: spend,
          suggestedChange: `-${Math.round(spend * 0.3)}€/day`,
        });
      }
    }

    // Deduplicate by ad name (keep most impactful)
    const seen = new Set<string>();
    return recs.filter((r) => {
      if (seen.has(r.adName)) return false;
      seen.add(r.adName);
      return true;
    }).slice(0, 6);
  }, [mergedAds]);

  const actionStyle = {
    increase: "bg-green-500/10 border-green-500/20 text-green-400",
    decrease: "bg-amber-500/10 border-amber-500/20 text-amber-400",
    pause: "bg-red-500/10 border-red-500/20 text-red-400",
  };

  const actionLabel = {
    increase: "Scale Up",
    decrease: "Scale Down",
    pause: "Pause",
  };

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-sm font-medium mb-4" style={{ color: "var(--text-secondary)" }}>
        Budget Allocation Recommendations
      </h3>

      {recommendations.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          No strong budget shifts recommended — performance is relatively balanced. When campaigns resume with fresh data, recommendations will appear here.
        </p>
      ) : (
        <div className="space-y-2">
          {recommendations.map((rec, i) => (
            <div
              key={i}
              className={`text-xs rounded-lg px-3 py-2 border ${actionStyle[rec.action]}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium truncate mr-2">{rec.adName}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold">{rec.suggestedChange}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${actionStyle[rec.action]}`}
                  >
                    {actionLabel[rec.action]}
                  </span>
                </div>
              </div>
              <div style={{ color: "var(--text-secondary)" }}>{rec.reason}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
