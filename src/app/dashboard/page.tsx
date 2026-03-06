"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import ExecutiveSummary from "@/components/ExecutiveSummary";
import CreativePerformance from "@/components/CreativePerformance";
import Diagnostics from "@/components/Diagnostics";
import DateRangeFilter from "@/components/DateRangeFilter";
import type { DateRange } from "@/components/DateRangeFilter";
import { deduplicateByDate, str, num } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

type Tab = "executive" | "creative" | "diagnostics";

interface DashboardData {
  snapshots: AirtableRecord[];
  tags: AirtableRecord[];
  dailyAggregates: AirtableRecord[];
  alerts: AirtableRecord[];
  shopifySales: AirtableRecord[];
}

function filterByDateRange(
  records: AirtableRecord[],
  dateField: string,
  range: DateRange,
): AirtableRecord[] {
  if (!range.start && !range.end) return records;
  return records.filter((r) => {
    const d = str(r.fields[dateField]).split("T")[0];
    if (!d) return false;
    if (range.start && d < range.start) return false;
    if (range.end && d > range.end) return false;
    return true;
  });
}

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("executive");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>({
    start: null,
    end: null,
    label: "All Time",
  });
  const [showShopify, setShowShopify] = useState(true);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/airtable")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d) => setData(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Deduplicate daily aggregates globally
  const dedupedDaily = useMemo(
    () => (data ? deduplicateByDate(data.dailyAggregates) : []),
    [data],
  );

  // Filter data by selected date range
  const filteredDaily = useMemo(
    () => filterByDateRange(dedupedDaily, "Date", dateRange),
    [dedupedDaily, dateRange],
  );
  const filteredSnapshots = useMemo(
    () =>
      data ? filterByDateRange(data.snapshots, "Snapshot Date", dateRange) : [],
    [data, dateRange],
  );
  const filteredAlerts = useMemo(
    () => (data ? filterByDateRange(data.alerts, "Alert Date", dateRange) : []),
    [data, dateRange],
  );
  const filteredShopify = useMemo(
    () => (data ? filterByDateRange(data.shopifySales, "Date", dateRange) : []),
    [data, dateRange],
  );

  // Campaign paused detection: find last date with spend > 0
  const lastActiveDate = useMemo(() => {
    const withSpend = dedupedDaily
      .filter((r) => num(r.fields["Total Spend"]) > 0)
      .map((r) => str(r.fields.Date).split("T")[0])
      .filter(Boolean)
      .sort()
      .reverse();
    return withSpend[0] || null;
  }, [dedupedDaily]);

  const campaignsPaused = useMemo(() => {
    if (!lastActiveDate) return false;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return new Date(lastActiveDate) < sevenDaysAgo;
  }, [lastActiveDate]);

  // Latest data date for freshness
  const latestDataDate = useMemo(() => {
    if (!data) return null;
    const dates = dedupedDaily
      .map((r) => str(r.fields.Date).split("T")[0])
      .filter(Boolean)
      .sort()
      .reverse();
    return dates[0] || null;
  }, [data, dedupedDaily]);

  const latestShopifyDate = useMemo(() => {
    if (!data || !data.shopifySales.length) return null;
    const dates = data.shopifySales
      .map((r) => str(r.fields.Date).split("T")[0])
      .filter(Boolean)
      .sort()
      .reverse();
    return dates[0] || null;
  }, [data]);

  const hasShopifyData = (data?.shopifySales?.length ?? 0) > 0;

  const tabs: { key: Tab; label: string }[] = [
    { key: "executive", label: "Executive Summary" },
    { key: "creative", label: "Creative Performance" },
    { key: "diagnostics", label: "Diagnostics" },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header
        className="sticky top-0 z-10 px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        style={{
          background: "var(--bg-primary)",
          borderBottom: "1px solid var(--border)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="shrink-0">
          <h1 className="text-lg font-bold">Bootle Ad Intelligence</h1>
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              {latestDataDate ? (
                <>
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{
                      background: latestDataDate ? "#3b82f6" : "#6b7280",
                    }}
                    title={`Meta: ${latestDataDate}`}
                  />
                  {latestShopifyDate && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full"
                      style={{ background: "#a855f7" }}
                      title={`Shopify: ${latestShopifyDate}`}
                    />
                  )}
                  Last data: {latestDataDate}
                </>
              ) : loading ? (
                "Loading..."
              ) : (
                "No data"
              )}
            </div>
            {!loading && data && (
              <button
                onClick={fetchData}
                className="text-[10px] px-1.5 py-0.5 rounded transition-colors hover:bg-white/10"
                style={{ color: "var(--text-secondary)" }}
                title="Refresh data"
              >
                Refresh
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
          {data && (
            <DateRangeFilter value={dateRange} onChange={setDateRange} />
          )}

          {/* Shopify Data Toggle */}
          {hasShopifyData && (
            <button
              onClick={() => setShowShopify((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all"
              style={{
                background: showShopify
                  ? "rgba(168, 85, 247, 0.15)"
                  : "var(--bg-secondary)",
                color: showShopify ? "#a855f7" : "var(--text-secondary)",
                border: showShopify
                  ? "1px solid rgba(168, 85, 247, 0.3)"
                  : "1px solid var(--border)",
              }}
              title="Toggle Shopify sales data overlay"
            >
              <span
                className="inline-block w-2 h-2 rounded-full transition-colors"
                style={{
                  background: showShopify ? "#a855f7" : "#6b7280",
                }}
              />
              Shopify Data
            </button>
          )}

          {/* Tab Nav */}
          <nav
            className="flex gap-1 rounded-lg p-1"
            style={{ background: "var(--bg-secondary)" }}
          >
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 rounded-md text-xs font-medium transition-all ${
                  tab === t.key ? "text-white" : ""
                }`}
                style={{
                  background:
                    tab === t.key ? "var(--accent-blue)" : "transparent",
                  color: tab === t.key ? "#fff" : "var(--text-secondary)",
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Campaign Paused Banner */}
      {campaignsPaused && !loading && (
        <div
          className="mx-6 mt-4 rounded-xl px-4 py-3 text-sm flex items-center gap-2"
          style={{
            background: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            color: "rgb(245, 158, 11)",
          }}
        >
          <span className="text-base">&#9888;</span>
          All campaigns paused since {lastActiveDate}. Showing historical data.
        </div>
      )}

      {/* Content */}
      <main className="p-6 max-w-[1400px] mx-auto">
        {loading && (
          <div className="flex items-center justify-center h-64">
            <div
              className="text-sm animate-pulse"
              style={{ color: "var(--text-secondary)" }}
            >
              Loading dashboard data...
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl p-6 border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
            Error loading data: {error}
          </div>
        )}

        {data && !loading && (
          <>
            {tab === "executive" && (
              <ExecutiveSummary
                dailyAggregates={filteredDaily}
                snapshots={filteredSnapshots}
                alerts={filteredAlerts}
                dateRange={dateRange}
                campaignsPaused={campaignsPaused}
                lastActiveDate={lastActiveDate}
                shopifySales={filteredShopify}
                showShopify={showShopify}
              />
            )}
            {tab === "creative" && (
              <CreativePerformance
                snapshots={filteredSnapshots}
                tags={data.tags}
                campaignsPaused={campaignsPaused}
                showShopify={showShopify}
              />
            )}
            {tab === "diagnostics" && (
              <Diagnostics
                dailyAggregates={filteredDaily}
                alerts={filteredAlerts}
                snapshots={filteredSnapshots}
                tags={data.tags}
                campaignsPaused={campaignsPaused}
                lastActiveDate={lastActiveDate}
                shopifySales={filteredShopify}
                showShopify={showShopify}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
