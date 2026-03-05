export function formatCurrency(value: number, decimals = 2): string {
  return `€${value.toFixed(decimals)}`;
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

export function pctChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

export type Fields = Record<string, unknown>;
export type AirtableRecord = { id: string; fields: Fields; createdTime: string };

export function num(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  return 0;
}

export function str(val: unknown): string {
  if (typeof val === "string") return val;
  return String(val ?? "");
}
