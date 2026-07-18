import { NextResponse } from "next/server";
import { getLatestEarningsData } from "@/lib/latest-earnings-data";
import { isUnwantedBot } from "@/lib/botid-guard";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ symbol: string }>;
};

function cleanSymbol(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

// Thin HTTP wrapper around the shared lib/latest-earnings-data.ts logic
// (the same computation the News page uses directly, server-side). This
// used to have its own separate FMP-endpoint-based implementation that
// diverged from the News page's numbers; see lib/latest-earnings-data.ts
// for why that was consolidated.
export async function GET(_request: Request, { params }: Props) {
  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { symbol } = await params;
  const clean = cleanSymbol(symbol);
  const data = await getLatestEarningsData(clean, "yellow");
  return NextResponse.json(data);
}
