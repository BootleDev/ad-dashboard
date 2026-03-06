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

interface Props {
  dailyAggregates: AirtableRecord[];
  snapshots: AirtableRecord[];
  alerts: AirtableRecord[];
}

export default function ExecutiveSummary({
  dailyAggregates,
  snapshots,
  alerts,
}: Props) {
  // Sort daily by date ascending for charts
  const sorted = [...dailyAggregates].sort((a, b) =>
    String(a.fields.Date ?? "").localeCompare(String(b.fields.Date ?? "")),
  );

  // Use active days (spend > 0) for KPIs, not calendar days
  const activeDays = sorted.filter((r) => num(r.fields["Total Spend"]) > 0);
  const last30 = activeDays.slice(-30);
  const prev30 = activeDays.slice(-60, -30);

  // Date range label
  const firstDate = str(last30[0]?.fields.Date).split("T")[0].slice(5) || "—";
  const lastDate =
    str(last30[last30.length - 1]?.fields.Date)
      .split("T")[0]
      .slice(5) || "—";
  const periodLabel = `${firstDate} → ${lastDate} (${last30.length} active days)`;

  const sum = (arr: AirtableRecord[], field: string) =>
    arr.reduce((acc, r) => acc + num(r.fields[field]), 0);
  const avg = (arr: AirtableRecord[], field: string) => {
    if (arr.length === 0) return 0;
    return sum(arr, field) / arr.length;
  };

  const currentSpend = sum(last30, "Total Spend");
  const prevSpend = sum(prev30, "Total Spend");
  const currentRevenue = sum(last30, "Revenue");
  const prevRevenue = sum(prev30, "Revenue");
  const currentPurchases = sum(last30, "Total Purchases");
  const prevPurchases = sum(prev30, "Total Purchases");
  const currentROAS = currentSpend > 0 ? currentRevenue / currentSpend : 0;
  const prevROAS = prevSpend > 0 ? prevRevenue / prevSpend : 0;
  const currentCPA = currentPurchases > 0 ? currentSpend / currentPurchases : 0;
  const prevCPA = prevPurchases > 0 ? prevSpend / prevPurchases : 0;
  const currentCPM = avg(last30, "CPM");
  const prevCPM = avg(prev30, "CPM");
  const currentCTR = avg(last30, "Blended CTR");
  const prevCTR = avg(prev30, "Blended CTR");
  const currentCPC = avg(last30, "CPC");
  const prevCPC = avg(prev30, "CPC");

  // Chart data: last 30 days
  const labels = last30.map((r) => {
    const d = str(r.fields.Date);
    return d ? d.split("T")[0].slice(5) : ""; // MM-DD
  });

  const spendRevenueData = {
    labels,
    datasets: [
      {
        label: "Spend",
        data: last30.map((r) => num(r.fields["Total Spend"])),
        borderColor: CHART_COLORS.red,
        backgroundColor: `${CHART_COLORS.red}20`,
        fill: true,
        tension: 0.3,
        yAxisID: "y",
      },
      {
        label: "Revenue",
        data: last30.map((r) => num(r.fields["Revenue"])),
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
        data: last30.map((r) => num(r.fields["ROAS"])),
        borderColor: CHART_COLORS.blue,
        backgroundColor: `${CHART_COLORS.blue}20`,
        fill: true,
        tension: 0.3,
      },
      {
        label: "Target (2.5x)",
        data: last30.map(() => 2.5),
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

  const adsSorted = useMemo(() => {
    return Array.from(adMap.values())
      .filter((a) => a.totalSpend > 0)
      .sort((a, b) => num(b.fields["CTR"]) - num(a.fields["CTR"]));
  }, [adMap]);

  const top3 = adsSorted.slice(0, 3);
  const bottom3 = adsSorted.slice(-3).reverse();

  return (
    <div className="space-y-6">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          title="Total Spend"
          value={formatCurrency(currentSpend)}
          change={pctChange(currentSpend, prevSpend)}
          subtitle={periodLabel}
        />
        <KPICard
          title="ROAS"
          value={`${currentROAS.toFixed(2)}x`}
          change={pctChange(currentROAS, prevROAS)}
          subtitle={periodLabel}
        />
        <KPICard
          title="CPA"
          value={formatCurrency(currentCPA)}
          change={pctChange(currentCPA, prevCPA)}
          subtitle={periodLabel}
        />
        <KPICard
          title="Purchases"
          value={formatNumber(currentPurchases)}
          change={pctChange(currentPurchases, prevPurchases)}
          subtitle={periodLabel}
        />
        <KPICard
          title="CPM"
          value={formatCurrency(currentCPM)}
          change={pctChange(currentCPM, prevCPM)}
        />
        <KPICard
          title="CTR"
          value={formatPercent(currentCTR)}
          change={pctChange(currentCTR, prevCTR)}
        />
        <KPICard
          title="CPC"
          value={formatCurrency(currentCPC)}
          change={pctChange(currentCPC, prevCPC)}
        />
        <KPICard
          title="Revenue"
          value={formatCurrency(currentRevenue)}
          change={pctChange(currentRevenue, prevRevenue)}
        />
      </div>

      {/* Charts Row */}
      <div className="grid md:grid-cols-2 gap-4">
        <ChartCard title="Spend vs Revenue (30d)">
          <Line data={spendRevenueData} options={spendRevenueOptions} />
        </ChartCard>
        <ChartCard title="ROAS Trend (30d)">
          <Line data={roasData} options={defaultOptions} />
        </ChartCard>
      </div>

      {/* Anomaly Detection */}
      <AnomalyDetection dailyAggregates={dailyAggregates} />

      {/* Bottom Row: Alerts + Top/Bottom + Chat */}
      <div className="grid md:grid-cols-3 gap-4">
        <AlertsFeed alerts={alerts} />

        {/* Top/Bottom Ads */}
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
            Top 3 Ads by CTR
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
                  {(num(ad.fields["CTR"]) * 100).toFixed(2)}% · €
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
            Bottom 3 Ads by CTR
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
                  {(num(ad.fields["CTR"]) * 100).toFixed(2)}% · €
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
