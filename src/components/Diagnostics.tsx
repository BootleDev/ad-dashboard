"use client";

import { Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import ChartCard from "./ChartCard";
import BudgetRecommendations from "./BudgetRecommendations";
import { num, str } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";
import { useMemo } from "react";

interface Props {
  dailyAggregates: AirtableRecord[];
  alerts: AirtableRecord[];
  snapshots: AirtableRecord[];
  tags: AirtableRecord[];
  campaignsPaused?: boolean;
  lastActiveDate?: string | null;
}

interface DiagNode {
  label: string;
  metric: string;
  status: "good" | "warning" | "bad";
  value: string;
  recommendation: string;
}

export default function Diagnostics({
  dailyAggregates,
  alerts,
  snapshots,
  tags,
  campaignsPaused,
}: Props) {
  // Find last day with actual activity (spend > 0), fall back to most recent
  const latest = useMemo(() => {
    const sorted = [...dailyAggregates].sort((a, b) =>
      String(b.fields.Date ?? "").localeCompare(String(a.fields.Date ?? "")),
    );
    const active = sorted.find((r) => num(r.fields["Total Spend"]) > 0);
    return (active || sorted[0])?.fields || {};
  }, [dailyAggregates]);

  // Diagnostic decision tree
  const nodes: DiagNode[] = useMemo(() => {
    const cpm = num(latest["CPM"]);
    const ctr = num(latest["Blended CTR"]);
    const cpc = num(latest["CPC"]);
    const roas = num(latest["ROAS"]);
    const cpa = num(latest["CPA"]);

    return [
      {
        label: "CPM",
        metric: "Cost per 1K impressions",
        status: cpm < 8 ? "good" : cpm < 15 ? "warning" : "bad",
        value: `€${cpm.toFixed(2)}`,
        recommendation:
          cpm >= 15
            ? "High CPM — audience may be saturated. Try broader targeting or new audiences."
            : cpm >= 8
              ? "CPM is moderate. Monitor for creep."
              : "CPM is healthy.",
      },
      {
        label: "CTR",
        metric: "Click-through rate",
        status: ctr >= 1.5 ? "good" : ctr >= 0.8 ? "warning" : "bad",
        value: `${ctr.toFixed(2)}%`,
        recommendation:
          ctr < 0.8
            ? "Low CTR — creatives aren't grabbing attention. Test new hooks, headlines, and thumbnails."
            : ctr < 1.5
              ? "CTR is below benchmark. A/B test ad copy and CTAs."
              : "CTR is strong — creatives are resonating.",
      },
      {
        label: "CPC",
        metric: "Cost per click",
        status: cpc < 1 ? "good" : cpc < 2 ? "warning" : "bad",
        value: `€${cpc.toFixed(2)}`,
        recommendation:
          cpc >= 2
            ? "High CPC — consider better audience-creative match. Relevance score may be low."
            : cpc >= 1
              ? "CPC is acceptable but could improve with creative refresh."
              : "CPC is efficient.",
      },
      {
        label: "CVR → ROAS",
        metric: "Return on ad spend",
        status: roas >= 2.5 ? "good" : roas >= 1.5 ? "warning" : "bad",
        value: `${roas.toFixed(2)}x`,
        recommendation:
          roas < 1.5
            ? "ROAS below break-even. Check landing page, product-market fit, and funnel friction."
            : roas < 2.5
              ? "ROAS is positive but below target (2.5x). Optimise conversion path."
              : "ROAS is at or above target — scaling opportunity.",
      },
      {
        label: "CPA",
        metric: "Cost per acquisition",
        status: cpa < 20 ? "good" : cpa < 40 ? "warning" : "bad",
        value: `€${cpa.toFixed(2)}`,
        recommendation:
          cpa >= 40
            ? "CPA is high — review audience quality and landing page conversion rate."
            : cpa >= 20
              ? "CPA is acceptable. Look for optimisation opportunities in the funnel."
              : "CPA is efficient.",
      },
    ];
  }, [latest]);

  const statusColors = {
    good: "border-green-500/40 bg-green-500/10",
    warning: "border-amber-500/40 bg-amber-500/10",
    bad: "border-red-500/40 bg-red-500/10",
  };

  const statusDot = {
    good: "bg-green-400",
    warning: "bg-amber-400",
    bad: "bg-red-400",
  };

  // Funnel data from latest
  const impressions = num(latest["Impressions"]);
  const clicks = num(latest["Clicks"]);
  const purchases = num(latest["Total Purchases"]);

  // Use Math.max(1, val) to prevent log(0) crash
  const funnelData = {
    labels: ["Impressions", "Clicks", "Purchases"],
    datasets: [
      {
        label: "Volume",
        data: [
          Math.max(1, impressions),
          Math.max(1, clicks),
          Math.max(1, purchases),
        ],
        backgroundColor: [
          CHART_COLORS.blue,
          CHART_COLORS.amber,
          CHART_COLORS.green,
        ],
        borderRadius: 6,
      },
    ],
  };

  const hasData = impressions > 0 || clicks > 0 || purchases > 0;

  const funnelOptions = {
    ...defaultOptions,
    indexAxis: "y" as const,
    scales: {
      x: {
        ...defaultOptions.scales.x,
        ...(hasData ? { type: "logarithmic" as const } : {}),
        title: {
          display: true,
          text: hasData ? "Volume (log scale)" : "Volume",
          color: CHART_COLORS.muted,
        },
      },
      y: {
        ...defaultOptions.scales.y,
        grid: { color: "transparent" },
      },
    },
  };

  // Merge snapshots with tags for budget recommendations — latest snapshot per unique ad
  const tagMap = useMemo(
    () => new Map(tags.map((t) => [str(t.fields["Ad ID"]), t.fields])),
    [tags],
  );
  const mergedAds = useMemo(() => {
    const seen = new Map<string, Record<string, unknown>>();
    for (const s of snapshots) {
      const adId = str(s.fields["Ad ID"]);
      if (!adId || seen.has(adId)) continue;
      const tag = tagMap.get(adId) || {};
      seen.set(adId, { ...s.fields, ...tag });
    }
    return Array.from(seen.values());
  }, [snapshots, tagMap]);

  // Alert-based recommendations
  const recentAlerts = alerts.slice(0, 10).map((a) => a.fields);
  const alertTypes = recentAlerts.reduce<Record<string, number>>((acc, a) => {
    const type = str(a["Type"]);
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Decision Tree */}
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
          Diagnostic Flow (Latest Day)
        </h3>
        <div className="flex flex-col md:flex-row gap-3">
          {nodes.map((node, i) => (
            <div key={i} className="flex items-center gap-3 flex-1">
              <div
                className={`rounded-xl p-4 border flex-1 ${statusColors[node.status]}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className={`w-2 h-2 rounded-full ${statusDot[node.status]}`}
                  />
                  <span className="text-sm font-medium">{node.label}</span>
                </div>
                <div className="text-lg font-bold">{node.value}</div>
                <div
                  className="text-[10px] mt-1"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {node.metric}
                </div>
              </div>
              {i < nodes.length - 1 && (
                <span
                  className="hidden md:block text-lg"
                  style={{ color: "var(--text-secondary)" }}
                >
                  →
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Recommendations */}
      <div className="grid md:grid-cols-2 gap-4">
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
            Recommendations
          </h3>
          <div className="space-y-3">
            {nodes
              .filter((n) => n.status !== "good")
              .map((node, i) => (
                <div
                  key={i}
                  className="text-xs rounded-lg px-3 py-2"
                  style={{ background: "var(--bg-secondary)" }}
                >
                  <span className="font-medium">{node.label}:</span>{" "}
                  {node.recommendation}
                </div>
              ))}
            {nodes.every((n) => n.status === "good") && (
              <p className="text-xs text-green-400">
                All metrics look healthy!
              </p>
            )}
          </div>

          {Object.keys(alertTypes).length > 0 && (
            <>
              <h4
                className="text-sm font-medium mt-5 mb-3"
                style={{ color: "var(--text-secondary)" }}
              >
                Alert Pattern (last 10)
              </h4>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(alertTypes).map(([type, count]) => (
                  <span
                    key={type}
                    className="text-xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  >
                    {type} × {count}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <ChartCard title="Funnel (Latest Day)">
          <Bar data={funnelData} options={funnelOptions} />
        </ChartCard>
      </div>

      {/* Budget Recommendations */}
      <BudgetRecommendations
        mergedAds={mergedAds}
        campaignsPaused={campaignsPaused}
      />
    </div>
  );
}
