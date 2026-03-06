"use client";

import { Line } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import KPICard from "./KPICard";
import ChartCard from "./ChartCard";
import AlertsFeed from "./AlertsFeed";
import ChatBox from "./ChatBox";
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
}

export default function ExecutiveSummary({
  dailyAggregates,
  snapshots,
  alerts,
  dateRange,
  campaignsPaused,
  lastActiveDate,
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
  const curCPM =
    curImpressions > 0 ? (curSpend / curImpressions) * 1000 : 0;
  const curCTR = curImpressions > 0 ? (curClicks / curImpressions) * 100 : 0;
  const curCPC = curClicks > 0 ? curSpend / curClicks : 0;

  // Chart data: all active days in the filtered range
  const labels = activeDays.map((r) => {
    const d = str(r.fields.Date);
    return d ? d.split("T")[0].slice(5) : "";
  });

  const spendRevenueData = {
    labels,
    datasets: [
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
        label: "Revenue",
        data: activeDays.map((r) => num(r.fields["Revenue"])),
        borderColor: CHART_COLORS.green,
        backgroundColor: `${CHART_COLORS.green}20`,
        fill: true,
        tension: 0.3,
        yAxisID: "y1",
      },
    ],
  };

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
        />
        <KPICard
          title="ROAS"
          tooltip="Return on Ad Spend — revenue generated per €1 spent. Target: 2.5x"
          value={`${blendedROAS.toFixed(2)}x`}
          change={pctChange(curROAS, prevROAS)}
          subtitle={periodLabel}
        />
        <KPICard
          title="Cost per Order"
          tooltip="How much ad spend it costs to get one sale"
          value={formatCurrency(blendedCPA)}
          change={pctChange(curCPA, prevCPA)}
          invertChange
          subtitle={periodLabel}
        />
        <KPICard
          title="Orders"
          tooltip="Total purchases attributed to ads"
          value={formatNumber(totalPurchases)}
          change={pctChange(curPurchases, prevPurchases)}
          subtitle={periodLabel}
        />
        <KPICard
          title="CPM"
          tooltip="Cost per 1,000 ad views"
          value={formatCurrency(avgCPM)}
          change={pctChange(curCPM, prevCPM)}
          invertChange
        />
        <KPICard
          title="CTR"
          tooltip="Click-through rate — % of viewers who clicked"
          value={formatPercent(avgCTR)}
          change={pctChange(curCTR, prevCTR)}
        />
        <KPICard
          title="CPC"
          tooltip="Cost per click on the ad"
          value={formatCurrency(avgCPC)}
          change={pctChange(curCPC, prevCPC)}
          invertChange
        />
        <KPICard
          title="Revenue"
          tooltip="Total revenue attributed to ad campaigns"
          value={formatCurrency(totalRevenue)}
          change={pctChange(curRevenue, prevRevenue)}
        />
      </div>

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

        <ChatBox />
      </div>
    </div>
  );
}
