// THE VALUATION CARD'S SECTOR BENCHMARKS (#552 COWORK #202 item 3). The rules
// are lib/valuationBands.ts.
//
// FROM THE DATA CACHE, NOT A NEW REDIS KEY — the same deal as the P/E sector
// medians (peSectorMedians.ts). The inputs are the SEC picker rows, read in
// FULL (the multiple inputs ride on them; readSecCapRows trims them to shares
// and EPS), and each symbol's latest stored close (readTiingoEodLast, already
// cached for the pool). Every figure is the shipped valuationMultiples on FILED
// inputs only (no estimate or derived figure) and the pickers' own P/E.
//
// COST: one HGETALL of the picker hash per 6 hours per deployment; the closes
// are an existing cache entry. A page render costs no Redis command on a hit.
import { unstable_cache } from "next/cache";
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { PICKERS_SEC_KEY, PICKERS_SEC_TTL_SECONDS, secCapAndPe, toSecCapRow, type SecPickerRow } from "./pickersSecFundamentals";
import { valuationMultiples, type ValuationInputs } from "./secValuation";
import { readTiingoEodLast } from "./marketData/read";
import { sicProfileFor } from "./staticProfile";
import { registrantFor } from "./stockProfile";
import { isBankSic } from "./peSectorMedians";
import { BANKS_GROUP, buildBenchmarks, type ValuationBandKey, type ValuationBenchmarks } from "../valuationBands";
import { toDashed, toDotted } from "../symbolSpellings.mjs";

/** The group a symbol is compared within: banks by SIC, else the FMP-free sector. */
export function valuationGroupOf(symbol: string): string | null {
  if (isBankSic(registrantFor(symbol)?.sic)) return BANKS_GROUP;
  return sicProfileFor(symbol)?.sector ?? null;
}

/** A full picker row as stored, loosely checked: the fields the multiples need. */
function asRow(v: unknown, staleBefore: number): SecPickerRow | null {
  let row = v;
  if (typeof row === "string") { try { row = JSON.parse(row); } catch { return null; } }
  const r = row as Partial<SecPickerRow> | null;
  if (!r || r.v !== 1 || !r.m || !r.inputs || typeof r.at !== "number" || r.at < staleBefore) return null;
  return r as SecPickerRow;
}

async function loadValuationBenchmarks(): Promise<ValuationBenchmarks | null> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  const redis = Redis.fromEnv(PAGE_READ_CACHE);
  const [raw, eod] = await Promise.all([
    redis.hgetall<Record<string, unknown>>(PICKERS_SEC_KEY).catch(() => null),
    readTiingoEodLast().catch(() => null),
  ]);
  if (!raw || !eod) return null;
  const staleBefore = Date.now() - PICKERS_SEC_TTL_SECONDS * 1000;
  const rows: { group: string; key: ValuationBandKey; val: number }[] = [];
  let asOf = "";
  for (const [sym, value] of Object.entries(raw)) {
    const row = asRow(value, staleBefore);
    if (!row) continue;
    const last = eod[sym] ?? eod[toDashed(sym)] ?? eod[toDotted(sym)];
    if (!last) continue;
    const group = valuationGroupOf(sym);
    if (!group) continue;
    const inputs: ValuationInputs = { shares: row.inputs.shares, eps: null, refusals: row.inputs.refusals, sic: row.inputs.sic ?? null };
    // FILED FIGURES ONLY: a peer's estimated or derived figure would reach the
    // quartiles shown on tap unmarked (check-estimates: an estimate never renders
    // without its mark). The company's own figure keeps its mark on its row.
    const m = valuationMultiples(inputs, row.m, last.c);
    const pe = secCapAndPe(toSecCapRow(row), last.c).pe;
    const add = (key: ValuationBandKey, val: number | null | undefined) => {
      if (typeof val === "number" && Number.isFinite(val) && val > 0) rows.push({ group, key, val });
    };
    add("peRatio", pe);
    add("priceToSalesRatio", m.ps?.ok ? m.ps.val : null);
    add("priceToBookRatio", m.pb?.ok ? m.pb.val : null);
    add("evToEbitda", m.evEbitda?.ok ? m.evEbitda.val : null);
    if (last.d > asOf) asOf = last.d;
  }
  return buildBenchmarks(rows, asOf);
}

export const readValuationBenchmarks = unstable_cache(loadValuationBenchmarks, ["valuation-benchmarks-v1", PICKERS_SEC_KEY], { revalidate: 6 * 60 * 60 });
