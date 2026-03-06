"use client";

import { useMemo } from "react";
import { num, str } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface Props {
  dailyAggregates: AirtableRecord[];
  campaignsPaused?: boolean;
}

interface Anomaly {
  date: string;
  metric: string;
  value: number;
  average: number;
  deviation: number;
  direction: "spike" | "drop";
}

export default function AnomalyDetection({
  dailyAggregates,
  campaignsPaused,
}: Props) {
  const anomalies = useMemo(() => {
    const sorted = [...dailyAggregates].sort((a, b) =>
      String(a.fields.Date ?? "").localeCompare(String(b.fields.Date ?? "")),
    );

    // Only look at days with activity
    const active = sorted.filter((r) => num(r.fields["Total Spend"]) > 0);
    if (active.length < 10) return [];

    const metrics = [
      { key: "CPM", label: "CPM", threshold: 2.0 },
      { key: "Blended CTR", label: "CTR", threshold: 2.5 },
      { key: "CPC", label: "CPC", threshold: 2.0 },
      { key: "CPA", label: "CPA", threshold: 2.5, minDataPoints: 10 },
      { key: "Total Spend", label: "Spend", threshold: 2.5 },
    ];

    const found: Anomaly[] = [];

    for (const { key, label, threshold, minDataPoints } of metrics) {
      const values = active.map((r) => num(r.fields[key]));

      // Skip metrics with too few non-zero data points
      const nonZero = values.filter((v) => v > 0);
      if (minDataPoints && nonZero.length < minDataPoints) continue;

      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const stdDev = Math.sqrt(
        values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length,
      );

      if (stdDev === 0 || mean === 0) continue;

      // Check last 7 active days for anomalies
      const recentDays = active.slice(-7);
      for (const day of recentDays) {
        const val = num(day.fields[key]);
        const zScore = Math.abs((val - mean) / stdDev);
        if (zScore >= threshold && val > 0) {
          found.push({
            date: str(day.fields.Date).split("T")[0],
            metric: label,
            value: val,
            average: mean,
            deviation: zScore,
            direction: val > mean ? "spike" : "drop",
          });
        }
      }
    }

    // Sort by deviation (most anomalous first)
    return found.sort((a, b) => b.deviation - a.deviation).slice(0, 8);
  }, [dailyAggregates]);

  if (anomalies.length === 0) {
    return (
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
          Anomaly Detection
        </h3>
        <p
          className="text-xs"
          style={{ color: campaignsPaused ? "var(--text-secondary)" : undefined }}
        >
          {campaignsPaused
            ? "Anomaly detection inactive — campaigns paused. No recent data to analyse."
            : "No anomalies detected in recent performance."}
        </p>
      </div>
    );
  }

  return (
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
        Anomaly Detection
      </h3>
      <div className="space-y-2">
        {anomalies.map((a, i) => (
          <div
            key={i}
            className={`text-xs rounded-lg px-3 py-2 flex items-center justify-between ${
              a.direction === "spike"
                ? "bg-amber-500/10 border border-amber-500/20"
                : "bg-red-500/10 border border-red-500/20"
            }`}
          >
            <div>
              <span className="font-medium">
                {a.metric} {a.direction === "spike" ? "spike" : "drop"}
              </span>
              <span style={{ color: "var(--text-secondary)" }}>
                {" "}
                on {a.date}
              </span>
            </div>
            <div className="text-right">
              <span
                className={
                  a.direction === "spike" ? "text-amber-400" : "text-red-400"
                }
              >
                {a.value.toFixed(2)}
              </span>
              <span style={{ color: "var(--text-secondary)" }}>
                {" "}
                vs avg {a.average.toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
