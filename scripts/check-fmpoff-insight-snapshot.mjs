// FMP-OFF, B2: INSIGHT SNAPSHOTS FROM STORED TIINGO BARS (#553 CODE-B #94).
//
// lib/insightSnapshots.ts persists each /insights/[slug] post's snapshot to
// Redis under insight-snapshot:<slug> with NO TTL, outside msh:tiingo:. Under
// the Tiingo licence (§7) raw Tiingo values -- prices, OHLC, volumes -- may only
// live under msh:tiingo: (all scripts/tiingo-purge.mjs deletes), so on the
// Tiingo path that key may hold derived figures only, and every priced figure
// on the page is read at render from the stored bars.
//
// What must hold, run against the REAL module with its imports stubbed (Redis,
// the Data Cache reader, FMP quote/history, symbol search):
//   1. PRICE_PROVIDER_CHARTS=tiingo: built from the stored bars, no FMP call;
//      the object written to Redis, deep-scanned, holds only
//      TIINGO_RECORD_FIELDS, no array, no raw bar value.
//   2. The page's price/levels/chart come from the bars at render, cut at the
//      record's as-of date, with pickSurfacePrice's label.
//   3. Nothing usable -> nothing written (no null-price snapshot, ever).
//   4. Off the flag: the FMP path, built and persisted as before.
//   5. FMP-era snapshots are served as stored.
//   6. The server page renders the label and the LINKED credit, Tiingo path only.
//   7. Mutants: each rule broken once, and caught.
//   8. The client prop carries only the point fields the post's indicators
//      read (rendered for real, full vs trimmed must match), and a Tiingo
//      snapshot (no snapshotTime) labels "Last price" with its priceLabel.
//      With mutants of its own.
//
//   node scripts/check-fmpoff-insight-snapshot.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);

// Registered last, so it runs first: the modules below resolve to stubs that
// answer from globalThis.__insStub (set per case).
const STUBS = {
  "/lib/server/historyCache.ts": "export const getDailyHistory = (...a) => globalThis.__insStub.getDailyHistory(...a);",
  "/lib/server/quoteData.ts": "export const fetchQuoteSnapshotForRender = (...a) => globalThis.__insStub.fetchQuote(...a);",
  "/lib/server/symbolSearch.ts": "export const searchSymbols = (...a) => globalThis.__insStub.searchSymbols(...a);",
  "/lib/server/marketData/read.ts":
    "export const readTiingoHistory = (...a) => globalThis.__insStub.readTiingoHistory(...a);\n" +
    "export const readTiingoPool = () => { globalThis.__insStub.calls.pool++; return Promise.resolve(null); };",
};
// THE PAGE WAS REBUILT (#563 COWORK #132/#133, CODE-C): it no longer sends the
// snapshot to a client component. It reads the snapshot's closes for the "Chart
// when published" thumbnail and credits Tiingo on the "Since" strip, so the
// page rules below pin that; the module's rules and contract are unchanged.
const HOOKS = `
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ts = createRequire(path.join(process.cwd(), "package.json"))("typescript");
const STUBS = ${JSON.stringify(STUBS)};
const LINK = 'import { jsx } from "react/jsx-runtime"; export default function Link({ href, children, prefetch, ...rest }) { return jsx("a", { href, ...rest, children }); }';
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@upstash/redis") return { url: "stub:upstash", shortCircuit: true };
  if (specifier === "next/link") return { url: "stub:next-link", shortCircuit: true };
  if (context.parentURL === "stub:next-link") return nextResolve(specifier, { ...context, parentURL: pathToFileURL(path.join(process.cwd(), "package.json")).href });
  const tsxBase = specifier.startsWith("@/") ? path.join(process.cwd(), specifier.slice(2))
    : specifier.startsWith(".") && context.parentURL?.startsWith("file:") ? path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier) : null;
  if (tsxBase && !fs.existsSync(tsxBase) && !fs.existsSync(tsxBase + ".ts") && fs.existsSync(tsxBase + ".tsx"))
    return { url: pathToFileURL(tsxBase + ".tsx").href, shortCircuit: true };
  const r = await nextResolve(specifier, context);
  for (const end of Object.keys(STUBS)) if (r.url.endsWith(end)) return { url: "stub:" + end, shortCircuit: true };
  return r;
}
export async function load(url, context, nextLoad) {
  if (url === "stub:upstash") return { format: "module", shortCircuit: true, source: "export class Redis { static fromEnv() { return globalThis.__insStub.redis; } }" };
  if (url === "stub:next-link") return { format: "module", shortCircuit: true, source: LINK };
  if (url.startsWith("stub:")) return { format: "module", shortCircuit: true, source: STUBS[url.slice(5)] };
  if (url.startsWith("file:") && url.split("?")[0].endsWith(".tsx")) {
    const src = fs.readFileSync(fileURLToPath(url.split("?")[0]), "utf8");
    const js = ts.transpileModule(src, { fileName: "x.tsx", compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText;
    return { format: "module", shortCircuit: true, source: js };
  }
  return nextLoad(url, context);
}`;
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);

