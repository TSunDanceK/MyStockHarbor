import { Redis } from "@upstash/redis";
import { hasFmpCapacity, reserveFmpCallSlot } from "./historyCache";

// A single Redis HASH holding a lightweight, rolling-fresh quote for every
// symbol the screener can display: price, % change, volume, market cap and PE.
// Using ONE hash (not one key per symbol) keeps Redis command + storage cost
// near zero -- a refresh is a single HSET of just the slice we touched, and a
// page read is a single HMGET for just the symbols it shows. Populated by the
// warm-price-pool cron (app/api/jobs/warm-price-pool); READ-ONLY on page
// renders so a page load never spends an FMP call.
//
// FMP Starter plan reality (confirmed live 2026-07-22/23):
//   * No working multi-symbol quote endpoint (stable/batch-quote 402,
//     api/v3/quote 403) -> every field is ONE call PER TICKER.
//   * stable/quote (per symbol)   -> price / %chg / volume / marketCap (no PE)
//   * stable/ratios-ttm (per sym) -> priceToEarningsRatioTTM (the only PE source)
//   * Limit is 300 calls/MIN (no daily cap; 20GB/30d bandwidth). ~550 symbols
//     refreshed every 15 min averages ~37 calls/min -- far under the ceiling.
//
// PRICE and PE have very different volatilities, so they refresh on independent
// rotations, each tracked by its own timestamp on the row:
//   * price (`ts`)   -> refreshed for the WHOLE universe every ~15 min. Each run
//     takes the stalest-by-`ts` slice, sized so the universe is fully covered in
//     PRICE_TARGET_RUNS cron runs (=> <=~15 min old with the */3 cron).
//   * PE (`peTs`)    -> slow trickle of the stalest-by-`peTs` symbols per run;
//     a P/E barely moves hour to hour, so full coverage in a couple hours then
//     just rolling is plenty. Last-known PE is carried forward on a miss.
// Only the touched fields are written; everything else persists. The hash also
// carries a safety TTL (reset every run) so a stopped cron self-expires.

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

const PRICE_POOL_KEY = "msh:price-pool:v1";
const PRICE_POOL_HASH_TTL_SECONDS = 12 * 60 * 60; // reset each run; bridges gaps

// Price coverage: with the */3 cron (5 runs / 15 min) we cover the whole
// universe in PRICE_TARGET_RUNS runs, so every price is <=~12-15 min old.
const PRICE_TARGET_RUNS = 4;
const PRICE_MIN_PER_RUN = 40; // don't bother sub-slicing a tiny universe
const PRICE_MAX_PER_RUN = 220; // bound a single run's length (~<1 min even paced)
// PE trickle: small per-run slice; slow-moving data, so this just needs to roll.
const PE_MAX_PER_RUN = 20;
const FMP_MIN_HEADROOM_CALLS = 60; // leave room for history/earnings + live traffic

export type PricePoolRow = {
  price: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
  pe: number | null;
  ts: number; // ms epoch price was last fetched
  peTs?: number; // ms epoch PE was last fetched (independent rotation)
};

function cleanSymbol(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function uniqueClean(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map(cleanSymbol).filter(Boolean)));
}

/**
 * Redis-ONLY bulk read of the pooled quotes for the symbols a page shows, in a
 * single HMGET. Never touches FMP. Any symbol not in the pool is simply absent
 * from the returned map (caller falls back to the EOD close from chartPoints).
 */
export async function readPricePoolBulk(
  symbols: string[]
): Promise<Map<string, PricePoolRow>> {
  const out = new Map<string, PricePoolRow>();
  if (!redis) return out;

  const fields = uniqueClean(symbols);
  if (!fields.length) return out;

  try {
    // Upstash's hmget returns an object keyed by field name; some versions
    // return an array aligned to the requested fields. Handle both so the read
    // never silently returns nothing.
    const raw = (await redis.hmget(PRICE_POOL_KEY, ...fields)) as unknown;
    const asArray = Array.isArray(raw) ? (raw as (PricePoolRow | null)[]) : null;
    const asObj =
      !asArray && raw && typeof raw === "object"
        ? (raw as Record<string, PricePoolRow | null>)
        : null;
    if (asArray || asObj) {
      fields.forEach((sym, i) => {
        const row = asArray ? asArray[i] : asObj ? asObj[sym] : null;
        if (row && typeof row === "object" && typeof row.ts === "number") {
          out.set(sym, {
            price: num(row.price),
            changePct: num(row.changePct),
            volume: num(row.volume),
            marketCap: num(row.marketCap),
            pe: num(row.pe),
            ts: row.ts,
            peTs: num(row.peTs) ?? 0,
          });
        }
      });
    }
  } catch {
    // fail open -- a read failure just means "no pooled quotes this render".
  }

  return out;
}

type QuoteLite = {
  price: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
};

