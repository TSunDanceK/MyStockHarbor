import { NextResponse } from "next/server";

export const runtime = "edge";

type Point = { date: string; close: number };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "AAPL").toUpperCase();
  const days = Math.max(30, Math.min(5000, Number(searchParams.get("days") || "365")));

  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    const lines = text.trim().split("\n");
    if (lines.length < 3) return NextResponse.json({ symbol, points: [] as Point[] });

    const points: Point[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const date = cols[0];
      const close = Number(cols[4]);
      if (date && Number.isFinite(close)) points.push({ date, close });
    }

    return NextResponse.json({ symbol, points: points.slice(-days) });
  } catch {
    return NextResponse.json({ symbol, points: [] as Point[] });
  }
}
