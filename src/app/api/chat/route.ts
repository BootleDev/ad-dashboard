import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAllDashboardData } from "@/lib/airtable";
import { aggregateSnapshots, deduplicateByDate } from "@/lib/utils";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (cookieStore.get("bootle_dash_auth")?.value !== "authenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { message } = await request.json();

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "No message" }, { status: 400 });
  }

  if (message.length > 4000) {
    return NextResponse.json(
      { error: "Message too long (max 4000 characters)" },
      { status: 400 },
    );
  }

  try {
    const data = await getAllDashboardData();

    // Deduplicate daily aggregates before use
    const dedupedDaily = deduplicateByDate(data.dailyAggregates);

    // Build context summary
    const dailySorted = dedupedDaily
      .map((r) => r.fields)
      .sort((a, b) => String(b.Date ?? "").localeCompare(String(a.Date ?? "")));

    const recentDaily = dailySorted.slice(0, 14);
    const recentAlerts = data.alerts.slice(0, 20).map((r) => r.fields);

    // Aggregate snapshots per ad (sum metrics across all days)
    const tagMap = new Map(
      data.tags.map((t) => [String(t.fields["Ad ID"] ?? ""), t.fields]),
    );
    const latestAds = aggregateSnapshots(data.snapshots, tagMap);

    // Detect if campaigns are paused (last active spend date > 7 days ago)
    const lastSpendDate = dailySorted
      .filter((d) => Number(d["Total Spend"] ?? 0) > 0)
      .map((d) => String(d.Date ?? "").split("T")[0])
      .filter(Boolean)[0];
    const pausedSince = lastSpendDate || "unknown";
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const isPaused = lastSpendDate
      ? new Date(lastSpendDate) < sevenDaysAgo
      : true;

    const pauseNote = isPaused
      ? `\nNOTE: All campaigns have been paused since ${pausedSince}. Data shown is historical. Factor this into your analysis.\n`
      : "";

    // Shopify daily sales — scoped to campaign-active dates only
    const activeDates = new Set(
      dailySorted
        .filter((d) => Number(d["Total Spend"] ?? 0) > 0)
        .map((d) => String(d.Date ?? "").split("T")[0])
        .filter(Boolean),
    );
    const campaignShopify = data.shopifySales
      .map((r) => r.fields)
      .filter((r) => {
        const d = String(r.Date ?? "").split("T")[0];
        return d && activeDates.has(d);
      })
      .sort((a, b) => String(b.Date ?? "").localeCompare(String(a.Date ?? "")));

    const shopifyNote =
      campaignShopify.length > 0
        ? `\nIMPORTANT: Meta pixel was broken during the campaign period. Shopify data shows TRUE sales. Always prefer Shopify data for revenue/orders/ROAS/CPA questions.\nShopify data is filtered to campaign-active dates only (${activeDates.size} days with ad spend).\n\nSHOPIFY DAILY SALES (campaign days):\n${JSON.stringify(campaignShopify, null, 2)}\n`
        : "\nNOTE: No Shopify sales data available yet.\n";

    const context = `You are an expert paid media analyst for Bootle, a Swedish modular drinkware brand.
You have access to the latest ad performance data.
${pauseNote}${shopifyNote}
DAILY AGGREGATES (last 14 days):
${JSON.stringify(recentDaily, null, 2)}

LATEST AD SNAPSHOTS (${latestAds.length} unique ads):
${JSON.stringify(latestAds, null, 2)}

RECENT ALERTS:
${JSON.stringify(recentAlerts, null, 2)}

Answer the user's question concisely. Use specific numbers. If recommending actions, be specific and actionable.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: context,
        messages: [{ role: "user", content: message }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errText}`);
    }

    const result = await res.json();
    const reply = result.content[0]?.text || "No response";

    return NextResponse.json({ reply });
  } catch (err) {
    const message_ = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message_ }, { status: 500 });
  }
}
