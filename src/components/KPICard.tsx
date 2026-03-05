"use client";

interface KPICardProps {
  title: string;
  value: string;
  change?: number;
  subtitle?: string;
}

export default function KPICard({ title, value, change, subtitle }: KPICardProps) {
  const isPositive = change !== undefined && change >= 0;
  const changeColor = change === undefined ? "" : isPositive ? "text-green-400" : "text-red-400";
  const arrow = change === undefined ? "" : isPositive ? "↑" : "↓";

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
    >
      <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {title}
      </span>
      <span className="text-2xl font-bold">{value}</span>
      <div className="flex items-center gap-2">
        {change !== undefined && (
          <span className={`text-xs font-medium ${changeColor}`}>
            {arrow} {Math.abs(change).toFixed(1)}%
          </span>
        )}
        {subtitle && (
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
