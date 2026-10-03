// THE NEWS PAGE'S TECHNICAL HISTORY, OFF YAHOO (#563 COWORK #31 (a)).
//
// /stock/[symbol]/news computes its "Technical Picture" (trend, RSI, distance
// from MA50/MA200, the 20-day range) and the news card sparkline from a daily
// history. That history came from Yahoo's chart endpoint, which is not a
// licensed source. Behind PRICE_PROVIDER_NEWS_TECH=tiingo it now comes from the
// stored Tiingo EOD bars instead; until the owner flips the switch (or on any
// miss) the caller keeps its existing path.
//
// NEVER INTO AI. These figures are shown as plain numbers on the page. The two
// news AI calls take non-price inputs only, enforced by the allow-list in
// lib/ai-news-briefs.ts and pinned by scripts/check-news-ai-inputs.mjs.
//
// READS ONLY, THROUGH B'S ADAPTER. readTiingoHistory is the same cached entry
// the news hero price already reads for this symbol (tiingoSurfacePrice), so
// the switch adds no Redis command and no Tiingo request.
import { readTiingoHistory } from "./marketData/read";
import { priceProviderFor } from "./marketData/provider";

/** The shape lib/stock-news-data.ts computes from (its Point). */
export type NewsTechPoint = { date: string; close: number; high?: number; low?: number; volume?: number };

/** As many daily points as the Yahoo path kept, so every window the page computes is unchanged. */
export const NEWS_TECH_POINTS = 320;

/**
 * The stored Tiingo history as the page's points, or null when the switch is
 * off, the read fails, or nothing usable is stored -- the caller then keeps its
 * existing source. Never throws.
 */
export async function readNewsTechHistory(
  symbol: string,
  env: Record<string, string | undefined> = process.env
): Promise<NewsTechPoint[] | null> {
  if (priceProviderFor("NEWS_TECH", env) !== "tiingo") return null;
  const eod = await readTiingoHistory(symbol.trim().toUpperCase()).catch(() => null);
  const points: NewsTechPoint[] = [];
  for (const [date, , high, low, close, volume] of eod?.bars ?? []) {
    if (!Number.isFinite(close) || close <= 0) continue;
    points.push({
      date,
      close,
      high: Number.isFinite(high) ? high : undefined,
      low: Number.isFinite(low) ? low : undefined,
      volume: Number.isFinite(volume) ? volume : undefined,
    });
  }
  return points.length ? points.slice(-NEWS_TECH_POINTS) : null;
}
