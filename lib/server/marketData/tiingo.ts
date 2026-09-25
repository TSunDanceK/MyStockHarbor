// THE TIINGO ADAPTER, AND THE ONLY FILE THAT READS TIINGO_API_KEY
// (#553 COWORK #55 §2, #56, #57; scripts/check-tiingo-key-scope.mjs ALLOWED).
//
// RULE 1 OF COWORK #56: TIINGO IS CALLED ONLY BY SCHEDULED JOBS. Nothing a
// visitor's request runs may reach this file -- scripts/check-tiingo-callers.mjs
// holds the import graph to lib/server/marketData/jobs.ts, whose only importers
// are the two job routes. So bots and traffic spikes cannot spend the quota,
// and a cache miss can never turn into a live Tiingo call.
//
// AND ONLY IN PRODUCTION. The key is set for Preview too, and previews share
// production's stores, so tiingoCallRefusal() refuses anything that is not a
// production runtime, and refuses `next build` outright.
//
// THE LIMITER COUNTS REQUESTS ITSELF, AND FAILS CLOSED. Tiingo sends no
// rate-limit headers at all (CODE-B #47: none on any of 27 responses), so the
// only meter is ours. Caps are 80% of the contract's 20,000/hour and
// 300,000/day, not the 30,000 the dashboard shows (COWORK #55). A Redis error,
// or a count over either cap, refuses the request; a refused reservation stays
// counted, which errs toward stopping.
//
// NOTHING HERE STORES ANYTHING. Callers (jobs.ts) decide what is written, under
// the msh:tiingo: prefix that scripts/tiingo-purge.mjs lists and deletes (§7).
import { Redis } from "@upstash/redis";
import { toTiingo } from "../../symbolSpellings.mjs";
import type { EodBar, StoredQuote } from "./types";

const API = "https://api.tiingo.com";

export const TIINGO_HOURLY_CAP = 16_000;
export const TIINGO_DAILY_CAP = 240_000;
export const TIINGO_CALLS_PREFIX = "msh:tiingo:calls:v1";
/** Tickers per IEX batch request. ~844 tickers is 9 requests. */
export const IEX_BATCH = 100;

export class TiingoRefused extends Error {
  reason: string;
  constructor(reason: string) {
    super(`tiingo refused: ${reason}`);
    this.name = "TiingoRefused";
    this.reason = reason;
  }
}

export class TiingoHttpError extends Error {
  status: number;
  constructor(status: number, what: string) {
    super(`tiingo HTTP ${status} on ${what}`);
    this.name = "TiingoHttpError";
    this.status = status;
  }
}

/** Why a Tiingo call may not run here, or null when it may. */
export function tiingoCallRefusal(env: Record<string, string | undefined> = process.env): string | null {
  if (env.NEXT_PHASE === "phase-production-build") return "next build";
  if (env.VERCEL_ENV !== "production") return `not production (${env.VERCEL_ENV ?? "unset"})`;
  if (!env.TIINGO_API_KEY) return "no key";
  return null;
}

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;

function hourAndDay(nowMs: number) {
  const iso = new Date(nowMs).toISOString();
  return { hour: iso.slice(0, 13), day: iso.slice(0, 10) };
}

/**
 * Reserve `n` requests against both caps. 4 commands (one pipeline).
 * Throws TiingoRefused when over a cap, on any Redis error, or with no Redis.
 */
export async function reserveTiingoRequests(n: number, nowMs = Date.now()): Promise<{ hour: number; day: number }> {
  const refusal = tiingoCallRefusal();
  if (refusal) throw new TiingoRefused(refusal);
  if (!redis) throw new TiingoRefused("no redis for the limiter");
  const { hour, day } = hourAndDay(nowMs);
  const hKey = `${TIINGO_CALLS_PREFIX}:h:${hour}`;
  const dKey = `${TIINGO_CALLS_PREFIX}:d:${day}`;
  let used: unknown[];
  try {
    const p = redis.pipeline();
    p.incrby(hKey, n);
    p.expire(hKey, 2 * 60 * 60);
    p.incrby(dKey, n);
    p.expire(dKey, 2 * 24 * 60 * 60);
    used = await p.exec();
  } catch (err) {
    throw new TiingoRefused(`limiter redis error (${err instanceof Error ? err.name : "unknown"})`);
  }
  const h = Number(used[0]);
  const d = Number(used[2]);
  if (!Number.isFinite(h) || !Number.isFinite(d)) throw new TiingoRefused("limiter read no count");
  if (h > TIINGO_HOURLY_CAP) throw new TiingoRefused(`hourly cap (${h} > ${TIINGO_HOURLY_CAP})`);
  if (d > TIINGO_DAILY_CAP) throw new TiingoRefused(`daily cap (${d} > ${TIINGO_DAILY_CAP})`);
  return { hour: h, day: d };
}

