"use client";

import { Line } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import KPICard from "./KPICard";
import ChartCard from "./ChartCard";
import AlertsFeed from "./AlertsFeed";
import AnomalyDetection from "./AnomalyDetection";
import { useMemo } from "react";
import {
  num,
  str,
  formatCurrency,
  formatPercent,
  formatNumber,
  pctChange,
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";
import type { DateRange } from "./DateRangeFilter";

interface Props {
  dailyAggregates: AirtableRecord[];
  snapshots: AirtableRecord[];
  alerts: AirtableRecord[];
  dateRange: DateRange;
  campaignsPaused: boolean;
  lastActiveDate: string | null;
  shopifySales: AirtableRecord[];
  showShopify: boolean;
}

export default function ExecutiveSummary({
  dailyAggregates,
  snapshots,
  alerts,
  dateRange,
  campaignsPaused,
  lastActiveDate,
  shopifySales,
  showShopify,
}: Props) {
  // Sort daily by date ascending for charts
  const sorted = useMemo(
    () =>
      [...dailyAggregates].sort((a, b) =>
        String(a.fields.Date ?? "").localeCompare(String(b.fields.Date ?? "")),
      ),
    [dailyAggregates],
  );

  // Active days (spend > 0) for rate-based KPIs
  const activeDays = useMemo(
    () => sorted.filter((r) => num(r.fields["Total Spend"]) > 0),
    [sorted],
  );

  // Symmetric period split — equal halves from both ends, middle day dropped on odd N
  const half = Math.floor(activeDays.length / 2);
  const prevPeriod = activeDays.slice(0, half);
  const currentPeriod = activeDays.slice(activeDays.length - half);

  // Date range label
  const firstDate = str(activeDays[0]?.fields.Date).split("T")[0] || "—";
  const lastDate =
    str(activeDays[activeDays.length - 1]?.fields.Date).split("T")[0] || "—";
  const periodLabel =
    dateRange.label === "All Time"
      ? `${firstDate} → ${lastDate} (${activeDays.length} active days)`
      : `${dateRange.label} (${activeDays.length} active days)`;

  const sum = (arr: AirtableRecord[], field: string) =>
    arr.reduce((acc, r) => acc + num(r.fields[field]), 0);

  // Full-period KPIs — all metrics use active days only for consistency
  const totalSpend = sum(activeDays, "Total Spend");
  const totalRevenue = sum(activeDays, "Revenue");
  const totalPurchases = sum(activeDays, "Total Purchases");
  const blendedROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const blendedCPA = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
  const totalImpressions = sum(activeDays, "Impressions");
  const totalClicks = sum(activeDays, "Clicks");
  const avgCPM =
    totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
  const avgCTR =
    totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const avgCPC = totalClicks > 0 ? totalSpend / totalClicks : 0;

  // Previous period KPIs for comparison
  const prevSpend = sum(prevPeriod, "Total Spend");
  const prevRevenue = sum(prevPeriod, "Revenue");
  const prevPurchases = sum(prevPeriod, "Total Purchases");
  const prevROAS = prevSpend > 0 ? prevRevenue / prevSpend : 0;
  const prevCPA = prevPurchases > 0 ? prevSpend / prevPurchases : 0;
  const prevImpressions = sum(prevPeriod, "Impressions");
  const prevClicks = sum(prevPeriod, "Clicks");
  const prevCPM =
    prevImpressions > 0 ? (prevSpend / prevImpressions) * 1000 : 0;
  const prevCTR =
    prevImpressions > 0 ? (prevClicks / prevImpressions) * 100 : 0;
  const prevCPC = prevClicks > 0 ? prevSpend / prevClicks : 0;
  const curSpend = sum(currentPeriod, "Total Spend");
  const curRevenue = sum(currentPeriod, "Revenue");
  const curPurchases = sum(currentPeriod, "Total Purchases");
  const curROAS = curSpend > 0 ? curRevenue / curSpend : 0;
  const curCPA = curPurchases > 0 ? curSpend / curPurchases : 0;
  const curImpressions = sum(currentPeriod, "Impressions");
  const curClicks = sum(currentPeriod, "Clicks");
  const curCPM = curImpressions > 0 ? (curSpend / curImpressions) * 1000 : 0;
  const curCTR = curImpressions > 0 ? (curClicks / curImpressions) * 100 : 0;
  const curCPC = curClicks > 0 ? curSpend / curClicks : 0;

  // Shopify KPIs
  const shopifyRevenue = useMemo(
    () =>
      shopifySales.reduce((acc, r) => acc + num(r.fields["Gross Revenue"]), 0),
    [shopifySales],
  );
  const shopifyOrders = useMemo(
    () =>
      shopifySales.reduce((acc, r) => acc + num(r.fields["Total Orders"]), 0),
    [shopifySales],
  );
  const trueROAS = totalSpend > 0 ? shopifyRevenue / totalSpend : 0;
  const trueCPA = shopifyOrders > 0 ? totalSpend / shopifyOrders : 0;
  const attributionGap =
    shopifyOrders > 0
      ? ((shopifyOrders - totalPurchases) / shopifyOrders) * 100
      : 0;

  // Build Shopify revenue by date map for chart overlay
  const shopifyByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of shopifySales) {
      const d = str(r.fields.Date).split("T")[0];
      if (!d) continue;
      map.set(d, (map.get(d) ?? 0) + num(r.fields["Gross Revenue"]));
    }
    return map;
  }, [shopifySales]);

  // Chart data: all active days in the filtered range
  const labels = activeDays.map((r) => {
    const d = str(r.fields.Date);
    return d ? d.split("T")[0].slice(5) : "";
  });

  const spendRevenueDatasets = [
    {
      label: "Spend",
      data: activeDays.map((r) => num(r.fields["Total Spend"])),
      borderColor: CHART_COLORS.red,
      backgroundColor: `${CHART_COLORS.red}20`,
      fill: true,
      tension: 0.3,
      yAxisID: "y",
    },
    {
      label: "Revenue (Meta)",
      data: activeDays.map((r) => num(r.fields["Revenue"])),
      borderColor: CHART_COLORS.green,
      backgroundColor: `${CHART_COLORS.green}20`,
      fill: true,
      tension: 0.3,
      yAxisID: "y1",
    },
  ];

  // Add Shopify revenue overlay when enabled
  if (showShopify && shopifyByDate.size > 0) {
    spendRevenueDatasets.push({
      label: "Revenue (Shopify)",
      data: activeDays.map((r) => {
        const d = str(r.fields.Date).split("T")[0];
        return shopifyByDate.get(d) ?? 0;
      }),
      borderColor: CHART_COLORS.purple,
      backgroundColor: "transparent",
      fill: false,
      tension: 0.3,
      yAxisID: "y1",
    });
  }

  const spendRevenueData = { labels, datasets: spendRevenueDatasets };

  const spendRevenueOptions = {
    ...defaultOptions,
    scales: {
      ...defaultOptions.scales,
      y: {
        ...defaultOptions.scales.y,
        position: "left" as const,
        title: { display: true, text: "Spend (€)", color: CHART_COLORS.muted },
      },
      y1: {
        ticks: { color: CHART_COLORS.muted, font: { size: 10 } },
        grid: { color: "transparent" },
        position: "right" as const,
        title: {
          display: true,
          text: "Revenue (€)",
          color: CHART_COLORS.muted,
        },
      },
    },
  };

  const roasData = {
    labels,
    datasets: [
      {
        label: "ROAS",
        data: activeDays.map((r) => num(r.fields["ROAS"])),
        borderColor: CHART_COLORS.blue,
        backgroundColor: `${CHART_COLORS.blue}20`,
        fill: true,
        tension: 0.3,
      },
      {
        label: "Target (2.5x)",
        data: activeDays.map(() => 2.5),
        borderColor: CHART_COLORS.amber,
        borderDash: [5, 5],
        pointRadius: 0,
      },
    ],
  };

  // Top/Bottom ads by ROAS — latest snapshot per unique ad, aggregate spend
  const adMap = useMemo(() => {
    const map = new Map<
      string,
      { fields: Record<string, unknown>; totalSpend: number }
    >();
    for (const s of snapshots) {
      const adId = str(s.fields["Ad ID"]);
      if (!adId) continue;
      const existing = map.get(adId);
      if (!existing) {
        map.set(adId, {
          fields: { ...s.fields },
          totalSpend: num(s.fields["Spend"]),
        });
      } else {
        existing.totalSpend += num(s.fields["Spend"]);
      }
    }
    return map;
  }, [snapshots]);

  // Sort by ROAS (most meaningful for exec view), filter to ads with actual spend
  const adsSorted = useMemo(() => {
    return Array.from(adMap.values())
      .filter((a) => a.totalSpend > 0)
      .sort((a, b) => num(b.fields["ROAS"]) - num(a.fields["ROAS"]));
  }, [adMap]);

  const top3 = adsSorted.slice(0, 3);
  const bottom3 = adsSorted.slice(-3).reverse();

  return (
    <div className="space-y-6">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          title="Total Spend"
          tooltip="Total ad spend across all active campaign days"
          value={formatCurrency(totalSpend)}
          change={pctChange(curSpend, prevSpend)}
          subtitle={periodLabel}
          sourceLabel="Meta"
        />
        <KPICard
          title={showShopify && shopifyOrders > 0 ? "True ROAS" : "ROAS"}
          tooltip={
            showShopify && shopifyOrders > 0
              ? "Shopify Revenue / Meta Spend — actual return on ad spend"
              : "Return on Ad Spend — revenue generated per €1 spent. Target: 2.5x"
          }
          value={
            showShopify && shopifyOrders > 0
              ? `${trueROAS.toFixed(2)}x`
              : `${blendedROAS.toFixed(2)}x`
          }
          change={
            showShopify && shopifyOrders > 0
              ? undefined
              : pctChange(curROAS, prevROAS)
          }
          subtitle={periodLabel}
          sourceLabel={showShopify && shopifyOrders > 0 ? "Shopify" : "Meta"}
          secondaryValue={
            showShopify && shopifyOrders > 0
              ? `Meta-attributed: ${blendedROAS.toFixed(2)}x`
              : undefined
          }
        />
        <KPICard
          title={
            showShopify && shopifyOrders > 0
              ? "True Cost/Order"
              : "Cost per Order"
          }
          tooltip={
            showShopify && shopifyOrders > 0
              ? "Meta Spend / Shopify Orders — actual cost per acquisition"
              : "How much ad spend it costs to get one sale"
          }
          value={
            showShopify && shopifyOrders > 0
              ? formatCurrency(trueCPA)
              : formatCurrency(blendedCPA)
          }
          change={
            showShopify && shopifyOrders > 0
              ? undefined
              : pctChange(curCPA, prevCPA)
          }
          invertChange
          subtitle={periodLabel}
          sourceLabel={showShopify && shopifyOrders > 0 ? "Shopify" : "Meta"}
          secondaryValue={
            showShopify && shopifyOrders > 0
              ? `Meta-attributed: ${formatCurrency(blendedCPA)}`
              : undefined
          }
        />
        <KPICard
          title="Orders"
          tooltip={
            showShopify && shopifyOrders > 0
              ? "Total Shopify orders in period"
              : "Total purchases attributed to ads"
          }
          value={
            showShopify && shopifyOrders > 0
              ? formatNumber(shopifyOrders)
              : formatNumber(totalPurchases)
          }
          change={
            showShopify && shopifyOrders > 0
              ? undefined
              : pctChange(curPurchases, prevPurchases)
          }
          subtitle={periodLabel}
          sourceLabel={showShopify && shopifyOrders > 0 ? "Shopify" : "Meta"}
          secondaryValue={
            showShopify && shopifyOrders > 0
              ? `Meta-attributed: ${formatNumber(totalPurchases)}`
              : undefined
          }
        />
        <KPICard
          title="CPM"
          tooltip="Cost per 1,000 ad views"
          value={formatCurrency(avgCPM)}
          change={pctChange(curCPM, prevCPM)}
          invertChange
          sourceLabel="Meta"
        />
        <KPICard
          title="CTR"
          tooltip="Click-through rate — % of viewers who clicked"
          value={formatPercent(avgCTR)}
          change={pctChange(curCTR, prevCTR)}
          sourceLabel="Meta"
        />
        <KPICard
          title="CPC"
          tooltip="Cost per click on the ad"
          value={formatCurrency(avgCPC)}
          change={pctChange(curCPC, prevCPC)}
          invertChange
          sourceLabel="Meta"
        />
        <KPICard
          title="Revenue"
          tooltip={
            showShopify && shopifyRevenue > 0
              ? "Total Shopify revenue (mixed GBP/EUR — approximate total)"
              : "Total revenue attributed to ad campaigns"
          }
          value={
            showShopify && shopifyRevenue > 0
              ? formatCurrency(shopifyRevenue)
              : formatCurrency(totalRevenue)
          }
          change={
            showShopify && shopifyRevenue > 0
              ? undefined
              : pctChange(curRevenue, prevRevenue)
          }
          sourceLabel={showShopify && shopifyRevenue > 0 ? "Shopify" : "Meta"}
          secondaryValue={
            showShopify && shopifyRevenue > 0
              ? `Meta-attributed: ${formatCurrency(totalRevenue)}`
              : undefined
          }
        />
      </div>

      {/* Attribution Gap */}
      {showShopify && shopifyOrders > 0 && (
        <div
          className="rounded-xl px-4 py-3 text-xs flex items-center gap-3"
          style={{
            background: "rgba(168, 85, 247, 0.08)",
            border: "1px solid rgba(168, 85, 247, 0.2)",
          }}
        >
          <span
            className="font-semibold"
            style={{ color: "#a855f7" }}
            title="Percentage of actual orders not tracked by Meta pixel"
          >
            Attribution Gap: {attributionGap.toFixed(0)}%
          </span>
          <span style={{ color: "var(--text-secondary)" }}>
            {shopifyOrders} Shopify orders vs {totalPurchases} Meta-tracked
            (campaign days only)
            {shopifyOrders >= totalPurchases
              ? ` — pixel missed ${shopifyOrders - totalPurchases} orders`
              : ` — Meta over-attributed by ${totalPurchases - shopifyOrders} orders`}
          </span>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid md:grid-cols-2 gap-4">
        <ChartCard title={`Spend vs Revenue (${dateRange.label})`}>
          <Line data={spendRevenueData} options={spendRevenueOptions} />
        </ChartCard>
        <ChartCard title={`ROAS Trend (${dateRange.label})`}>
          <Line data={roasData} options={defaultOptions} />
        </ChartCard>
      </div>

      {/* Anomaly Detection */}
      <AnomalyDetection
        dailyAggregates={dailyAggregates}
        campaignsPaused={campaignsPaused}
      />

      {/* Bottom Row: Alerts + Top/Bottom + Chat */}
      <div className="grid md:grid-cols-3 gap-4">
        <AlertsFeed
          alerts={alerts}
          campaignsPaused={campaignsPaused}
          lastActiveDate={lastActiveDate}
        />

        {/* Top/Bottom Ads by ROAS */}
        <div
          className="rounded-xl p-5"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
        >
          <h3
            className="text-sm font-medium mb-3"
            style={{ color: "var(--text-secondary)" }}
          >
            Top 3 Ads by ROAS
          </h3>
          <div className="space-y-2 mb-4">
            {top3.map((ad, i) => (
              <div
                key={i}
                className="flex justify-between items-center text-xs"
              >
                <span className="truncate mr-2">
                  {str(ad.fields["Ad Name"])}
                </span>
                <span className="text-green-400 font-medium whitespace-nowrap">
                  {num(ad.fields["ROAS"]).toFixed(2)}x · €
                  {ad.totalSpend.toFixed(0)}
                </span>
              </div>
            ))}
            {top3.length === 0 && (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                No data
              </p>
            )}
          </div>

          <h3
            className="text-sm font-medium mb-3"
            style={{ color: "var(--text-secondary)" }}
          >
            Bottom 3 Ads by ROAS
          </h3>
          <div className="space-y-2">
            {bottom3.map((ad, i) => (
              <div
                key={i}
                className="flex justify-between items-center text-xs"
              >
                <span className="truncate mr-2">
                  {str(ad.fields["Ad Name"])}
                </span>
                <span className="text-red-400 font-medium whitespace-nowrap">
                  {num(ad.fields["ROAS"]).toFixed(2)}x · €
                  {ad.totalSpend.toFixed(0)}
                </span>
              </div>
            ))}
            {bottom3.length === 0 && (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                No data
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
