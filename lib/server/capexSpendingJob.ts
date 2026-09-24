// Builds the "Who is spending" record (Relay C, #563 COWORK #1 D1) from what
// Relay A already stores — no second SEC pipeline:
//   - data/sec/registrants.json, the profiled universe (symbol -> CIK); the
//     same file A's sector resolver reads, so every symbol read here is one it
//     can place. NOT the SEC manifest: A's check keeps the manifest's 417 KB
//     value to its own named jobs, and a second reader is not ours to add.
//     Each symbol is read under every spelling (BRK-B and BRK.B), since fact
//     sets are keyed by the spelling the stock page uses; the aggregation then
//     folds listings of one filer by CIK.
//   - each symbol's stored fact set (annual years, already in USD, one capex
//     concept per filer), read with A's own readers,
//   - A's sector resolver (#569), SEC-only (no cached FMP-era sector).
// Aggregation is in ./capexSpendingCore.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import registrantsFile from "@/data/sec/registrants.json";
import { symbolSpellings } from "@/lib/symbolSpellings.mjs";
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
export function toSpendingInput(set: StoredFactSet, sector: string | null, cik: string | null): SpendingInput {
  return {
    symbol: set.symbol,
    cik,
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
  const rows = (registrantsFile as unknown as { rows: Record<string, { cik: string | null }> }).rows;
  const symbols = Object.keys(rows).filter((s) => rows[s]?.cik);
  const cikOf = new Map<string, string>();
  const keys: string[] = [];
  for (const s of symbols) {
    for (const spelling of symbolSpellings(s) as string[]) {
      if (cikOf.has(spelling)) continue;
      cikOf.set(spelling, rows[s].cik as string);
      keys.push(spelling);
    }
  }
  const hash = secFieldsHash();
  const sets: StoredFactSet[] = [];
  let staleFieldOrder = 0;
  let commands = 0;
  for (let i = 0; i < keys.length; i += SPENDING_MGET_CHUNK) {
    const chunk = keys.slice(i, i + SPENDING_MGET_CHUNK);
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
  const inputs = sets.map((s) => toSpendingInput(s, sectors.get(s.symbol.toUpperCase())?.sector ?? null, s.cik ?? cikOf.get(s.symbol.toUpperCase()) ?? null));
  const record = aggregateSpending(inputs, spendingYears(nowMs), nowMs);
  return { record, symbols: symbols.length, setsRead: sets.length, staleFieldOrder, commands };
}