const ROOT = process.cwd();
const MODULE = "lib/insightSnapshots.ts";
const PAGE = "app/insights/[slug]/page.tsx";
const VIEW = "app/insights/[slug]/InsightPage.tsx";
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── fixtures ──────────────────────────────────────────────────────────────
/** n weekday bars ending on `end`, a slow uptrend with a wobble; values distinct. */
function makeBars(n, end = "2026-09-29") {
  const out = [];
  const d = new Date(`${end}T00:00:00Z`);
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse().map((date, i) => {
    const c = Number((100 + i * 0.05 + Math.sin(i / 7) * 3).toFixed(4));
    return [date, c - 0.37, c + 1.13, c - 1.29, c, 1_000_003 + i * 17];
  });
}
const BARS = makeBars(1100);
const LAST = BARS[BARS.length - 1];
const LATER = [...BARS, ...makeBars(3, "2026-10-02").filter((b) => b[0] > LAST[0]).map((b) => [b[0], 501, 502, 499, 500.5, 9_999_999])];
const FMP_HISTORY = BARS.map(([date, , high, low, close, volume]) => ({ date, close, high, low, volume }));
const FMP_QUOTE = { symbol: "ACME", price: 123.45, date: "2026-09-29", time: "15:59" };

function sma(values, n) {
  const s = values.slice(-n);
  return s.length === n ? s.reduce((a, b) => a + b, 0) / n : null;
}

/** A fresh stub world. `store` is the fake Redis; every call is counted. */
function world({ store = {}, bars = BARS, quote = FMP_QUOTE, history = FMP_HISTORY, env = {} } = {}) {
  const w = {
    store: { ...store },
    writes: [],
    calls: { fmpQuote: 0, fmpHistory: 0, tiingo: 0, pool: 0, search: 0 },
  };
  w.redis = {
    get: async (k) => (k in w.store ? structuredClone(w.store[k]) : null),
    set: async (k, v) => { w.writes.push([k, structuredClone(v)]); w.store[k] = structuredClone(v); return "OK"; },
  };
  globalThis.__insStub = {
    redis: w.redis,
    calls: w.calls,
    readTiingoHistory: async () => { w.calls.tiingo++; return bars ? { asOf: bars.at(-1)?.[0], fetchedAt: 0, basis: "split", bars } : null; },
    fetchQuote: async () => { w.calls.fmpQuote++; return quote; },
    getDailyHistory: async () => { w.calls.fmpHistory++; if (!history) throw new Error("Missing FMP_API_KEY"); return history; },
    searchSymbols: async () => { w.calls.search++; return [{ symbol: "ACME", name: "Acme Corp", exchange: "NASDAQ" }]; },
  };
  for (const k of ["PRICE_PROVIDER_CHARTS", "FMP_API_KEY"]) delete process.env[k];
  process.env.UPSTASH_REDIS_REST_URL = "stub";
  process.env.UPSTASH_REDIS_REST_TOKEN = "stub";
  Object.assign(process.env, env);
  return w;
}

