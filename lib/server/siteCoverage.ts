// HOW MUCH THE SITE COVERS, FOR COPY: live counts, rounded down and hedged.
//
// One line, said the same way on /stocks, /about and the homepage description
// (#552 owner request, 16 Oct 2026). /stocks used to state its curated counts
// ("129 companies and 32 ETFs") as if they were the site's whole coverage; they
// are the directory's featured list, and the coverage line says the rest.
//
// THE COUNTS ARE READ, NEVER TYPED IN:
//   stock pages  exchange-listed tickers in SEC's company_tickers_exchange file
//                (data/sec/company-tickers.json, validated on load by
//                secTickerMap): Nasdaq, NYSE and Cboe, not OTC. No store read.
//   pickers      the picker universe the last warm-picker-universe run built
//                (its recorded universeSize). One small GET, cached a day.
// Rounded DOWN (to the thousand from 2,000, else to the hundred), and worded
// "over" when rounding dropped something and "about" when it did not -- so the
// copy can only ever understate. A count that cannot be read drops its number
// rather than falling back to a typed-in one.
import { unstable_cache } from "next/cache";
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { JOB_RUN_PREFIX, type JobRun } from "./jobRuns";
import { loadTickerMap } from "./secTickerMap";
import { listedTickerCount, type SiteCoverage } from "../siteCoverageText";

export { coverageDescription, coverageLine, hedgedCount, listedTickerCount, type SiteCoverage } from "../siteCoverageText";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

function stockPageCount(): number | null {
  const { present, map } = loadTickerMap();
  if (!present) return null;
  const n = listedTickerCount(map.values());
  return n > 0 ? n : null;
}

const readPickerUniverse = unstable_cache(
  async (): Promise<number> => {
    if (!redis) throw new Error("no store");
    const run = await redis.get<JobRun>(`${JOB_RUN_PREFIX}:warm-picker-universe`);
    const n = run?.summary?.universeSize;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) throw new Error("no universe size");
    return n;
  },
  ["site-coverage-pickers-v1"],
  // A DAY: the universe moves by hand-made cap changes, and unstable_cache
  // lowers a static page's ISR period to this, so no shorter. A failed read
  // throws, so it is not cached.
  { revalidate: 86400, tags: ["site-coverage"] },
);

export async function siteCoverage(): Promise<SiteCoverage> {
  let pickers: number | null = null;
  try {
    pickers = await readPickerUniverse();
  } catch {
    pickers = null;
  }
  return { stockPages: stockPageCount(), pickers };
}
