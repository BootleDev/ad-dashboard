import { NextResponse } from "next/server";
import { getAllDashboardData } from "@/lib/airtable";

export async function POST(request: Request) {
  const { message } = await request.json();

  if (!message) {
    return NextResponse.json({ error: "No message" }, { status: 400 });
  }

  try {
    const data = await getAllDashboardData();

    // Build context summary
    const dailySorted = data.dailyAggregates
      .map((r) => r.fields)
      .sort((a, b) => String(b.Date ?? "").localeCompare(String(a.Date ?? "")));

    const recentDaily = dailySorted.slice(0, 14);
    const recentAlerts = data.alerts.slice(0, 20).map((r) => r.fields);

    // Merge snapshots with tags — latest snapshot per unique ad
    const tagMap = new Map(data.tags.map((t) => [t.fields["Ad ID"], t.fields]));
    const seenAds = new Map<string, Record<string, unknown>>();
    for (const s of data.snapshots) {
      const adId = String(s.fields["Ad ID"] ?? "");
      if (!adId || seenAds.has(adId)) continue;
      const tag = tagMap.get(s.fields["Ad ID"]) || {};
      seenAds.set(adId, { ...s.fields, ...tag });
    }
    const latestAds = Array.from(seenAds.values());

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

    const context = `You are an expert paid media analyst for Bootle, a Swedish modular drinkware brand.
You have access to the latest ad performance data.
${pauseNote}
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
        model: "claude-sonnet-4-20250514",
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
