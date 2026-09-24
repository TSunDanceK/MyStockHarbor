// Builds the "Who is spending" record (Relay C, #563 COWORK #1 D1) from what
// Relay A already stores — no second SEC pipeline:
//   - the SEC manifest (which symbols have fact sets),
//   - each symbol's stored fact set (annual years, already in USD, one capex
//     concept per filer), read with A's own readers,
//   - A's sector resolver (#569), SEC-only (no cached FMP-era sector).
// Aggregation is in ./capexSpendingCore.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { readManifest } from "./secManifest";
import { factKey, valueOf, type StoredFactSet } from "./secFactStore";
import { secFieldsHash } from "./secFields";
import { resolveProfileBulk } from "./staticProfile";
import { aggregateSpending, spendingYears, type SpendingInput, type SpendingRecord } from "./capexSpendingCore";

/** Fact sets per MGET: ~15 KB each, so ~1.5 MB a call, well under Upstash's 10 MB response cap. */
export const SPENDING_MGET_CHUNK = 100;

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

/** One stored fact set, as the aggregation reads it. Exported for the check. */
export function toSpendingInput(set: StoredFactSet, sector: string | null): SpendingInput {
  return {
    symbol: set.symbol,
    sector,
    currency: set.cur ?? null,
    years: (set.years ?? []).map((y) => ({
      s: y.s,
      e: y.e,
      capex: valueOf(y, "capex"),
      revenue: valueOf(y, "revenue"),
      rnd: valueOf(y, "researchAndDevelopment"),
    })),
  };
}

export async function buildSpendingRecord(nowMs: number): Promise<{
  record: SpendingRecord | null;
  symbols: number;
  setsRead: number;
  staleFieldOrder: number;
  commands: number;
  error?: string;
}> {
  if (!redis) return { record: null, symbols: 0, setsRead: 0, staleFieldOrder: 0, commands: 0, error: "no redis" };
  const manifest = await readManifest();
  let commands = 1;
  if (!manifest) return { record: null, symbols: 0, setsRead: 0, staleFieldOrder: 0, commands, error: "no manifest" };
  const symbols = Object.entries(manifest.symbols)
    .filter(([, e]) => e.cik && !e.delisted)
    .map(([s]) => s);
  const hash = secFieldsHash();
  const sets: StoredFactSet[] = [];
  let staleFieldOrder = 0;
  for (let i = 0; i < symbols.length; i += SPENDING_MGET_CHUNK) {
    const chunk = symbols.slice(i, i + SPENDING_MGET_CHUNK);
    const got = await redis.mget<(StoredFactSet | null)[]>(...chunk.map(factKey));
    commands++;
    for (const s of got) {
      if (!s) continue;
      // The same gate as readFactSet: a set written under another field order
      // would read the wrong column for every figure.
      if (s.h !== hash || !Array.isArray(s.years)) {
        staleFieldOrder++;
        continue;
      }
      sets.push(s);
    }
  }
  const sectors = resolveProfileBulk(sets.map((s) => ({ symbol: s.symbol, cached: null })), "capex-spending");
  const inputs = sets.map((s) => toSpendingInput(s, sectors.get(s.symbol.toUpperCase())?.sector ?? null));
  const record = aggregateSpending(inputs, spendingYears(nowMs), nowMs);
  return { record, symbols: symbols.length, setsRead: sets.length, staleFieldOrder, commands };
}