const RAW_VALUES = new Set(BARS.flatMap((b) => b.slice(1)));
/** Every path in a value: [path, leaf]. */
function leaves(v, p = "$", out = []) {
  if (Array.isArray(v)) { out.push([p, "<array>"]); v.forEach((x, i) => leaves(x, `${p}[${i}]`, out)); }
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) leaves(x, `${p}.${k}`, out);
  else out.push([p, v]);
  return out;
}
const PRICED_KEY = /price|open|high|low|close|volume|bars?\b|chartPoints|lastMA|level/i;

const TIINGO = { PRICE_PROVIDER_CHARTS: "tiingo" };

/** The behavioural rules over a loaded module. Returns failure labels. */
async function behaviour(M) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const run = async (w, slug = "acme-sep-29-2026") => {
    try { return await M.getOrCreateInsightSnapshot({ slug, symbol: "acme" }); } catch (e) { return { __threw: String(e) }; }
  };

  // 1. flag on, a new post: built from stored bars, derived fields only persisted
  let w = world({ env: TIINGO });
  let s = await run(w);
  want("tiingo: no FMP call on the Tiingo path", w.calls.fmpQuote === 0 && w.calls.fmpHistory === 0);
  want("tiingo: the stored bars were read (Data Cache)", w.calls.tiingo >= 1);
  want("tiingo: exactly one write", w.writes.length === 1);
  const written = w.writes[0]?.[1];
  const allowed = new Set(M.TIINGO_RECORD_FIELDS ?? []);
  want("tiingo: the written record's keys are all in TIINGO_RECORD_FIELDS",
    written && typeof written === "object" && Object.keys(written).every((k) => allowed.has(k)));
  const L = leaves(written ?? {});
  want("tiingo: deep scan finds no array (no bars, no chart points)", !L.some(([, v]) => v === "<array>"));
  want("tiingo: deep scan finds no priced key", !L.some(([p]) => PRICED_KEY.test(p.split(".").pop())));
  want("tiingo: deep scan finds no raw bar value", !L.some(([, v]) => typeof v === "number" && RAW_VALUES.has(v)));
  want("tiingo: TIINGO_RECORD_FIELDS itself names nothing priced", [...allowed].every((k) => !PRICED_KEY.test(k)));
  want("tiingo: the record is derived from the bars (as-of date, trend, %)",
    written?.source === "tiingo" && written?.snapshotDate === LAST[0] && typeof written?.trend === "string" &&
      typeof written?.ma200Pct === "number" && written?.companyName === "Acme Corp");
  const closes = BARS.map((b) => b[4]);
  const ma200 = sma(closes, 200);
  want("tiingo: % distance matches an independent MA200",
    Math.abs(written?.ma200Pct - ((LAST[4] - ma200) / ma200) * 100) < 1e-3);
  // what the page receives on that same render
  want("render: price is the last stored close, read now", s?.price === LAST[4]);
  want("render: labelled by pickSurfacePrice", s?.priceLabel === "close, 29 Sep 2026" && s?.source === "tiingo");
  want("render: chart points from the bars (frozen at the as-of date)",
    Array.isArray(s?.chartPoints) && s.chartPoints.length === Math.min(BARS.length, 2000) && s.chartPoints.at(-1)?.date === LAST[0] &&
      s.chartPoints.at(-1)?.volume === LAST[5]);
  want("render: MA200 level recovered from the close and the owned %", Math.abs((s?.lastMA200 ?? NaN) - ma200) < 1e-2);

  // 2. a later render: the record is read, priced fields re-read, cut at the as-of date
  const store = w.store;
  w = world({ store, bars: LATER, env: TIINGO });
  s = await run(w);
  want("later render: nothing written", w.writes.length === 0);
  want("later render: no FMP call", w.calls.fmpQuote === 0 && w.calls.fmpHistory === 0);
  want("later render: newer bars ignored -- the chart stays the post's setup",
    s?.price === LAST[4] && s?.chartPoints?.at(-1)?.date === LAST[0] && s?.priceLabel === "close, 29 Sep 2026");
  // the record keeps rendering from Tiingo bars even if the flag is later flipped off
  w = world({ store, bars: BARS, env: {} });
  s = await run(w);
  want("flag flipped back: a Tiingo record still hydrates from stored bars, no write", s?.source === "tiingo" && w.writes.length === 0);
  // bars gone (purged / left the universe): the block is omitted
  w = world({ store, bars: null, env: TIINGO });
  s = await run(w);
  want("bars gone: no snapshot, nothing written", s === null && w.writes.length === 0);

  // 3. nothing usable -> nothing written
  w = world({ bars: null, env: TIINGO, history: null, quote: { price: null } });
  s = await run(w);
  want("tiingo miss, no FMP key: null, nothing written, no FMP call",
    s === null && w.writes.length === 0 && w.calls.fmpQuote === 0 && w.calls.fmpHistory === 0);
  w = world({ bars: [LAST], env: TIINGO });
  s = await run(w);
  want("tiingo: a single bar is not a snapshot, nothing written", s === null && w.writes.length === 0);
  w = world({ bars: null, env: { ...TIINGO, FMP_API_KEY: "x" } });
  s = await run(w);
  want("tiingo miss, FMP key still set: the FMP fallback, persisted with its price",
    w.calls.fmpQuote === 1 && w.writes.length === 1 && w.writes[0][1].price === FMP_QUOTE.price && s?.source === undefined);
  w = world({ env: { FMP_API_KEY: "x" }, quote: { price: null, date: null, time: null } });
  s = await run(w);
  want("fmp: a null-price snapshot is shown once but never written", w.writes.length === 0 && s && s.price === null);

  // 4. off the flag: the FMP path, unchanged
  w = world({ env: { FMP_API_KEY: "x" } });
  s = await run(w);
  const fw = w.writes[0]?.[1];
  want("fmp: no Tiingo read off the flag", w.calls.tiingo === 0);
  want("fmp: quote + history + search, one write", w.calls.fmpQuote === 1 && w.calls.fmpHistory === 1 && w.writes.length === 1);
  want("fmp: the stored snapshot is the FMP shape as before",
    fw?.price === FMP_QUOTE.price && fw?.snapshotDate === "2026-09-29" && fw?.snapshotTime === "15:59" &&
      fw?.chartPoints?.length === Math.min(FMP_HISTORY.length, 2000) && Math.abs(fw?.lastMA200 - Number(ma200.toFixed(4))) < 1e-9 &&
      fw?.source === undefined && fw?.priceLabel === undefined && w.writes[0][0] === "insight-snapshot:acme-sep-29-2026");
  w = world({ env: {}, history: null });
  s = await run(w);
  want("fmp, no key: the history error still propagates (page catches), nothing written", s?.__threw && w.writes.length === 0);

  // 5. FMP-era snapshot on the flag: served as stored
  w = world({ store: { "insight-snapshot:acme-sep-29-2026": { ...fw } }, env: TIINGO });
  s = await run(w);
  want("fmp-era: served as stored, no Tiingo read, no write",
    s?.price === FMP_QUOTE.price && s?.chartPoints?.length === fw?.chartPoints?.length && w.calls.tiingo === 0 && w.writes.length === 0);

  return fails;
}

