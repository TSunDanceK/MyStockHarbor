import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Quote = {
  symbol: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  previous_close?: string;
  percent_change?: string;
  volume?: string;
  status?: string;
  message?: string;
};

type Row = {
  symbol: string;
  changePct: number | null;
  rangePct: number | null;
  last: number | null;
  volume: number | null;
};

const CACHE_MS = 60_000; // 1 minute
let cache: { at: number; payload: any } | null = null;

/**
 * ✅ Universe
 * Right now we’ll keep your “Curated Universe” approach:
 * - your dropdown tickers
 * - your pickers universe extras (keep it reasonable)
 *
 * You can expand later, but we must chunk requests anyway.
 */
const CURATED_UNIVERSE: string[] = [
  // Dashboard dropdown (your presets)
  "AAPL","ABBV","ABT","ADBE","AMZN","AVGO","BAC","BRK.B","COST","CRM","CSCO","CVX","DIS","GOOGL","HD",
  "INTC","JNJ","JPM","KO","LLY","MA","MCD","META","MRK","MSFT","NFLX","NVDA","ORCL","PEP","PG","PYPL",
  "QCOM","SBUX","T","TGT","TSLA","TXN","UNH","V","VZ","WFC","WMT","XOM",

  // Extras (example – keep these aligned with what you added)
  "AMD","GE","AMAT","CAT","LOW","IBM","NOW","PM","NKE","DHR","TXN","ABT","LIN","CVX","XOM",
].filter(Boolean);

/* ------------------------- small helpers ------------------------- */

function toNum(x: unknown): number | null {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : null;
}

function uniqUpper(arr: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of arr) {
    const u = String(s).trim().toUpperCase();
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * TwelveData returns batch quote in several shapes.
 * This parser tries hard to recover quote objects.
 */
function extractQuotesFromBatch(json: any): Quote[] {
  if (!json || typeof json !== "object") return [];

  // common error shapes
  // { status:"error", message:"..." }
  // { code: 4xx, message:"..." }
  if (json.status === "error") return [];
  if (typeof json.code === "number" && json.message) return [];

  // Sometimes: { data: [...] }
  if (Array.isArray(json.data)) return json.data as Quote[];

  // Sometimes already array
  if (Array.isArray(json)) return json as Quote[];

  // Most common batch: { "AAPL": {...}, "MSFT": {...} }
  const out: Quote[] = [];
  for (const [, v] of Object.entries(json)) {
    if (!v || typeof v !== "object") continue;
    const vv: any = v;

    // request wrapper { status:"ok", data:{...} }
    if (vv.status === "ok" && vv.data && typeof vv.data === "object") {
      if (typeof vv.data.symbol === "string") out.push(vv.data as Quote);
      continue;
    }

    // direct quote object
    if (typeof vv.symbol === "string") {
      if (vv.status === "error") continue;
      out.push(vv as Quote);
      continue;
    }
  }

  return out;
}

/* --------------------------- fetcher --------------------------- */

async function fetchQuoteBatch(symbols: string[], apiKey: string) {
  const list = symbols.join(",");
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(list)}&apikey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => null);

  return { ok: res.ok, status: res.status, json, url };
}

/* ----------------------------- GET ----------------------------- */

export async function GET() {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing TWELVEDATA_API_KEY env var." }, { status: 500 });
  }

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.payload);
  }

  const universe = uniqUpper(CURATED_UNIVERSE);

  /**
   * ✅ IMPORTANT:
   * TwelveData batch quote often breaks / errors once the symbol list gets large.
   * So we chunk and merge.
   *
   * You can tune BATCH_SIZE:
   * - 10–25 tends to be safe
   * - 50 can work for some accounts, but not always
   */
  const BATCH_SIZE = 20;
  const batches = chunk(universe, BATCH_SIZE);

  const allQuotes: Quote[] = [];
  const debug: any = {
    universeSize: universe.length,
    batchSize: BATCH_SIZE,
    batches: batches.length,
    gotQuotes: 0,
    errors: [] as any[],
  };

  for (let i = 0; i < batches.length; i++) {
    try {
      const r = await fetchQuoteBatch(batches[i], apiKey);
      const quotes = extractQuotesFromBatch(r.json);

      allQuotes.push(...quotes);
      debug.gotQuotes = allQuotes.length;

      // If batch returned 0 quotes, capture the error shape for diagnosis
      if (!quotes.length) {
        const msg =
          (r.json && (r.json.message || r.json.error)) ||
          (r.json && r.json.status === "error" ? "status:error" : null) ||
          null;

        debug.errors.push({
          batchIndex: i,
          httpOk: r.ok,
          httpStatus: r.status,
          message: msg,
          sampleKeys: r.json && typeof r.json === "object" ? Object.keys(r.json).slice(0, 8) : null,
        });
      }
    } catch (e: any) {
      debug.errors.push({
        batchIndex: i,
        httpOk: false,
        httpStatus: null,
        message: e?.message ? String(e.message) : "fetch failed",
        sampleKeys: null,
      });
    }
  }

  // Deduplicate by symbol (keep last occurrence)
  const bySym = new Map<string, Quote>();
  for (const q of allQuotes) {
    const s = (q.symbol ?? "").toUpperCase();
    if (!s) continue;
    bySym.set(s, q);
  }

  const quotes = Array.from(bySym.values());

  const rows: Row[] = quotes
    .map((q) => {
      const open = toNum(q.open);
      const high = toNum(q.high);
      const low = toNum(q.low);
      const close = toNum(q.close);
      const pct = toNum(q.percent_change);
      const vol = toNum(q.volume);

      let rangePct: number | null = null;
      const denom = open && open > 0 ? open : close && close > 0 ? close : null;
      if (denom && high != null && low != null) rangePct = ((high - low) / denom) * 100;

      return {
        symbol: String(q.symbol ?? "").toUpperCase(),
        changePct: pct,
        rangePct,
        last: close,
        volume: vol,
      };
    })
    .filter((r) => r.symbol && (r.last != null || r.changePct != null || r.rangePct != null || r.volume != null));

  const topTraded = [...rows]
    .filter((r) => r.volume != null)
    .sort((a, b) => (b.volume! - a.volume!))
    .slice(0, 10);

  const topMovers = [...rows]
    .filter((r) => r.changePct != null)
    .sort((a, b) => Math.abs(b.changePct!) - Math.abs(a.changePct!))
    .slice(0, 5);

  const topRanges = [...rows]
    .filter((r) => r.rangePct != null)
    .sort((a, b) => b.rangePct! - a.rangePct!)
    .slice(0, 10);

  const payload = {
    updatedAt: new Date().toISOString(),
    scope: "Curated Universe (Dashboard + Pickers + Extras)",
    universeSize: universe.length,
    quotesReturned: quotes.length,
    rowsBuilt: rows.length,

    topTraded,
    topMovers,
    topRanges,

    // ✅ Temporary: keep this so you can see what’s going wrong in Vercel
    // Once stable, we can remove it.
    debug,
  };

  cache = { at: Date.now(), payload };
  return NextResponse.json(payload);
}
