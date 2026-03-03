import { NextResponse } from "next/server";

export const runtime = "edge";

type Quote = {
  symbol: string;
  price: number | null;
  date: string | null;
  time: string | null;
  source: string;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "AAPL").toUpperCase();

  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/l/?s=${stooqSymbol}&f=sd2t2l&h&e=csv`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    const lines = text.trim().split("\n");
    if (lines.length < 2) throw new Error("No data");
    const row = lines[1].split(",");

    const sym = row[0] ?? symbol;
    const date = row[1] ?? null;
    const time = row[2] ?? null;
    const lastStr = row[3] ?? "";
    const price = lastStr && lastStr !== "N/D" ? Number(lastStr) : null;

    const payload: Quote = {
      symbol: sym,
      price: Number.isFinite(price) ? price : null,
      date,
      time,
      source: "stooq.com",
    };

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { symbol, price: null, date: null, time: null, source: "stooq.com" } satisfies Quote,
      { status: 200 }
    );
  }
}
