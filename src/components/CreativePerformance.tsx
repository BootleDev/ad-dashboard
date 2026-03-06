"use client";

import { Bar, Scatter } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import ChartCard from "./ChartCard";
import CreativeDNA from "./CreativeDNA";
import ABSignificance from "./ABSignificance";
import { num, str } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";
import { useState, useMemo } from "react";

interface Props {
  snapshots: AirtableRecord[];
  tags: AirtableRecord[];
  campaignsPaused?: boolean;
  showShopify?: boolean;
}

type SortKey = "name" | "roas" | "spend" | "cpa" | "hookRate" | "score";
type SortDir = "asc" | "desc";

export default function CreativePerformance({
  snapshots,
  tags,
  campaignsPaused,
  showShopify = false,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Merge snapshots with tags — latest snapshot per unique ad (not just latest date)
  const tagMap = useMemo(
    () => new Map(tags.map((t) => [str(t.fields["Ad ID"]), t.fields])),
    [tags],
  );

  const mergedAds = useMemo(() => {
    // Sort snapshots by date desc to ensure first occurrence is the latest
    const sortedSnaps = [...snapshots].sort((a, b) =>
      String(b.fields["Snapshot Date"] ?? "").localeCompare(
        String(a.fields["Snapshot Date"] ?? ""),
      ),
    );
    const seen = new Map<string, Record<string, unknown>>();
    for (const s of sortedSnaps) {
      const adId = str(s.fields["Ad ID"]);
      if (!adId || seen.has(adId)) continue;
      const tag = tagMap.get(adId) || {};
      seen.set(adId, { ...s.fields, ...tag });
    }
    return Array.from(seen.values());
  }, [snapshots, tagMap]);

  // Sort
  const sorted = useMemo(() => {
    const keyMap: Record<SortKey, string> = {
      name: "Ad Name",
      roas: "ROAS",
      spend: "Spend",
      cpa: "CPA",
      hookRate: "Hook Rate",
      score: "Composite Score",
    };
    const field = keyMap[sortKey];
    return [...mergedAds].sort((a, b) => {
      const av = sortKey === "name" ? str(a[field]) : num(a[field]);
      const bv = sortKey === "name" ? str(b[field]) : num(b[field]);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [mergedAds, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  // Format breakdown: avg ROAS per format
  const formatGroups = useMemo(() => {
    const groups: Record<string, number[]> = {};
    for (const ad of mergedAds) {
      const fmt = str(ad["Format"]) || "Unknown";
      if (!groups[fmt]) groups[fmt] = [];
      groups[fmt].push(num(ad["ROAS"]));
    }
    return Object.entries(groups).map(([format, values]) => ({
      format,
      avgRoas: values.reduce((a, b) => a + b, 0) / values.length,
    }));
  }, [mergedAds]);

  const formatChartData = {
    labels: formatGroups.map((g) => g.format),
    datasets: [
      {
        label: "Avg ROAS",
        data: formatGroups.map((g) => g.avgRoas),
        backgroundColor: [
          CHART_COLORS.blue,
          CHART_COLORS.green,
          CHART_COLORS.purple,
          CHART_COLORS.amber,
          CHART_COLORS.cyan,
          CHART_COLORS.pink,
          CHART_COLORS.red,
        ],
        borderRadius: 6,
      },
    ],
  };

  // Hook type breakdown: avg Hook Rate per hook type
  const hookGroups = useMemo(() => {
    const groups: Record<string, number[]> = {};
    for (const ad of mergedAds) {
      const hook = str(ad["Hook Type"]) || "Unknown";
      if (!groups[hook]) groups[hook] = [];
      groups[hook].push(num(ad["Hook Rate"]));
    }
    return Object.entries(groups).map(([hookType, values]) => ({
      hookType,
      avgHookRate: values.reduce((a, b) => a + b, 0) / values.length,
    }));
  }, [mergedAds]);

  const hookChartData = {
    labels: hookGroups.map((g) => g.hookType),
    datasets: [
      {
        label: "Avg Hook Rate (%)",
        data: hookGroups.map((g) => g.avgHookRate),
        backgroundColor: [
          CHART_COLORS.green,
          CHART_COLORS.blue,
          CHART_COLORS.amber,
          CHART_COLORS.purple,
          CHART_COLORS.cyan,
          CHART_COLORS.pink,
        ],
        borderRadius: 6,
      },
    ],
  };

  // Hook Rate vs CPA scatter
  const scatterData = {
    datasets: [
      {
        label: "Ads",
        data: mergedAds.map((ad) => ({
          x: num(ad["Hook Rate"]),
          y: num(ad["CPA"]),
        })),
        backgroundColor: CHART_COLORS.blue,
        pointRadius: 6,
        pointHoverRadius: 8,
      },
    ],
  };

  const scatterOptions = {
    ...defaultOptions,
    scales: {
      x: {
        ...defaultOptions.scales.x,
        title: {
          display: true,
          text: "Hook Rate (%)",
          color: CHART_COLORS.muted,
        },
      },
      y: {
        ...defaultOptions.scales.y,
        title: { display: true, text: "CPA (€)", color: CHART_COLORS.muted },
      },
    },
  };

  // Fatigue watchlist — frequency-based (replaced AI Fatigue Flag)
  const fatigued = mergedAds.filter(
    (ad) => num(ad["Frequency"]) > 2.0 && num(ad["Spend"]) > 10,
  );

  // Hook Rate vs CPA scatter: hide when >80% of ads have CPA === 0
  const zeroCpaRatio = useMemo(() => {
    if (mergedAds.length === 0) return 0;
    const zeroCpaCount = mergedAds.filter((ad) => num(ad["CPA"]) === 0).length;
    return zeroCpaCount / mergedAds.length;
  }, [mergedAds]);
  const hideScatter = zeroCpaRatio > 0.8 || showShopify;

  return (
    <div className="space-y-6">
      {/* Shopify context banner */}
      {showShopify && (
        <div
          className="rounded-xl px-4 py-3 text-xs"
          style={{
            background: "rgba(168, 85, 247, 0.08)",
            border: "1px solid rgba(168, 85, 247, 0.2)",
            color: "#a855f7",
          }}
        >
          Ad-level ROAS uses Meta attribution only. Shopify data provides
          accurate totals (see Executive Summary) but cannot be attributed to
          individual ads.
        </div>
      )}

      {/* Ad Table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          className="px-5 py-3 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <h3
            className="text-sm font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            Ad Scorecard ({sorted.length} ads)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {(
                  [
                    ["name", "Ad Name"],
                    ["score", "Score"],
                    ["roas", "ROAS"],
                    ["spend", "Spend"],
                    ["cpa", "CPA"],
                    ["hookRate", "Hook Rate"],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <th
                    key={key}
                    className="px-4 py-3 text-left cursor-pointer hover:text-white transition-colors"
                    style={{ color: "var(--text-secondary)" }}
                    onClick={() => toggleSort(key)}
                  >
                    {label}
                    {sortArrow(key)}
                  </th>
                ))}
                <th
                  className="px-4 py-3 text-left"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Format
                </th>
                <th
                  className="px-4 py-3 text-left"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((ad, i) => {
                const roas = num(ad["ROAS"]);
                const roasColor =
                  roas >= 2.5
                    ? "text-green-400"
                    : roas >= 1
                      ? "text-amber-400"
                      : "text-red-400";

                return (
                  <tr
                    key={i}
                    className="hover:bg-white/5 transition-colors"
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <td className="px-4 py-3 max-w-[200px] truncate">
                      {str(ad["Ad Name"])}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {num(ad["Composite Score"]).toFixed(1)}
                    </td>
                    <td className={`px-4 py-3 font-medium ${roasColor}`}>
                      {roas.toFixed(2)}x
                    </td>
                    <td className="px-4 py-3">
                      €{num(ad["Spend"]).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">€{num(ad["CPA"]).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      {num(ad["Hook Rate"]).toFixed(1)}%
                    </td>
                    <td className="px-4 py-3">{str(ad["Format"]) || "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] ${
                          campaignsPaused
                            ? "bg-gray-500/20 text-gray-400"
                            : str(ad["Ad Status"]) === "ACTIVE"
                              ? "bg-green-500/20 text-green-400"
                              : "bg-gray-500/20 text-gray-400"
                        }`}
                        title={
                          campaignsPaused
                            ? "Campaign paused — ad was active within paused campaign"
                            : undefined
                        }
                      >
                        {campaignsPaused
                          ? `PAUSED / ${str(ad["Ad Status"]) || "—"}`
                          : str(ad["Ad Status"]) || "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid md:grid-cols-2 gap-4">
        <ChartCard title="Avg ROAS by Format">
          <Bar data={formatChartData} options={defaultOptions} />
        </ChartCard>
        <ChartCard title="Avg Hook Rate by Hook Type">
          <Bar data={hookChartData} options={defaultOptions} />
        </ChartCard>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {hideScatter ? (
          <div
            className="rounded-xl p-5 flex items-center justify-center"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
            }}
          >
            <p
              className="text-xs text-center"
              style={{ color: "var(--text-secondary)" }}
            >
              CPA data unavailable for {Math.round(zeroCpaRatio * 100)}% of ads
              (pixel tracking issue). Chart hidden to avoid misleading display.
            </p>
          </div>
        ) : (
          <ChartCard title="Hook Rate vs CPA">
            <Scatter data={scatterData} options={scatterOptions} />
          </ChartCard>
        )}

        {/* Fatigue Watchlist */}
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
            Fatigue Watchlist
          </h3>
          {fatigued.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              No ads currently flagged for fatigue
            </p>
          ) : (
            <div className="space-y-2">
              {fatigued.map((ad, i) => (
                <div
                  key={i}
                  className="flex justify-between items-center text-xs rounded-lg px-3 py-2 bg-amber-500/10 border border-amber-500/20"
                >
                  <span className="truncate mr-2 text-amber-400">
                    {str(ad["Ad Name"])}
                  </span>
                  <span className="text-amber-300">
                    Freq: {num(ad["Frequency"]).toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Creative DNA + A/B Tests */}
      <div className="grid md:grid-cols-2 gap-4">
        <CreativeDNA mergedAds={mergedAds} />
        <ABSignificance mergedAds={mergedAds} />
      </div>
    </div>
  );
}