/** One request. Callers reserve first; this only refuses where calls may not run. */
async function tiingoGet(pathAndQuery: string, what: string): Promise<{ text: string; bytes: number }> {
  const refusal = tiingoCallRefusal();
  if (refusal) throw new TiingoRefused(refusal);
  const res = await fetch(`${API}${pathAndQuery}`, {
    headers: { Authorization: `Token ${process.env.TIINGO_API_KEY}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  if (res.status !== 200) throw new TiingoHttpError(res.status, what);
  return { text, bytes: Buffer.byteLength(text) };
}

// ── IEX quotes (the hourly job) ─────────────────────────────────────────────

/** price = the last IEX trade, else Tiingo's tngoLast; at = the last sale, else the quote's timestamp. */
export type IexQuote = StoredQuote;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Parse one IEX batch body into our symbols. Exported for the checks. */
export function parseIexBatch(body: unknown, bySpelling: Map<string, string>): Map<string, IexQuote> {
  const out = new Map<string, IexQuote>();
  if (!Array.isArray(body)) return out;
  for (const row of body as Record<string, unknown>[]) {
    const ours = bySpelling.get(String(row?.ticker ?? "").toUpperCase());
    const price = num(row?.last) ?? num(row?.tngoLast);
    const at = Date.parse(String(row?.lastSaleTimestamp ?? row?.timestamp ?? ""));
    if (!ours || price === null || !Number.isFinite(at)) continue;
    out.set(ours, { price, open: num(row.open), high: num(row.high), low: num(row.low), prevClose: num(row.prevClose), at });
  }
  return out;
}

/** IEX quotes for our symbols, IEX_BATCH per request. Reserves its own requests. */
export async function fetchIexQuotes(symbols: string[], nowMs = Date.now()) {
  const bySpelling = new Map(symbols.map((s) => [toTiingo(s), s] as const));
  const spellings = [...bySpelling.keys()];
  const batches: string[][] = [];
  for (let i = 0; i < spellings.length; i += IEX_BATCH) batches.push(spellings.slice(i, i + IEX_BATCH));
  await reserveTiingoRequests(batches.length, nowMs);
  const quotes = new Map<string, IexQuote>();
  let bytes = 0;
  for (const b of batches) {
    const r = await tiingoGet(`/iex/?tickers=${encodeURIComponent(b.join(","))}`, "iex batch");
    bytes += r.bytes;
    let body: unknown = null;
    try { body = JSON.parse(r.text); } catch { /* counted as missing below */ }
    for (const [k, v] of parseIexBatch(body, bySpelling)) quotes.set(k, v);
  }
  return { quotes, requests: batches.length, bytes };
}

// ── EOD (the nightly job) ───────────────────────────────────────────────────

/** Split one CSV line. Tiingo's price CSV has no quoted fields, but be safe. */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Parse a per-ticker price CSV into adjusted bars, oldest first. Exported for the checks. */
export function parseEodCsv(text: string): EodBar[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const h = csvFields(lines[0] ?? "").map((f) => f.trim());
  const at = (name: string) => h.indexOf(name);
  const [iD, iO, iH, iL, iC, iV] = [at("date"), at("adjOpen"), at("adjHigh"), at("adjLow"), at("adjClose"), at("adjVolume")];
  if ([iD, iO, iH, iL, iC, iV].some((i) => i < 0)) return [];
  const bars: EodBar[] = [];
  for (const l of lines.slice(1)) {
    const f = csvFields(l);
    const d = String(f[iD] ?? "").slice(0, 10);
    const [o, hi, lo, c, v] = [f[iO], f[iH], f[iL], f[iC], f[iV]].map(Number);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || ![o, hi, lo, c].every((x) => Number.isFinite(x) && x > 0)) continue;
    bars.push([d, r4(o), r4(hi), r4(lo), r4(c), Number.isFinite(v) ? Math.round(v) : 0]);
  }
  bars.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return bars;
}

/**
 * The bulk EOD file, used ONLY as the gate that tonight's date has landed:
 * how many rows carry each date. 1 request, ~5 MB. Reserves its own request.
 */
export async function fetchEodLanded(nowMs = Date.now()): Promise<{ counts: Map<string, number>; bytes: number }> {
  await reserveTiingoRequests(1, nowMs);
  const r = await tiingoGet("/tiingo/daily/prices?format=csv", "bulk eod");
  const lines = r.text.split(/\r?\n/).filter(Boolean);
  const iD = csvFields(lines[0] ?? "").findIndex((f) => f.trim() === "date");
  const counts = new Map<string, number>();
  if (iD >= 0) {
    for (const l of lines.slice(1)) {
      const d = String(csvFields(l)[iD] ?? "").slice(0, 10);
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  return { counts, bytes: r.bytes };
}

/** One symbol's adjusted daily bars since `startDate`. The CALLER reserves (in blocks). */
export async function fetchEodHistory(symbol: string, startDate: string): Promise<{ bars: EodBar[]; bytes: number }> {
  const t = toTiingo(symbol);
  const r = await tiingoGet(`/tiingo/daily/${encodeURIComponent(t)}/prices?format=csv&startDate=${startDate}`, "eod history");
  return { bars: parseEodCsv(r.text), bytes: r.bytes };
}
