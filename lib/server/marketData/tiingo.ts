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
// ONE CARVE-OUT EACH, BOTH OWNER-APPROVED (#553 COWORK #121/#123):
//   * WHO: besides the jobs, the stock-page cold fill
//     (lib/server/marketData/coldFill.ts) may call here, behind its own gates
//     (supported list, visitor cap, BotID, global caps, lock).
//   * WHERE: that path (`"cold-fill"`) may also run on Preview, through the
//     same limiter and caps, so it can be accepted on a preview. So may the
//     tiingo-supported job's one daily download (`"supported-list"`, #553
//     COWORK #127): the cold fill's admission list, a static file rather than an
//     API query, without which a preview's cold fills all refuse. Every other
//     call (`"job"`, the default) stays production-only.
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
import { PAGE_READ_CACHE } from "../redisCacheMode";
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

/** Which caller is asking: the scheduled jobs, or the stock-page cold fill (see the header). */
export type TiingoCallPath = "job" | "cold-fill" | "supported-list";

/** The paths that may also run on Preview (owner rulings, #553 COWORK #123 and #127). */
const PREVIEW_PATHS: ReadonlySet<TiingoCallPath> = new Set(["cold-fill", "supported-list"]);

/** Why a Tiingo call may not run here, or null when it may. */
export function tiingoCallRefusal(
  env: Record<string, string | undefined> = process.env,
  path: TiingoCallPath = "job"
): string | null {
  if (env.NEXT_PHASE === "phase-production-build") return "next build";
  const allowed = env.VERCEL_ENV === "production" || (PREVIEW_PATHS.has(path) && env.VERCEL_ENV === "preview");
  if (!allowed) return `not production (${env.VERCEL_ENV ?? "unset"})`;
  if (!env.TIINGO_API_KEY) return "no key";
  return null;
}

// PAGE_READ_CACHE because the stock page now reaches this module through the
// cold-fill server action (#553 COWORK #121), and check-page-read-cache counts
// that as page-reachable. The limiter's INCRBY/EXPIRE are POSTs, which no
// cache mode stores, so this changes nothing about what the limiter counts.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv({ ...PAGE_READ_CACHE }) : null;

function hourAndDay(nowMs: number) {
  const iso = new Date(nowMs).toISOString();
  return { hour: iso.slice(0, 13), day: iso.slice(0, 10) };
}

/**
 * Reserve `n` requests against both caps. 4 commands (one pipeline).
 * Throws TiingoRefused when over a cap, on any Redis error, or with no Redis.
 */
