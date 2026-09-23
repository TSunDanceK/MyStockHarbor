// THE SEC LEG OF THE NEWS FEED, READ FROM REDIS AND WRITTEN BY THE JOB.
//
// #535 COWORK #12/#13: nothing a visitor or bot does may reach SEC. The news
// adapter used to fetch data.sec.gov/submissions on a view-triggered refresh,
// at most once per symbol per hour, for any symbol with a stock page — so a
// crawler walking /stock/<ticker>/news drove SEC traffic. Now:
//
//   - sec-daily-index (04:00 UTC), which already reads the day's EDGAR index,
//     re-reads submissions for every tracked symbol that filed anything that
//     day, plus a bounded backfill of tracked symbols with no stored items,
//     and stores the parsed items here;
//   - secProvider.fetchForSymbol reads this key. No network.
//
// A symbol outside the manifest has no SEC leg in its news feed. That is the
// cost of the rule, and it is small: the leg is a supplement (see secProvider).
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "../redisCacheMode";
import { canWriteSecState, noteSecWriteBlocked } from "../secWriteGate";
import type { NewsItem } from "./types";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv({ ...PAGE_READ_CACHE, retry: { retries: 1, backoff: () => 50 } })
    : null;

export const SEC_FILINGS_NEWS_PREFIX = "msh:news:sec-filings:v1";
/** Past the adapter's own 120-day window, so a quiet filer keeps its items. */
export const SEC_FILINGS_NEWS_TTL_S = 130 * 86400;

export const secFilingsNewsKey = (symbol: string) =>
  `${SEC_FILINGS_NEWS_PREFIX}:${symbol.trim().toUpperCase()}`;

type Stored = { items: NewsItem[]; fetchedAt: number };

/** The stored items, or [] — never a network call. */
export async function readSecFilingItems(symbol: string): Promise<NewsItem[]> {
  if (!redis) return [];
  try {
    const raw = await redis.get<Stored>(secFilingsNewsKey(symbol));
    return Array.isArray(raw?.items) ? raw!.items : [];
  } catch {
    return [];
  }
}

export async function writeSecFilingItems(symbol: string, items: NewsItem[]): Promise<boolean> {
  if (!redis) return false;
  if (!canWriteSecState()) { noteSecWriteBlocked("secFilingsNews"); return false; }
  try {
    await redis.set(secFilingsNewsKey(symbol), { items, fetchedAt: Date.now() } satisfies Stored, {
      ex: SEC_FILINGS_NEWS_TTL_S,
    });
    return true;
  } catch {
    return false;
  }
}

/** Which of these symbols have no stored items yet (one pipelined EXISTS each). */
export async function missingSecFilingItems(symbols: string[]): Promise<string[]> {
  if (!redis || symbols.length === 0) return [];
  try {
    const p = redis.pipeline();
    for (const s of symbols) p.exists(secFilingsNewsKey(s));
    const hits = (await p.exec()) as number[];
    return symbols.filter((_, i) => !hits[i]);
  } catch {
    return [];
  }
}
