import { NextResponse } from "next/server";
import {
  getAllDashboardData,
  getAdSnapshots,
  getCreativeTags,
  getDailyAggregates,
  getAlerts,
  getShopifySales,
} from "@/lib/airtable";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table");

  try {
    if (table === "snapshots") {
      const data = await getAdSnapshots();
      return NextResponse.json({ records: data });
    }
    if (table === "tags") {
      const data = await getCreativeTags();
      return NextResponse.json({ records: data });
    }
    if (table === "daily") {
      const data = await getDailyAggregates();
      return NextResponse.json({ records: data });
    }
    if (table === "alerts") {
      const data = await getAlerts();
      return NextResponse.json({ records: data });
    }
    if (table === "shopify") {
      const data = await getShopifySales();
      return NextResponse.json({ records: data });
    }

    // Default: return all data
    const data = await getAllDashboardData();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
