"use client";

interface ChartCardProps {
  title: string;
  children: React.ReactNode;
  height?: string;
}

export default function ChartCard({ title, children, height = "300px" }: ChartCardProps) {
  return (
    <div
      className="rounded-xl p-5"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-sm font-medium mb-4" style={{ color: "var(--text-secondary)" }}>
        {title}
      </h3>
      <div style={{ height }}>{children}</div>
    </div>
  );
}
