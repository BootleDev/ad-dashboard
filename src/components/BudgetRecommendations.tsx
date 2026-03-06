"use client";

import { useMemo } from "react";
import { num, str } from "@/lib/utils";
import type { Fields } from "@/lib/utils";

interface Props {
  mergedAds: Fields[];
  campaignsPaused?: boolean;
}

interface BudgetRec {
  action: "increase" | "decrease" | "pause";
  adName: string;
  reason: string;
  currentSpend: number;
  suggestedChange: string;
}

export default function BudgetRecommendations({
  mergedAds,
  campaignsPaused,
}: Props) {
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
    const avgCPC =
      adsWithSpend.reduce((s, a) => s + num(a["CPC"]), 0) / adsWithSpend.length;
    const totalSpend = adsWithSpend.reduce((s, a) => s + num(a["Spend"]), 0);

    // Check if ANY ads have conversions — used for info banner
    const anyConversions = adsWithSpend.some(
      (a) => num(a["Purchases"]) > 0 || num(a["ROAS"]) > 0,
    );

    for (const ad of adsWithSpend) {
      const name = str(ad["Ad Name"]);
      const spend = num(ad["Spend"]);
      const ctr = num(ad["CTR"]);
      const cpa = num(ad["CPA"]);
      const roas = num(ad["ROAS"]);
      const cpc = num(ad["CPC"]);
      const score = num(ad["Composite Score"]);
      const purchases = num(ad["Purchases"]);
      const spendShare = totalSpend > 0 ? spend / totalSpend : 0;

      // Conversion gate: require actual conversions for "increase" recommendations
      const hasConversions = purchases > 0 || roas > 0;

      // High performer with low spend share → scale up
      // Must have conversions to qualify — prevents recommending scale-up on zero-conversion ads
      const isHighPerformer =
        hasConversions &&
        (score > 0
          ? score >= 6 && ctr > avgCTR * 1.2
          : roas >= 1.5 && ctr > avgCTR * 1.2);

      if (isHighPerformer && spendShare < 0.3) {
        recs.push({
          action: "increase",
          adName: name,
          reason:
            score > 0
              ? `Score ${score.toFixed(1)}, CTR ${(ctr * 100).toFixed(1)}% (${((ctr / Math.max(0.001, avgCTR)) * 100 - 100).toFixed(0)}% above avg)`
              : `ROAS ${roas.toFixed(2)}x, CTR ${(ctr * 100).toFixed(1)}% (${((ctr / Math.max(0.001, avgCTR)) * 100 - 100).toFixed(0)}% above avg)`,
          currentSpend: spend,
          suggestedChange: "Increase budget",
        });
      }

      // Low performer with high spend → scale down
      const isLowPerformer =
        score > 0 ? score <= 3 : roas < 1.0 && cpc > avgCPC * 1.3;

      if (isLowPerformer && spend > totalSpend * 0.1) {
        recs.push({
          action: "decrease",
          adName: name,
          reason:
            score > 0
              ? `Score ${score.toFixed(1)}, consuming ${(spendShare * 100).toFixed(0)}% of budget`
              : `ROAS ${roas.toFixed(2)}x, CPC ${((cpc / Math.max(0.01, avgCPC)) * 100).toFixed(0)}% of avg, consuming ${(spendShare * 100).toFixed(0)}% of budget`,
          currentSpend: spend,
          suggestedChange: "Reduce budget",
        });
      }

      // Zero purchases after significant spend → pause
      if (purchases === 0 && spend > 50 && roas === 0) {
        recs.push({
          action: "pause",
          adName: name,
          reason: `€${spend.toFixed(0)} spent with zero conversions`,
          currentSpend: spend,
          suggestedChange: "Pause",
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

      // High frequency (fatigue) → reduce — lowered from 3 to 1.8 for Bootle's scale
      if (num(ad["Frequency"]) > 1.8 && spend > 5) {
        recs.push({
          action: "decrease",
          adName: name,
          reason: `Frequency ${num(ad["Frequency"]).toFixed(1)} — audience seeing ad too often`,
          currentSpend: spend,
          suggestedChange: "Reduce budget or refresh creative",
        });
      }
    }

    // Deduplicate by ad name (keep most impactful)
    const seen = new Set<string>();
    return recs
      .filter((r) => {
        if (seen.has(r.adName)) return false;
        seen.add(r.adName);
        return true;
      })
      .slice(0, 6);
  }, [mergedAds]);

  // Check if all ads have zero conversions (pixel tracking issue)
  const allZeroConversions = useMemo(() => {
    const adsWithSpend = mergedAds.filter((a) => num(a["Spend"]) > 0);
    return (
      adsWithSpend.length > 0 &&
      adsWithSpend.every(
        (a) => num(a["Purchases"]) === 0 && num(a["ROAS"]) === 0,
      )
    );
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

  const actionTooltip = {
    increase:
      "High Composite Score (6+), CTR 20%+ above average, and confirmed conversions",
    decrease:
      "Low Composite Score (3 or below), high CPC, or frequency above 1.8",
    pause:
      "€50+ spend with zero conversions, or CPA 2x above average with ROAS below 1.0",
  };

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <h3
        className="text-sm font-medium mb-4"
        style={{ color: "var(--text-secondary)" }}
      >
        Budget Allocation Recommendations
      </h3>

      {campaignsPaused && (
        <p
          className="text-xs mb-3 px-3 py-2 rounded-lg"
          style={{
            background: "rgba(245, 158, 11, 0.1)",
            color: "rgb(245, 158, 11)",
          }}
        >
          Campaigns currently paused. When resuming, consider:
        </p>
      )}

      {allZeroConversions && (
        <p
          className="text-xs mb-3 px-3 py-2 rounded-lg"
          style={{
            background: "rgba(168, 85, 247, 0.1)",
            color: "rgb(168, 85, 247)",
          }}
        >
          No conversion data available (pixel tracking issue). Per-ad budget
          recommendations require ad-level conversion tracking. See Diagnostics
          for Shopify-corrected totals.
        </p>
      )}

      {recommendations.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          No strong budget shifts recommended — performance is relatively
          balanced. When campaigns resume with fresh data, recommendations will
          appear here.
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
                    title={actionTooltip[rec.action]}
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
