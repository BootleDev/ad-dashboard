"use client";

import { useMemo } from "react";
import { num, str } from "@/lib/utils";
import type { Fields } from "@/lib/utils";

interface Props {
  mergedAds: Fields[];
}

interface ABResult {
  adA: string;
  adB: string;
  metric: string;
  valueA: number;
  valueB: number;
  winner: "A" | "B" | "tie";
  confidence: number;
  significant: boolean;
}

// Two-proportion z-test
function zTestProportions(
  successA: number,
  nA: number,
  successB: number,
  nB: number,
): { zScore: number; pValue: number; confidence: number } {
  if (nA === 0 || nB === 0) return { zScore: 0, pValue: 1, confidence: 0 };

  const pA = successA / nA;
  const pB = successB / nB;
  const pPooled = (successA + successB) / (nA + nB);

  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / nA + 1 / nB));
  if (se === 0) return { zScore: 0, pValue: 1, confidence: 0 };

  const z = (pA - pB) / se;

  // Approximate p-value from z-score (two-tailed)
  const absZ = Math.abs(z);
  // Using normal CDF approximation
  const t = 1 / (1 + 0.2316419 * absZ);
  const d = 0.3989422802 * Math.exp((-absZ * absZ) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const pValue = 2 * p; // two-tailed

  return { zScore: z, pValue, confidence: (1 - pValue) * 100 };
}

export default function ABSignificance({ mergedAds }: Props) {
  const results = useMemo(() => {
    // Group ads by base name (e.g., "Warmth You Can Carry" variants A, B, C)
    const groups: Record<string, Fields[]> = {};

    for (const ad of mergedAds) {
      const name = str(ad["Ad Name"]);
      // Extract base name by removing common variant suffixes
      const baseName = name
        .replace(/\s*-\s*[A-Z]$/i, "")
        .replace(/\s*\([^)]+\)$/, "")
        .replace(/\s*(variant|version|v)\s*\d+$/i, "")
        .trim();

      if (!groups[baseName]) groups[baseName] = [];
      groups[baseName].push(ad);
    }

    const tests: ABResult[] = [];

    // Only test groups with 2+ variants
    for (const [, ads] of Object.entries(groups)) {
      if (ads.length < 2) continue;

      // Sort by impressions desc — compare top 2
      const sorted = [...ads].sort(
        (a, b) => num(b["Impressions"]) - num(a["Impressions"]),
      );
      const a = sorted[0];
      const b = sorted[1];

      const impA = num(a["Impressions"]);
      const impB = num(b["Impressions"]);
      const clicksA = num(a["Clicks"]);
      const clicksB = num(b["Clicks"]);

      if (impA < 1000 || impB < 1000) continue; // Need minimum sample for meaningful results

      // CTR test
      const ctrTest = zTestProportions(clicksA, impA, clicksB, impB);
      const ctrA = impA > 0 ? (clicksA / impA) * 100 : 0;
      const ctrB = impB > 0 ? (clicksB / impB) * 100 : 0;

      tests.push({
        adA: str(a["Ad Name"]),
        adB: str(b["Ad Name"]),
        metric: "CTR",
        valueA: ctrA,
        valueB: ctrB,
        winner: ctrTest.confidence >= 90 ? (ctrA > ctrB ? "A" : "B") : "tie",
        confidence: ctrTest.confidence,
        significant: ctrTest.confidence >= 90,
      });
    }

    return tests.sort((a, b) => b.confidence - a.confidence);
  }, [mergedAds]);

  return (
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
        A/B Test Significance
      </h3>

      {results.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          No A/B variant pairs detected with enough data (need 1,000+
          impressions each). Name variants with suffixes like &quot;- A&quot;,
          &quot;- B&quot; for auto-detection.
        </p>
      ) : (
        <div className="space-y-3">
          {results.map((test, i) => (
            <div
              key={i}
              className="rounded-lg px-3 py-2"
              style={{ background: "var(--bg-secondary)" }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">{test.metric} test</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    test.significant
                      ? "bg-green-500/20 text-green-400"
                      : "bg-gray-500/20 text-gray-400"
                  }`}
                >
                  {test.significant
                    ? `${test.confidence.toFixed(0)}% confident`
                    : `${test.confidence.toFixed(0)}% — not significant`}
                </span>
              </div>
              <div className="flex gap-4 text-xs">
                <div className={test.winner === "A" ? "text-green-400" : ""}>
                  <span className="font-medium">A:</span> {test.adA} (
                  {test.valueA.toFixed(2)}%)
                </div>
                <div className={test.winner === "B" ? "text-green-400" : ""}>
                  <span className="font-medium">B:</span> {test.adB} (
                  {test.valueB.toFixed(2)}%)
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