// Per-symbol live quote (price/%chg/volume/marketCap). stable/quote is the only
// working intraday quote endpoint on this plan; it returns `changePercentage`
// (no trailing "s") and has no PE field.
async function fetchStableQuote(sym: string, apiKey: string): Promise<QuoteLite | null> {
  try {
    await reserveFmpCallSlot();
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(
      sym
    )}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const row = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      price: num(row.price),
      changePct: num(row.changePercentage) ?? num(row.changesPercentage),
      volume: num(row.volume),
      marketCap: num(row.marketCap),
    };
  } catch {
    return null;
  }
}

// Per-symbol trailing-twelve-month P/E from stable/ratios-ttm. This is the only
// endpoint on this plan that carries PE. Field is priceToEarningsRatioTTM (with
// legacy-name fallbacks). Absurd/negative PE (loss-makers) is nulled so the
// column stays meaningful.
async function fetchPeTtm(sym: string, apiKey: string): Promise<number | null> {
  try {
    await reserveFmpCallSlot();
    const url = `https://financialmodelingprep.com/stable/ratios-ttm?symbol=${encodeURIComponent(
      sym
    )}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const row = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | null;
    if (!row) return null;
    const pe =
      num(row.priceToEarningsRatioTTM) ??
      num(row.priceEarningsRatioTTM) ??
      num(row.peRatioTTM) ??
      num(row.peRatio);
    if (pe == null || pe <= 0 || pe > 100000) return null;
    return pe;
  } catch {
    return null;
  }
}

/**
 * Cron worker: refresh the pool. PRICE is refreshed for the stalest slice large
 * enough to cover the whole universe every ~15 min (independent of PE). PE is
 * refreshed for a small stalest-by-`peTs` trickle. Only touched fields are
 * written back (a single HSET) + the hash's safety expiry is reset. Everything
 * not refreshed keeps its prior value. Budget-guarded and fail-open throughout.
 */
export async function warmPricePool(symbols: string[], nowMs: number) {
  const apiKey = process.env.FMP_API_KEY;
  const clean = uniqueClean(symbols);

  if (!redis || !apiKey || !clean.length) {
    return {
      ok: false,
      reason: !redis ? "no-redis" : !apiKey ? "no-fmp-key" : "no-symbols",
      written: 0,
    };
  }

  const existing = await readPricePoolBulk(clean);

  // Price slice: stalest-by-ts, sized to cover the universe in PRICE_TARGET_RUNS.
  const priceCap = Math.min(
    PRICE_MAX_PER_RUN,
    Math.max(PRICE_MIN_PER_RUN, Math.ceil(clean.length / PRICE_TARGET_RUNS))
  );
  const priceSlice = [...clean]
    .sort((a, b) => (existing.get(a)?.ts ?? 0) - (existing.get(b)?.ts ?? 0))
    .slice(0, priceCap);
  const priceSet = new Set(priceSlice);

  // PE slice: stalest-by-peTs, small trickle.
  const peSlice = [...clean]
    .sort((a, b) => (existing.get(a)?.peTs ?? 0) - (existing.get(b)?.peTs ?? 0))
    .slice(0, PE_MAX_PER_RUN);
  const peSet = new Set(peSlice);

  // Union, price-slice first (PE-only symbols are usually already in it).
  const targets = Array.from(new Set([...priceSlice, ...peSlice]));

  const payload: Record<string, PricePoolRow> = {};
  let pxRefreshed = 0;
  let peRefreshed = 0;

  for (const sym of targets) {
    const prev = existing.get(sym);
    const wantPrice = priceSet.has(sym);
    const wantPe = peSet.has(sym);

    let quote: QuoteLite | null = null;
    let peFetched = false;
    let peValue: number | null = null;

    if (wantPrice) {
      if (!(await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS))) break;
      quote = await fetchStableQuote(sym, apiKey);
    }
    if (wantPe) {
      if (await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS)) {
        peValue = await fetchPeTtm(sym, apiKey);
        peFetched = true;
      }
    }

    if (!quote && !peFetched) continue; // nothing landed for this symbol

    payload[sym] = {
      price: quote ? quote.price : prev?.price ?? null,
      changePct: quote ? quote.changePct : prev?.changePct ?? null,
      volume: quote ? quote.volume : prev?.volume ?? null,
      marketCap: quote ? quote.marketCap : prev?.marketCap ?? null,
      // carry forward last-known PE if this run didn't (re)fetch a value
      pe: peFetched ? peValue ?? prev?.pe ?? null : prev?.pe ?? null,
      ts: quote ? nowMs : prev?.ts ?? nowMs,
      peTs: peFetched ? nowMs : prev?.peTs ?? 0,
    };
    if (quote) pxRefreshed++;
    if (peFetched && peValue != null) peRefreshed++;
  }

  let written = 0;
  try {
    if (Object.keys(payload).length) {
      await redis.hset(PRICE_POOL_KEY, payload);
      written = Object.keys(payload).length;
    }
    // Always reset the safety TTL so an all-skipped run can't let the hash lapse.
    await redis.expire(PRICE_POOL_KEY, PRICE_POOL_HASH_TTL_SECONDS);
  } catch {
    // fail open -- a failed warm just means the pool keeps its prior values.
  }

  return {
    ok: true,
    universe: clean.length,
    priceCap,
    priceRefreshed: pxRefreshed,
    peRefreshed,
    written,
  };
}
