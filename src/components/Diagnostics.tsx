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
  shopifySales?: AirtableRecord[];
  showShopify?: boolean;
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
  shopifySales = [],
  showShopify = false,
}: Props) {
  // Aggregate across all active days (spend > 0) for reliable diagnostics
  const { metrics, latestDate } = useMemo(() => {
    const sorted = [...dailyAggregates].sort((a, b) =>
      String(b.fields.Date ?? "").localeCompare(String(a.fields.Date ?? "")),
    );
    const activeDays = sorted.filter((r) => num(r.fields["Total Spend"]) > 0);
    const allDays = sorted;

    const totalSpend = activeDays.reduce(
      (s, r) => s + num(r.fields["Total Spend"]),
      0,
    );
    const totalImpressions = activeDays.reduce(
      (s, r) => s + num(r.fields["Impressions"]),
      0,
    );
    const totalClicks = activeDays.reduce(
      (s, r) => s + num(r.fields["Clicks"]),
      0,
    );
    const totalRevenue = activeDays.reduce(
      (s, r) => s + num(r.fields["Revenue"]),
      0,
    );
    const totalPurchases = activeDays.reduce(
      (s, r) => s + num(r.fields["Total Purchases"]),
      0,
    );

    const lastActive = activeDays[0];
    const date = lastActive
      ? String(lastActive.fields.Date ?? "").split("T")[0]
      : "";

    return {
      metrics: {
        cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
        ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
        cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
        roas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
        cpa: totalPurchases > 0 ? totalSpend / totalPurchases : 0,
        impressions: totalImpressions,
        clicks: totalClicks,
        purchases: totalPurchases,
      },
      latestDate: date,
    };
  }, [dailyAggregates]);

  // Shopify aggregates for True ROAS/CPA
  const shopifyTotals = useMemo(() => {
    const revenue = shopifySales.reduce(
      (s, r) => s + num(r.fields["Gross Revenue"]),
      0,
    );
    const orders = shopifySales.reduce(
      (s, r) => s + num(r.fields["Total Orders"]),
      0,
    );
    return { revenue, orders };
  }, [shopifySales]);

  // Diagnostic decision tree
  const nodes: DiagNode[] = useMemo(() => {
    const { cpm, ctr, cpc, roas, cpa } = metrics;

    // Recalculate True ROAS/CPA from totals when Shopify data is available
    const totalSpend =
      metrics.impressions > 0 ? (metrics.cpm * metrics.impressions) / 1000 : 0;
    const trueRoas =
      showShopify && shopifyTotals.orders > 0 && totalSpend > 0
        ? shopifyTotals.revenue / totalSpend
        : roas;
    const trueCpa =
      showShopify && shopifyTotals.orders > 0 && totalSpend > 0
        ? totalSpend / shopifyTotals.orders
        : cpa;

    return [
      {
        label: "CPM",
        metric: "Cost per 1,000 views",
        status: cpm < 14 ? "good" : cpm < 22 ? "warning" : "bad",
        value: `€${cpm.toFixed(2)}`,
        recommendation:
          cpm >= 22
            ? "High CPM — audience saturated or targeting too narrow. Try broader audiences or new placements."
            : cpm >= 14
              ? "CPM is normal for UK/EU. Monitor for upward creep."
              : "CPM is efficient for UK/EU market.",
      },
      {
        label: "CTR",
        metric: "Click-through rate (all clicks)",
        status: ctr >= 3.5 ? "good" : ctr >= 2.0 ? "warning" : "bad",
        value: `${ctr.toFixed(2)}%`,
        recommendation:
          ctr < 2.0
            ? "Low CTR — creatives aren't engaging. Test new hooks, headlines, and thumbnails."
            : ctr < 3.5
              ? "CTR is below benchmark for engaging content. A/B test ad copy and CTAs."
              : "CTR is strong — creatives are resonating.",
      },
      {
        label: "CPC",
        metric: "Cost per click",
        status: cpc < 0.5 ? "good" : cpc < 1.0 ? "warning" : "bad",
        value: `€${cpc.toFixed(2)}`,
        recommendation:
          cpc >= 1.0
            ? "High CPC — consider better audience-creative match. Relevance score may be low."
            : cpc >= 0.5
              ? "CPC is acceptable but could improve with creative refresh."
              : "CPC is efficient.",
      },
      {
        label:
          showShopify && shopifyTotals.orders > 0
            ? "True ROAS (Shopify)"
            : "ROAS",
        metric: "Return on ad spend",
        status: trueRoas >= 2.5 ? "good" : trueRoas >= 1.5 ? "warning" : "bad",
        value: `${trueRoas.toFixed(2)}x`,
        recommendation:
          trueRoas < 1.5
            ? "ROAS below break-even (~1.8x for Bootle). Focus on conversion funnel and product-market fit."
            : trueRoas < 2.5
              ? "ROAS is positive but below target (2.5x). Optimise conversion path."
              : "ROAS is at or above target — scaling opportunity.",
      },
      {
        label:
          showShopify && shopifyTotals.orders > 0
            ? "True Cost/Order (Shopify)"
            : "Cost per Order",
        metric: "Cost per acquisition",
        status:
          trueCpa === 0
            ? "warning"
            : trueCpa < 30
              ? "good"
              : trueCpa < 55
                ? "warning"
                : "bad",
        value: trueCpa > 0 ? `€${trueCpa.toFixed(2)}` : "No orders",
        recommendation:
          trueCpa === 0
            ? "No purchases recorded. Focus on conversion rate optimisation before scaling spend."
            : trueCpa >= 55
              ? "CPA exceeds product value (€55). Review audience quality and landing page conversion rate."
              : trueCpa >= 30
                ? "CPA above breakeven (~€30). Look for funnel optimisation opportunities."
                : "CPA is profitable — below contribution margin.",
      },
    ];
  }, [metrics, showShopify, shopifyTotals]);

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

  // Funnel data from aggregated metrics
  const impressions = metrics.impressions;
  const clicks = metrics.clicks;
  const purchases = metrics.purchases;

  // Use Math.max(1, val) to prevent log(0) crash
  const funnelLabels =
    showShopify && shopifyTotals.orders > 0
      ? ["Impressions", "Clicks", "Purchases (Meta)", "Orders (Shopify)"]
      : ["Impressions", "Clicks", "Purchases"];
  const funnelValues =
    showShopify && shopifyTotals.orders > 0
      ? [impressions, clicks, purchases, shopifyTotals.orders]
      : [impressions, clicks, purchases];
  const funnelColors =
    showShopify && shopifyTotals.orders > 0
      ? [
          CHART_COLORS.blue,
          CHART_COLORS.amber,
          CHART_COLORS.green,
          CHART_COLORS.purple,
        ]
      : [CHART_COLORS.blue, CHART_COLORS.amber, CHART_COLORS.green];

  const funnelData = {
    labels: funnelLabels,
    datasets: [
      {
        label: "Volume",
        data: funnelValues.map((v) => Math.max(1, v)),
        backgroundColor: funnelColors,
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
          Diagnostic Flow (All Active Days)
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

        <ChartCard title="Funnel (All Active Days)">
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
