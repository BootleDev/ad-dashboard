"use client";

import { useState, useEffect } from "react";
import ExecutiveSummary from "@/components/ExecutiveSummary";
import CreativePerformance from "@/components/CreativePerformance";
import Diagnostics from "@/components/Diagnostics";
import type { AirtableRecord } from "@/lib/utils";

type Tab = "executive" | "creative" | "diagnostics";

interface DashboardData {
  snapshots: AirtableRecord[];
  tags: AirtableRecord[];
  dailyAggregates: AirtableRecord[];
  alerts: AirtableRecord[];
}

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("executive");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/airtable")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d) => setData(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: "executive", label: "Executive Summary" },
    { key: "creative", label: "Creative Performance" },
    { key: "diagnostics", label: "Diagnostics" },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header
        className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between"
        style={{
          background: "var(--bg-primary)",
          borderBottom: "1px solid var(--border)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div>
          <h1 className="text-lg font-bold">Bootle Ad Intelligence</h1>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {data
              ? `${data.snapshots.length} snapshots · ${data.alerts.length} alerts`
              : "Loading..."}
          </p>
        </div>

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
      </header>

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
                dailyAggregates={data.dailyAggregates}
                snapshots={data.snapshots}
                alerts={data.alerts}
              />
            )}
            {tab === "creative" && (
              <CreativePerformance
                snapshots={data.snapshots}
                tags={data.tags}
              />
            )}
            {tab === "diagnostics" && (
              <Diagnostics
                dailyAggregates={data.dailyAggregates}
                alerts={data.alerts}
                snapshots={data.snapshots}
                tags={data.tags}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
