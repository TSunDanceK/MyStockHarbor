import { NextResponse } from "next/server";

export const runtime = "edge";

// Very small parser for the Nasdaq Trader symbol directory format (pipe-delimited)
function parseNasdaqSymbolFile(text: string) {
  const lines = text.split("\n");
  const out: Array<{ symbol: string; name: string; exchange: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip headers/footers
    if (trimmed.startsWith("Symbol|") || trimmed.startsWith("ACT Symbol|")) continue;
    if (trimmed.startsWith("File Creation Time")) continue;

    const cols = trimmed.split("|");
    if (cols.length < 2) continue;

    // nasdaqlisted.txt format: Symbol|Security Name|Market Category|...|ETF|...
    // otherlisted.txt format: ACT Symbol|Security Name|Exchange|...|ETF|...
    // We'll normalize both.

    // Try detect which file by first header usage:
    // If it looks like "AAPL|Apple Inc. - Common Stock|Q|..." => symbol is cols[0]
    // If it looks like "AAPL|Apple Inc...|N|AAPL|..." (otherlisted) still cols[0] is symbol.
    const symbol = (cols[0] || "").trim();
    const name = (cols[1] || "").trim();

    // Exchange handling: in otherlisted.txt, exchange is cols[2] (N/A/P/Z etc.)
    // in nasdaqlisted.txt, exchange isn’t directly a letter; we’ll label it NASDAQ.
    let exchange = "NASDAQ/Other";
    if (cols.length >= 3 && /^[A-Z]$/.test((cols[2] || "").trim())) {
      exchange = (cols[2] || "").trim();
    }

    // basic filters: keep only simple root symbols (avoid a lot of weird suffixed listings)
    // You can relax later.
    if (!/^[A-Z.\-]+$/.test(symbol)) continue;

    out.push({ symbol, name, exchange });
  }

  // Deduplicate
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = r.symbol;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().toUpperCase();

  // Fetch the two public symbol files (updated regularly by Nasdaq Trader)
  const [nasdaqTxt, otherTxt] = await Promise.all([
    fetch("https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt", { cache: "no-store" }).then((r) => r.text()),
    fetch("https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt", { cache: "no-store" }).then((r) => r.text()),
  ]);

  const all = [...parseNasdaqSymbolFile(nasdaqTxt), ...parseNasdaqSymbolFile(otherTxt)];

  // If no query, return a small default slice (don’t send 10k rows to the browser)
  if (!q) return NextResponse.json({ results: all.slice(0, 50) });

  // Search symbol prefix first, then name contains
  const results = all
    .filter((r) => r.symbol.startsWith(q) || r.name.toUpperCase().includes(q))
    .slice(0, 25);

  return NextResponse.json({ results });
}