/** The static rules over the page and module sources. Returns failure labels. */
function statics(pageSrc, modSrc, viewSrc = VIEW_SRC) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const page = stripComments(pageSrc, { file: PAGE });
  const mod = stripComments(modSrc, { file: MODULE });
  const view = stripComments(viewSrc, { file: VIEW });
  want("page: the snapshot reaches the page as closes only (the thumbnail), never whole",
    /snapshot\?\.chartPoints\?\.length \? snapshot\.chartPoints\.slice\(-120\)\.map\(\(p\) => p\.close\) : null/.test(page) && !/snapshot=\{|\.\.\.snapshot/.test(page));
  want("page: the Tiingo credit is linked to TIINGO_URL", /<a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a>/.test(view));
  want("module: gated on the CHARTS surface", /priceProviderFor\("CHARTS", deps\.env\) === "tiingo"/.test(mod));
  want("module: bars come from the Data Cache reader", /readBars: async \(s\) => \(await readTiingoHistory\(s\)\)\?\.bars/.test(mod));
  want("module: no Tiingo adapter import", !/marketData\/tiingo["']/.test(mod));
  want("module: the FMP builder keeps its FMP reads", /fetchQuoteSnapshotForRender\(symbol\) as Promise<Quote>/.test(mod) &&
    /getDailyHistory\(symbol, \{ caller: "insight-snapshot" \}\)/.test(mod));
  return fails;
}

// ── run on the real sources ──────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ins-snap-"));
let n = 0;
async function load(src) {
  const f = path.join(TMP, `insightSnapshots-${n++}.ts`);
  fs.writeFileSync(f, src);
  return import(pathToFileURL(f).href);
}

const MOD_SRC = raw(MODULE);
const PAGE_SRC = raw(PAGE);
const VIEW_SRC = raw(VIEW);

console.log("\n=== 1-5. The module, behaviour (real code, stubbed I/O) ===\n");
const real = await behaviour(await load(MOD_SRC));
check("every behavioural rule holds", real.length === 0, real.join("; "));

console.log("\n=== 6. Sources ===\n");
const st = statics(PAGE_SRC, MOD_SRC);
check("every static rule holds", st.length === 0, st.join("; "));

console.log("\n=== 7. Mutants: each must be caught ===\n");
const MOD_MUTANTS = [
  ["persist the hydrated (priced) snapshot", "toWrite = record;", "toWrite = hydrateTiingoSnapshot(record, bars, deps.nowMs);"],
  ["a raw close in the record", 'source: "tiingo",\n    symbol,', 'source: "tiingo",\n    symbol,\n    lastClose: points[points.length - 1].close,'],
  ["the bars in the record", 'source: "tiingo",\n    symbol,', 'source: "tiingo",\n    symbol,\n    bars: [...(bars ?? [])],'],
  ["no FMP-key guard on a Tiingo miss", "} else if (!deps.env.FMP_API_KEY) {", "} else if (false) {"],
  ["persist a null-price FMP snapshot", "if (hasUsablePrice(snapshot)) toWrite = snapshot;", "toWrite = snapshot;"],
  ["gate ignores the flag", 'priceProviderFor("CHARTS", deps.env) === "tiingo"', 'priceProviderFor("CHARTS", deps.env) !== "never"'],
  ["hydrate not cut at the as-of date", '.filter((b) => String(b?.[0] ?? "") <= record.snapshotDate)', ".filter(() => true)"],
  ["a single bar accepted", "if (points.length < 2) return null;\n  const d = deriveFromPoints(points);", "if (points.length < 1) return null;\n  const d = deriveFromPoints(points);"],
  ["price label dropped", "priceLabel: surface.label,", ""],
  ["Tiingo record served as FMP-era (not re-read)", "if (isTiingoRecord(raw)) {", "if (false) {"],
];
for (const [name, from, to] of MOD_MUTANTS) {
  if (!MOD_SRC.includes(from)) { check(`mutant "${name}" applies`, false, "anchor not found"); continue; }
  const fails = await behaviour(await load(MOD_SRC.replace(from, to)));
  check(`mutant caught: ${name}`, fails.length > 0, fails.slice(0, 2).join("; "));
}
const PAGE_MUTANTS = [
  ["view", "credit unlinked", '<a href={TIINGO_URL} target="_blank" rel="noopener noreferrer">{TIINGO_CREDIT}</a>', "{TIINGO_CREDIT}"],
  ["page", "the snapshot sent whole", "snapshot?.chartPoints?.length ? snapshot.chartPoints.slice(-120).map((p) => p.close) : null", "snapshot?.chartPoints?.length ? { ...snapshot } : null"],
];
for (const [where, name, from, to] of PAGE_MUTANTS) {
  const src = where === "view" ? VIEW_SRC : PAGE_SRC;
  if (!src.includes(from)) { check(`mutant "${name}" applies`, false, "anchor not found"); continue; }
  const fails = where === "view" ? statics(PAGE_SRC, MOD_SRC, src.replace(from, to)) : statics(src.replace(from, to), MOD_SRC);
  check(`mutant caught: ${name}`, fails.length > 0, fails.join("; "));
}
const STATIC_MOD_MUTANTS = [
  ["bars from somewhere other than the Data Cache", "readBars: async (s) => (await readTiingoHistory(s))?.bars ?? null,", "readBars: async () => null,"],
  ["FMP builder off FMP", 'getDailyHistory(symbol, { caller: "insight-snapshot" }),', "Promise.resolve([]),"],
];
for (const [name, from, to] of STATIC_MOD_MUTANTS) {
  if (!MOD_SRC.includes(from)) { check(`mutant "${name}" applies`, false, "anchor not found"); continue; }
  const fails = statics(PAGE_SRC, MOD_SRC.replace(from, to));
  check(`mutant caught: ${name}`, fails.length > 0, fails.join("; "));
}

// ── 8. What a client is sent (#553 COWORK #103): the module's trim ─────────
//   trimChartPointsForClient keeps only the fields an indicator reads: date +
//   close, plus high/low for Stochastic/ATR, plus volume for VWMA/Volume. The
//   rebuilt page (#563 COWORK #132) sends no snapshot to a client at all; the
//   trim stays the module's contract for any caller that does.
console.log("\n=== 8. The module's trim ===\n");
const INDICATOR_SETS = [[], ["MA50", "MA200"], ["MA200"], ["EMA20"], ["Bollinger(20,2)"], ["RSI(14)"], ["MACD(12,26,9)"],
  ["Stochastic(14,3)"], ["ATR(14)"], ["VWMA(20)"], ["Volume"], ["MA200", "Volume"], ["VWMA(20)", "ATR(14)"]];
const fieldsFor = (inds) => ["date", "close",
  ...(inds.some((i) => i === "Stochastic(14,3)" || i === "ATR(14)") ? ["high", "low"] : []),
  ...(inds.some((i) => i === "VWMA(20)" || i === "Volume") ? ["volume"] : [])].sort().join(",");
function trimRules(M) {
  const fails = [];
  const tiingo = M.hydrateTiingoSnapshot(M.buildTiingoRecord("ACME", BARS, "Acme Corp"), BARS, Date.UTC(2026, 9, 3));
  if (!tiingo) return ["fixture: the Tiingo snapshot hydrates"];
  for (const inds of INDICATOR_SETS) {
    const trimmed = M.trimChartPointsForClient(tiingo.chartPoints, inds);
    if (!(trimmed.length === tiingo.chartPoints.length && trimmed.every((p) => Object.keys(p).sort().join(",") === fieldsFor(inds)))) fails.push(`tiingo ${inds.join("+") || "default"}: only ${fieldsFor(inds)}`);
  }
  return fails;
}
const realMod = await load(MOD_SRC);
const tr = trimRules(realMod);
check("every trim rule holds", tr.length === 0, tr.slice(0, 4).join("; "));
const TRIM_MUTANTS = [
  ["every field sent", "const out: InsightSnapshotPoint = { date: p.date, close: p.close };", "const out: InsightSnapshotPoint = { ...p };"],
  ["the Volume panel loses volume", 'new Set(["VWMA(20)", "Volume"])', 'new Set(["VWMA(20)"])'],
  ["ATR loses high/low", 'new Set(["Stochastic(14,3)", "ATR(14)"])', 'new Set(["Stochastic(14,3)"])'],
];
for (const [name, from, to] of TRIM_MUTANTS) {
  if (!MOD_SRC.includes(from)) { check(`mutant "${name}" applies`, false, "anchor not found"); continue; }
  check(`mutant caught: ${name}`, trimRules(await load(MOD_SRC.replace(from, to))).length > 0);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