export async function reserveTiingoRequests(
  n: number,
  nowMs = Date.now(),
  path: TiingoCallPath = "job"
): Promise<{ hour: number; day: number }> {
  const refusal = tiingoCallRefusal(process.env, path);
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
async function tiingoGet(
  pathAndQuery: string,
  what: string,
  opts: { path?: TiingoCallPath; signal?: AbortSignal } = {}
): Promise<{ text: string; bytes: number }> {
  const refusal = tiingoCallRefusal(process.env, opts.path ?? "job");
  if (refusal) throw new TiingoRefused(refusal);
  const res = await fetch(`${API}${pathAndQuery}`, {
    headers: { Authorization: `Token ${process.env.TIINGO_API_KEY}`, "Content-Type": "application/json" },
    cache: "no-store",
    signal: opts.signal,
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

/**
 * Parse a per-ticker price CSV into SPLIT-ADJUSTED bars, oldest first.
 * Exported for the checks.
 *
 * PRICE BASIS B (#553 COWORK #60): split-adjusted only, NOT Tiingo's adjClose.
 * adjClose is also dividend-adjusted, which moved MA200 by 0.5-3.5% on the
 * dividend payers in the first parity run (CODE-B #50) against the basis the
 * site's signals use today. So the raw open/high/low/close are divided, and the
 * raw volume multiplied, by the product of every splitFactor dated AFTER the
 * bar -- applied backward from the newest bar, so the newest price is the
 * traded price and a 2-for-1 halves everything before its ex-date.
 *
 * Only the fetched window matters: a split before the window's first bar
 * moves nothing inside it, and the window always ends at the latest session.
 */
export function parseEodCsv(text: string): EodBar[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const h = csvFields(lines[0] ?? "").map((f) => f.trim());
  const at = (name: string) => h.indexOf(name);
  const [iD, iO, iH, iL, iC, iV, iS] = [at("date"), at("open"), at("high"), at("low"), at("close"), at("volume"), at("splitFactor")];
  if ([iD, iO, iH, iL, iC, iV, iS].some((i) => i < 0)) return [];
  type Raw = { d: string; o: number; h: number; l: number; c: number; v: number; s: number };
  const raw: Raw[] = [];
  for (const line of lines.slice(1)) {
    const f = csvFields(line);
    const d = String(f[iD] ?? "").slice(0, 10);
    const [o, hi, lo, c, v, sf] = [f[iO], f[iH], f[iL], f[iC], f[iV], f[iS]].map(Number);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || ![o, hi, lo, c].every((x) => Number.isFinite(x) && x > 0)) continue;
    raw.push({ d, o, h: hi, l: lo, c, v: Number.isFinite(v) ? v : 0, s: Number.isFinite(sf) && sf > 0 ? sf : 1 });
  }
  raw.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const bars: EodBar[] = new Array(raw.length);
  let factor = 1; // product of the split factors dated after the bar being written
  for (let i = raw.length - 1; i >= 0; i--) {
    const r = raw[i];
    bars[i] = [r.d, r4(r.o / factor), r4(r.h / factor), r4(r.l / factor), r4(r.c / factor), Math.round(r.v * factor)];
    factor *= r.s; // a split ON this date applies to every bar before it
  }
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

/**
 * One symbol's adjusted daily bars since `startDate`. The CALLER reserves (in
 * blocks). `opts.path` is "cold-fill" only from coldFill.ts; `opts.signal`
 * bounds the request (the cold fill's 3 s timeout).
 */
export async function fetchEodHistory(
  symbol: string,
  startDate: string,
  opts: { path?: TiingoCallPath; signal?: AbortSignal } = {}
): Promise<{ bars: EodBar[]; bytes: number }> {
  const t = toTiingo(symbol);
  const r = await tiingoGet(`/tiingo/daily/${encodeURIComponent(t)}/prices?format=csv&startDate=${startDate}`, "eod history", opts);
  return { bars: parseEodCsv(r.text), bytes: r.bytes };
}

// ── supported tickers (the tiingo-supported job) ─────────────────────────────

/** Tiingo's daily list of every ticker it carries: a zip holding one CSV. */
const SUPPORTED_TICKERS_URL = "https://apimedia.tiingo.com/docs/tiingo/daily/supported_tickers.zip";

/**
 * Pure: the first file in a zip, inflated. Reads the central directory (the
 * local headers may defer their sizes to a data descriptor). Stored (0) and
 * deflate (8) only; anything else throws. Exported for the checks.
 */
export function firstZipEntry(zip: Buffer, inflateRaw: (b: Buffer) => Buffer): Buffer {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip: no end of central directory");
  const cd = zip.readUInt32LE(eocd + 16);
  if (zip.readUInt32LE(cd) !== 0x02014b50) throw new Error("zip: bad central directory");
  const method = zip.readUInt16LE(cd + 10);
  const size = zip.readUInt32LE(cd + 20);
  const local = zip.readUInt32LE(cd + 42);
  if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error("zip: bad local header");
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const body = zip.subarray(start, start + size);
  if (method === 0) return Buffer.from(body);
  if (method === 8) return inflateRaw(body);
  throw new Error(`zip: method ${method}`);
}

export type SupportedTickerRow = { ticker: string; exchange: string; assetType: string; priceCurrency: string; endDate: string };

/** Pure: the CSV's rows (ticker,exchange,assetType,priceCurrency,startDate,endDate). Exported for the checks. */
export function parseSupportedTickers(csv: string): SupportedTickerRow[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const h = csvFields(lines[0] ?? "").map((f) => f.trim());
  const at = (n: string) => h.indexOf(n);
  const [iT, iX, iA, iP, iE] = [at("ticker"), at("exchange"), at("assetType"), at("priceCurrency"), at("endDate")];
  if ([iT, iX, iA, iP, iE].some((i) => i < 0)) return [];
  const out: SupportedTickerRow[] = [];
  for (const line of lines.slice(1)) {
    const f = csvFields(line);
    out.push({
      ticker: String(f[iT] ?? "").trim(),
      exchange: String(f[iX] ?? "").trim(),
      assetType: String(f[iA] ?? "").trim(),
      priceCurrency: String(f[iP] ?? "").trim(),
      endDate: String(f[iE] ?? "").trim().slice(0, 10),
    });
  }
  return out;
}

/** The supported-tickers list. 1 request, reserved here. */
export async function fetchSupportedTickers(
  inflateRaw: (b: Buffer) => Buffer,
  nowMs = Date.now()
): Promise<{ rows: SupportedTickerRow[]; bytes: number }> {
  await reserveTiingoRequests(1, nowMs, "supported-list");
  const refusal = tiingoCallRefusal(process.env, "supported-list");
  if (refusal) throw new TiingoRefused(refusal);
  const res = await fetch(SUPPORTED_TICKERS_URL, { cache: "no-store" });
  if (res.status !== 200) throw new TiingoHttpError(res.status, "supported tickers");
  const zip = Buffer.from(await res.arrayBuffer());
  return { rows: parseSupportedTickers(firstZipEntry(zip, inflateRaw).toString("utf8")), bytes: zip.length };
}
