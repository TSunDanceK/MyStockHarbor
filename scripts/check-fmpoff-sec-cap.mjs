// FMP-off B7/B8 (#553 CODE-B #94, #683 open question 1): market cap from SEC
// cover-page shares x the Tiingo price, on the pool overlay and in the sector
// ranking.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE FROZEN FIGURE: a Tiingo pool row carrying the FMP row's market cap or
//      P/E -- a number that stopped moving when FMP ended, printed unlabelled
//      next to a live Tiingo price (the earnings calendar's Market Cap column,
//      the sector weights, the fundamentals warm).
//   2. A REFUSAL THAT FALLS BACK: A's marketCap()/peRatio() refuse an ADS
//      filer's shares, a multi-class count, a stale EPS... and the row quietly
//      shows FMP's figure instead of null ("—").
//   3. THE WRONG ORDER: the sector index ranking on caps that are all 0 (input
//      order) once the FMP caches expire, or MIXING two bases in one sort (a
//      SEC x Tiingo cap beside a frozen FMP one).
//   4. A NEW PER-VIEW REDIS READ: the overlay is read for hundreds of symbols
//      per render; the SEC inputs must come from ONE Data Cache blob, not an
//      HMGET per page or a GET per symbol.
//   5. A TIINGO FIGURE PERSISTED UNDER AN FMP NAME (#553 COWORK #103, #690 Q2):
//      a SEC x Tiingo cap or P/E stored outside msh:tiingo: (the fundamentals
//      rows, the sector index, the performance table) carries the Tiingo close
//      (cap / shares) past the §7 purge. Readers compute them at read time.
//
// Behaviour sections run the real modules, then mutated copies (each must
// fail); the wiring section reads source and plants a mutant per rule.
//
//   node scripts/check-fmpoff-sec-cap.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);

const ROOT = process.cwd();
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const REDIS = "https://fake-redis.test";
process.env.UPSTASH_REDIS_REST_URL = REDIS;
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
delete process.env.VERCEL_ENV;
delete process.env.FMP_API_KEY;

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const FILES = {
  pool: "lib/server/tiingoPool.ts",
  pickersSec: "lib/server/pickersSecFundamentals.ts",
  rank: "lib/server/sectorCapRank.ts",
  universe: "lib/server/sectorUniverse.ts",
  panels: "lib/server/sectorPanels.ts",
};

let seq = 0;
async function loadMutant(rel, src) {
  const tmp = path.join(ROOT, path.dirname(rel), `.check-secCap-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(tmp, src);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
const real = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
async function mutants(label, rel, list, behaviour) {
  const src = raw(rel);
  for (const [name, from, to] of list) {
    const m = src.replace(from, to);
    if (m === src) { check(`${label} mutant "${name}" applies`, false, "the replacement matched nothing"); continue; }
    const fails = await behaviour(await loadMutant(rel, m));
    check(`${label} mutant "${name}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────────
const NOW = Date.now();
const THU_1405 = Date.UTC(2026, 9, 1, 18, 5);
const LAST = { d: "2026-09-30", o: 99, h: 101, l: 97, c: 100, v: 3000, pc: 98, w: 1, m: 2, y: 3, a50: true, a200: false };
const IEX = { price: 103, open: 101, high: 104, low: 99, prevClose: 100.5, at: THU_1405 };
const FMP = { price: 90, changePct: 9, volume: 1, marketCap: 5e9, open: 1, dayHigh: 1, dayLow: 1, pe: 22, ts: 1, peTs: 7, failStreak: 2, failAt: 3 };
const USD = { reporting: "USD", converted: false };
const EPS = { val: 5, basis: "four-quarters", periodEnd: "2026-06-30" };
const M0 = { revenue: null, revenueIncomplete: false, ebitda: null, balanceSheet: null };
const fullRow = (over = {}) => ({
  v: 1, unit: USD, at: NOW, inputs: { shares: { val: 2e9, asOf: "2026-07-20" }, refusals: [] }, m: M0,
  operatingIncome: null, netIncome: null, freeCashFlow: null, divPerShare: null, divGrowth: null, eps: EPS, payout: null, ...over,
});
const cap = (r) => ({ v: r.v, unit: r.unit, at: r.at, inputs: r.inputs, ...("eps" in r ? { eps: r.eps } : {}) });
const SEC = cap(fullRow());
// An ADS filer: a clean-looking share count AND an EPS, both refused by A's rules.
const ADS = cap(fullRow({ inputs: { shares: { val: 5e9, asOf: "2026-07-20" }, refusals: ["ads-ratio-makes-shares-incomparable", "ads-ratio-makes-eps-incomparable"] } }));
const NO_COVER = cap(fullRow({ inputs: { shares: null, refusals: ["no-cover-share-count"] }, eps: null }));
const PRE_PE = (() => { const r = fullRow(); delete r.eps; return cap(r); })();
const NON_USD = cap(fullRow({ unit: { reporting: "COP", converted: false }, eps: null }));
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));

// ── 1. secCapAndPe: A's marketCap()/peRatio() with refusals -> null ─────────
console.log("\n=== 1. pickersSecFundamentals.secCapAndPe: SEC shares x price, refusal -> null ===\n");
function secBehaviour(S) {
  const fails = [];
  const want = (l, ok) => { if (!ok) fails.push(l); };
  const a = S.secCapAndPe(SEC, 103);
  want("cap = cover shares x the price given (2e9 x 103)", near(a.marketCap, 206e9));
  want("P/E = price / twelve-month diluted EPS (103 / 5)", near(a.pe, 20.6));
  const ads = S.secCapAndPe(ADS, 103);
  want("an ADS filer's cap and P/E are refused (null), not computed from its share count", ads.marketCap === null && ads.pe === null);
  const nc = S.secCapAndPe(NO_COVER, 103);
  want("no cover-page share count: null cap", nc.marketCap === null && nc.pe === null);
  const pre = S.secCapAndPe(PRE_PE, 103);
  want("a row written before P/E moved: cap computed, P/E null", near(pre.marketCap, 206e9) && pre.pe === null);
  const fx = S.secCapAndPe(NON_USD, 103);
  want("a non-USD unconverted filer: cap (price x shares) kept, no P/E", near(fx.marketCap, 206e9) && fx.pe === null);
  want("no SEC row: both null", S.secCapAndPe(null, 103).marketCap === null && S.secCapAndPe(undefined, 103).pe === null);
  want("no price: no cap", S.secCapAndPe(SEC, null).marketCap === null);

  const hash = {
    AAPL: JSON.stringify(fullRow()),
    OLD: JSON.stringify(fullRow({ at: NOW - 4 * 86_400_000 })),
    JUNK: "{not json",
    NOUNIT: JSON.stringify({ ...fullRow(), unit: undefined }),
    PRE: (() => { const r = fullRow(); delete r.eps; return r; })(),
  };
  const parsed = S.parseSecCapHash(hash, NOW);
  want("the hash is projected: AAPL kept without its money fields", parsed.AAPL && !("m" in parsed.AAPL) && !("operatingIncome" in parsed.AAPL) && parsed.AAPL.inputs.shares.val === 2e9);
  want("a stale, junk or unit-less row is dropped", !parsed.OLD && !parsed.JUNK && !parsed.NOUNIT);
  want("a row without an eps key stays without one (P/E null, not refused-as-stored)", parsed.PRE && !("eps" in parsed.PRE));
  return fails;
}
const S = await real(FILES.pickersSec);
const sFails = secBehaviour(S);
for (const f of sFails) check(f, false);
check("SEC cap/P/E inputs computed through A's functions, refusals null", sFails.length === 0);
await mutants("secCapAndPe", FILES.pickersSec, [
  ["the cap bypasses A's refusals", /marketCap: ok\(marketCap\(inputs, price\)\),/, "marketCap: row.inputs.shares && price ? row.inputs.shares.val * price : null,"],
  ["the P/E ignores refusals", /pe: applySecEarnings\(row, price\)\?\.peRatio \?\? null,/, "pe: row.eps && price ? price / row.eps.val : null,"],
  ["stale rows kept", /if \(isRow\(v\) && v\.at >= staleBefore\) out\[field\] = toSecCapRow\(v\);/, "if (isRow(v)) out[field] = toSecCapRow(v);"],
], secBehaviour);

// ── 2. The overlay row: cap from SEC x THIS row's Tiingo price, never FMP ──
console.log("\n=== 2. tiingoPool: the overlay's marketCap/pe ===\n");
function poolBehaviour(P) {
  const fails = [];
  const want = (l, ok) => { if (!ok) fails.push(l); };
  const r = P.mapTiingoPoolRow(FMP, IEX, LAST, THU_1405, SEC);
  want("in session: cap = SEC shares x the IEX price (2e9 x 103), P/E = 103/5", r?.price === 103 && near(r.marketCap, 206e9) && near(r.pe, 20.6));
  const close = P.mapTiingoPoolRow(FMP, { ...IEX, at: Date.UTC(2026, 8, 29, 17, 0) }, LAST, THU_1405, SEC);
  want("on the close: cap = shares x the close (2e9 x 100)", close?.price === 100 && near(close.marketCap, 200e9));
  const ads = P.mapTiingoPoolRow(FMP, IEX, LAST, THU_1405, ADS);
  want("a refusal is null, NOT the FMP row's 5e9 / 22", ads?.marketCap === null && ads.pe === null);
  const none = P.mapTiingoPoolRow(FMP, IEX, LAST, THU_1405, null);
  want("no SEC row: null, NOT the FMP row's figure", none?.marketCap === null && none.pe === null);
  const pre = P.mapTiingoPoolRow(FMP, IEX, LAST, THU_1405, PRE_PE);
  want("a pre-P/E SEC row: cap computed, P/E null (not FMP's 22)", near(pre?.marketCap, 206e9) && pre.pe === null);
  want("FMP's cap never appears on any Tiingo row", ![r, close, ads, none, pre].some((x) => x?.marketCap === FMP.marketCap || x?.pe === FMP.pe));
  want("the FMP row's bookkeeping is still carried", r?.peTs === 7 && r.failStreak === 2 && r.failAt === 3);

  const fmpRows = new Map([["BRK-B", FMP], ["BRK.B", FMP], ["XYZ", FMP]]);
  const out = P.overlayRows(fmpRows, ["BRK.B", "XYZ", "TSM"], { "BRK-B": IEX, TSM: IEX }, { "BRK-B": LAST }, THU_1405, { "BRK.B": SEC, TSM: ADS });
  want("the SEC row is found under the dotted spelling for the dashed pool field", near(out.get("BRK-B")?.marketCap, 206e9) && out.get("BRK.B") === out.get("BRK-B"));
  want("a refused symbol on the overlay is null", out.get("TSM")?.source === "tiingo" && out.get("TSM").marketCap === null);

  const caps = P.secTiingoCaps(["BRK.B", "NOPRICE", "TSM", "NOSEC"], { "BRK-B": IEX, TSM: IEX, NOSEC: IEX }, null, { "BRK.B": SEC, NOPRICE: SEC, TSM: ADS }, THU_1405);
  want("secTiingoCaps: SEC x Tiingo for a priced symbol", near(caps.get("BRK.B"), 206e9));
  want("secTiingoCaps: no Tiingo price, no cap (a SEC row alone is not enough)", caps.get("NOPRICE") === null);
  want("secTiingoCaps: refused or no SEC row -> null", caps.get("TSM") === null && caps.get("NOSEC") === null);
  return fails;
}
const P = await real(FILES.pool);
const pFails = poolBehaviour(P);
for (const f of pFails) check(f, false);
check("overlay cap = SEC shares x the row's Tiingo price; refusal -> null; FMP never carried", pFails.length === 0);
await mutants("tiingoPool", FILES.pool, [
  ["the FMP cap carried (step 5's rule)", /marketCap: valuation\.marketCap,/, "marketCap: fmp?.marketCap ?? null,"],
  ["a refusal falls back to FMP", /marketCap: valuation\.marketCap,/, "marketCap: valuation.marketCap ?? fmp?.marketCap ?? null,"],
  ["the P/E falls back to FMP", /pe: valuation\.pe,/, "pe: valuation.pe ?? fmp?.pe ?? null,"],
  ["the cap priced on the FMP price", /const valuation = secCapAndPe\(sec, surface\.price\);/, "const valuation = secCapAndPe(sec, fmp?.price ?? surface.price);"],
  ["the dotted spelling not looked up", /return rows\[asked\] \?\? rows\[field\] \?\? rows\[toDotted\(field\)\] \?\? null;/, "return rows[field] ?? null;"],
], poolBehaviour);

// ── 3. The sector ranking: one basis, SEC x Tiingo on the gate ─────────────
console.log("\n=== 3. sectorCapRank: one basis per ranking ===\n");
function rankBehaviour(R) {
  const fails = [];
  const want = (l, ok) => { if (!ok) fails.push(l); };
  const b = (poolOnTiingo, secTiingoCaps, fmpKeySet, fmpCaps) => R.chooseCapBasis({ poolOnTiingo, secTiingoCaps, fmpKeySet, fmpCaps });
  want("POOL on Tiingo with SEC caps: sec-tiingo, even while FMP still has data", b(true, 3, true, 5) === "sec-tiingo");
  want("POOL on Tiingo, no SEC caps, key set and FMP data: fmp", b(true, 0, true, 5) === "fmp");
  want("FMP data but the key unset: none (a cache nobody refills is not a basis)", b(true, 0, false, 5) === "none" && b(false, 0, false, 5) === "none");
  want("POOL on FMP: fmp, never the SEC/Tiingo caps", b(false, 7, true, 5) === "fmp");
  want("POOL on FMP with no FMP data: none", b(false, 7, true, 0) === "none");

  const syms = ["A", "B", "C", "D"];
  const sec = new Map([["A", 1e9], ["B", null], ["C", 3e9], ["D", 2e9]]);
  const fmp = new Map([["A", 5e12], ["B", 9e12], ["C", null], ["D", 1e9]]);
  const onSec = R.capsOnBasis("sec-tiingo", syms, sec, fmp);
  want("on sec-tiingo a symbol with no SEC cap is 0, never its FMP cap (no mixing)", onSec.get("B") === 0 && onSec.get("A") === 1e9);
  want("ranked largest first on SEC x Tiingo: C, D, A, B", R.rankByCap(syms, onSec, 10).join() === "C,D,A,B");
  const onFmp = R.capsOnBasis("fmp", syms, sec, fmp);
  want("on fmp every cap is FMP's (C has none: 0)", onFmp.get("C") === 0 && onFmp.get("B") === 9e12 && R.rankByCap(syms, onFmp, 2).join() === "B,A");
  want("none: input order, all caps 0", R.rankByCap(syms, R.capsOnBasis("none", syms, sec, fmp), 10).join() === "A,B,C,D");
  want("countCaps counts usable caps only", R.countCaps(sec) === 3 && R.countCaps(new Map([["x", 0], ["y", NaN]])) === 0);
  return fails;
}
const R = await real(FILES.rank);
const rFails = rankBehaviour(R);
for (const f of rFails) check(f, false);
check("one cap basis per ranking, chosen by gate, data and key", rFails.length === 0);
await mutants("sectorCapRank", FILES.rank, [
  ["per-symbol fallback to FMP (mixed basis)", /const v = source\?\.get\(s\);/, "const v = source?.get(s) ?? fmp.get(s);"],
  ["FMP used without the key", /if \(o\.fmpKeySet && o\.fmpCaps > 0\) return "fmp";/, 'if (o.fmpCaps > 0) return "fmp";'],
  ["SEC caps used off the POOL gate", /if \(o\.poolOnTiingo && o\.secTiingoCaps > 0\) return "sec-tiingo";/, 'if (o.secTiingoCaps > 0) return "sec-tiingo";'],
  ["FMP preferred over SEC on the gate", /if \(o\.poolOnTiingo && o\.secTiingoCaps > 0\) return "sec-tiingo";\n\s*if \(o\.fmpKeySet && o\.fmpCaps > 0\) return "fmp";/, 'if (o.fmpKeySet && o.fmpCaps > 0) return "fmp";\n  if (o.poolOnTiingo && o.secTiingoCaps > 0) return "sec-tiingo";'],
], rankBehaviour);

// ── 4. Sector weights: SEC x Tiingo only, null handled ─────────────────────
console.log("\n=== 4. sectorPanels: cap weights ===\n");
function weightBehaviour(W) {
  const fails = [];
  const want = (l, ok) => { if (!ok) fails.push(l); };
  const mixed = W.weightedAverage([{ value: 10, weight: 3 }, { value: 0, weight: 1 }, { value: 100, weight: null }]);
  want("a constituent without a cap is counted but not weighed: (10x3 + 0x1)/4", near(mixed.value, 7.5) && mixed.count === 3);
  const none = W.weightedAverage([{ value: 2, weight: null }, { value: 4, weight: null }, { value: null, weight: 9 }]);
  want("no cap anywhere: equal weight", near(none.value, 3) && none.count === 2);
  want("nothing valued: null", W.weightedAverage([{ value: null, weight: 1 }]).value === null);
  want("on the gate a FMP-fallback row's cap is not a weight", W.poolCapWeight({ marketCap: 5e9 }, true) === null && W.poolCapWeight({ marketCap: 5e9, source: "tiingo" }, true) === 5e9);
  want("off the gate the FMP row's cap is the weight", W.poolCapWeight({ marketCap: 5e9 }, false) === 5e9 && W.poolCapWeight({ marketCap: null, source: "tiingo" }, true) === null);
  return fails;
}
const W = await real(FILES.panels);
const wFails = weightBehaviour(W);
for (const f of wFails) check(f, false);
check("sector weights: one basis; null cap -> unweighted, all null -> equal", wFails.length === 0);
await mutants("sectorPanels", FILES.panels, [
  ["a null cap weighs 1 (the old rule)", /const capped = valued\.filter\(\(e\) => typeof e\.weight === "number" && Number\.isFinite\(e\.weight\) && e\.weight > 0\);/, "const capped = valued.map((e) => ({ value: e.value, weight: e.weight && e.weight > 0 ? e.weight : 1 }));"],
  ["FMP-fallback caps weighed on the gate", /if \(onTiingo && row\.source !== "tiingo"\) return null;/, ""],
], weightBehaviour);

// ── 5. Wiring, and no new per-view Redis read ──────────────────────────────
console.log("\n=== 5. Wiring and Redis cost ===\n");
function fnBody(src, name) {
  const i = src.search(new RegExp(`(export )?(async )?function ${name}\\b`));
  if (i < 0) return "";
  const rest = src.slice(i + 1);
  const j = rest.search(/\n(export |async function |function |const [A-Za-z_]+ = )/);
  return j < 0 ? src.slice(i) : src.slice(i, i + 1 + j);
}
function wiringRules(srcs) {
  const fails = [];
  const want = (l, ok) => { if (!ok) fails.push(l); };
  const code = Object.fromEntries(Object.entries(srcs).map(([f, s]) => [f, stripComments(s, { file: f })]));
  const pool = code[FILES.pool];
  const uni = code[FILES.universe];
  const panels = code[FILES.panels];
  want("the SEC inputs are a Data Cache blob (unstable_cache around the one HGETALL)", /export const readSecCapRows = unstable_cache\(loadSecCapRows, \["pool-sec-cap-v1", pickersSecKey\(\)\]/.test(pool));
  want("the overlay reads them through the cache, beside the two Tiingo blobs", /readSecCapRows\(\)\.catch\(\(\) => null\),/.test(fnBody(pool, "overlayTiingoPool")) && /overlayRows\(fmpRows, symbols, pool\?\.rows \?\? null, eodLast, nowMs, secRows\)/.test(fnBody(pool, "overlayTiingoPool")));
  want("nothing calls the uncached loader or the per-page HMGET on these paths",
    !/\bloadSecCapRows\(\)/.test(pool + uni + panels) && !/\breadSecPickerRows\(/.test(pool + uni + panels));
  want("the sector index ranks on the POOL gate, the key and the data -- one basis",
    /const onTiingo = priceProviderFor\("POOL"\) === "tiingo";/.test(uni) &&
    /\? await readSecTiingoCaps\(symbols, Date\.now\(\)\)/.test(uni) &&
    /fmpKeySet: Boolean\(process\.env\.FMP_API_KEY\),/.test(uni) &&
    /const caps = capsOnBasis\(basis, symbols, secCaps, fmpCaps\);/.test(uni) &&
    /index\.bySlug\[slug\] = rankByCap\(members, caps, MAX_CONSTITUENTS_PER_SECTOR\);/.test(uni) &&
    !/b\.marketCap - a\.marketCap/.test(uni));
  want("a cached index from the other gate is rebuilt", /isUsableIndex\(cached\) && \(cached\.gate \?\? "fmp"\) === gate/.test(uni));
  const eodFn = fnBody(panels, "buildSectorPerformanceFromEod");
  want("Tiingo sector weights are SEC x Tiingo, with no pool HMGET",
    /const caps = await readSecTiingoCaps\(allSymbols, Date\.now\(\)\)/.test(eodFn) && /weight: caps\.get\(symbol\) \?\? null/.test(eodFn) && !/readPricePoolBulk\(/.test(eodFn));
  want("the FMP-path weights go through poolCapWeight", /const weight = poolCapWeight\(quote, onTiingo\);/.test(fnBody(panels, "buildSectorPerformance")));
  return fails;
}
const wSrcs = Object.fromEntries([FILES.pool, FILES.universe, FILES.panels].map((f) => [f, raw(f)]));
const wReal = wiringRules(wSrcs);
for (const f of wReal) check(f, false);
check("the overlay, the ranking and the weights are wired to the SEC x Tiingo cap", wReal.length === 0);
for (const [name, file, from, to] of [
  ["the overlay reads the hash uncached (per view)", FILES.pool, /readSecCapRows\(\)\.catch\(\(\) => null\),\n  \]\);\n  return overlayRows/, "loadSecCapRows().catch(() => null),\n  ]);\n  return overlayRows"],
  ["the ranking ignores the gate", FILES.universe, /const onTiingo = priceProviderFor\("POOL"\) === "tiingo";/, "const onTiingo = true;"],
  ["the ranking back on FMP caps", FILES.universe, /index\.bySlug\[slug\] = rankByCap\(members, caps, MAX_CONSTITUENTS_PER_SECTOR\);/, "index.bySlug[slug] = rankByCap(members, capsOnBasis(\"fmp\", symbols, secCaps, fmpCaps), MAX_CONSTITUENTS_PER_SECTOR);"],
  ["a stale-gate index served", FILES.universe, /isUsableIndex\(cached\) && \(cached\.gate \?\? "fmp"\) === gate/, "isUsableIndex(cached)"],
  ["weights from the pool HMGET again", FILES.panels, /weight: caps\.get\(symbol\) \?\? null/, "weight: (await readPricePoolBulk(allSymbols)).get(symbol)?.marketCap ?? null"],
]) {
  const src = wSrcs[file];
  const m = src.replace(from, to);
  if (m === src) { check(`wiring mutant "${name}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = wiringRules({ ...wSrcs, [file]: m });
  check(`wiring mutant "${name}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

// Run the real paths against a stubbed Upstash and COUNT the commands.
const net = { hashes: new Map(), cmds: [] };
const b64 = (v) => (typeof v === "string" ? Buffer.from(v).toString("base64") : Array.isArray(v) ? v.map(b64) : v);
function redisAnswer(cmd) {
  net.cmds.push(cmd);
  const [op, key, ...rest] = cmd.map(String);
  switch (op.toLowerCase()) {
    case "hgetall": return [...(net.hashes.get(key) ?? new Map()).entries()].flat();
    case "hmget": return rest.map((f) => net.hashes.get(key)?.get(f) ?? null);
    case "mget": return [key, ...rest].map(() => null);
    case "set": case "setex": return "OK";
    case "get": case "zrange": case "hget": return null;
    default: return null;
  }
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (!url.startsWith(REDIS)) throw new Error(`unexpected network call: ${url}`);
  const body = JSON.parse(init.body ?? "null");
  if (/\/pipeline|\/multi-exec/.test(url)) return new Response(JSON.stringify(body.map((c) => ({ result: b64(redisAnswer(c)) }))), { status: 200 });
  return new Response(JSON.stringify({ result: b64(redisAnswer(body)) }), { status: 200 });
};
const K = await real("lib/server/marketData/keys.ts");
const MANY = Array.from({ length: 300 }, (_, i) => `S${i}`);
const lastFor = (c) => JSON.stringify({ ...LAST, c });
net.hashes.set(K.TIINGO_EOD_LAST_KEY, new Map([...MANY.map((s) => [s, lastFor(50)]), ["AAPL", lastFor(100)], ["MSFT", lastFor(100)], ["NVDA", lastFor(100)]]));
net.hashes.set(K.TIINGO_QUOTES_KEY, new Map());
const secHash = new Map(MANY.map((s) => [s, JSON.stringify(fullRow())]));
// Shares chosen so the SEC x Tiingo order (NVDA, MSFT, AAPL) is NOT the preset order (AAPL, MSFT, NVDA).
secHash.set("AAPL", JSON.stringify(fullRow({ inputs: { shares: { val: 1e9, asOf: "2026-07-20" }, refusals: [] } })));
secHash.set("MSFT", JSON.stringify(fullRow({ inputs: { shares: { val: 2e9, asOf: "2026-07-20" }, refusals: [] } })));
secHash.set("NVDA", JSON.stringify(fullRow({ inputs: { shares: { val: 3e9, asOf: "2026-07-20" }, refusals: [] } })));
net.hashes.set(S.PICKERS_SEC_KEY, secHash);

net.cmds.length = 0;
const over = await P.overlayTiingoPool(new Map(), [...MANY, "AAPL"], NOW);
const ops = net.cmds.map((c) => String(c[0]).toLowerCase());
check("overlay over 301 symbols: exactly 3 Redis commands, all whole-blob HGETALLs (each a Data Cache miss)",
  ops.length === 3 && ops.every((o) => o === "hgetall"), JSON.stringify(net.cmds.map((c) => c.slice(0, 2))));
check("...one of them the pickers SEC hash, read whole", net.cmds.some((c) => c[0].toLowerCase() === "hgetall" && c[1] === S.PICKERS_SEC_KEY));
check("...and the rows carry SEC x Tiingo caps (S0: 2e9 x 50, AAPL: 1e9 x 100)", near(over.get("S0")?.marketCap, 100e9) && near(over.get("AAPL")?.marketCap, 100e9));
const stubCached = globalThis.__nextCacheStub?.cached ?? [];
check("the SEC blob is registered with the Data Cache (6 h, keyed by the hash name)",
  stubCached.some((c) => c.keyParts?.[0] === "pool-sec-cap-v1" && c.keyParts?.[1] === S.PICKERS_SEC_KEY && c.options?.revalidate === 6 * 60 * 60));

// The sector index end to end, POOL on Tiingo, FMP caches empty (the FMP-off state).
process.env.PRICE_PROVIDER_POOL = "tiingo";
const U = await real(FILES.universe);
net.cmds.length = 0;
const idx = await U.getSectorIndex();
const tech = idx.bySlug.technology ?? [];
check("FMP off: the sector index ranks by SEC x Tiingo (technology: NVDA, MSFT, AAPL first, not the preset order)",
  idx.capBasis === "sec-tiingo" && idx.gate === "tiingo" && tech.slice(0, 3).join() === "NVDA,MSFT,AAPL", `${idx.capBasis} ${tech.slice(0, 5).join()}`);
// The build's own reads (index GET, universe, the two FMP-cache MGETs, the SET)
// were 9 commands for 100 candidates before B7; B7 adds the three blob HGETALLs
// and nothing per symbol.
const idxOps = net.cmds.map((c) => String(c[0]).toLowerCase());
check("...adding only the three Data Cache blob reads, nothing per constituent",
  idxOps.filter((o) => o === "hgetall").length === 3 && !idxOps.some((o) => o === "hmget" || o === "hget") && idxOps.length <= 12,
  JSON.stringify(idxOps));
process.env.PRICE_PROVIDER_POOL = "fmp";
const idxFmp = await U.getSectorIndex();
check("POOL on FMP with the key unset and no FMP caps: basis none (input order), never SEC x Tiingo", idxFmp.capBasis === "none" && idxFmp.gate === "fmp");
delete process.env.PRICE_PROVIDER_POOL;
globalThis.fetch = realFetch;

// ── 6. Nothing Tiingo-derived persisted outside msh:tiingo: (#553 COWORK #103, #690 Q2)
//
// A SEC x Tiingo cap or P/E carries the Tiingo close (cap / shares, pe x eps).
// Stored under an FMP-named key it escapes the msh:tiingo: purge (§7). So the
// fundamentals warm, the sector index and the sector performance table run
// here, POOL=tiingo, against a stubbed Upstash that keeps every WRITE; no write
// outside msh:tiingo: may carry any of the fixture's SEC x Tiingo figures. The
// readers must still see them, computed at read time.
console.log("\n=== 6. No SEC x Tiingo cap or P/E persisted outside msh:tiingo: ===\n");
const PP = await real("lib/server/pricePool.ts");
const WRITE_OPS = new Set(["set", "setex", "psetex", "mset", "msetnx", "hset", "hmset", "hsetnx", "lpush", "rpush", "sadd", "zadd", "append", "json.set", "eval", "evalsha"]);
const PSYMS = ["AAPL", "MSFT", "NVDA", "TSM", "ZZZ"];
const shares = (val) => ({ inputs: { shares: { val, asOf: "2026-07-20" }, refusals: [] } });
const P_EPS = { val: 4.1, basis: "four-quarters", periodEnd: "2026-06-30" };
function persistFixture({ withSec = true } = {}) {
  const kv = new Map();
  const hashes = new Map();
  // FMP pool rows (the raw hash): distinctive FMP caps, MSFT > AAPL > NVDA > TSM.
  const fmpCap = { AAPL: 7.7e11, MSFT: 8.8e11, NVDA: 6.6e11, TSM: 5.5e11, ZZZ: 4.4e9 };
  hashes.set(PP.PRICE_POOL_KEY, new Map(PSYMS.map((s, i) => [s, JSON.stringify({ ...FMP, price: 90 + i, marketCap: fmpCap[s], pe: 30 + i, ts: NOW - 60_000 })])));
  // Tiingo prices everything but ZZZ.
  hashes.set(K.TIINGO_EOD_LAST_KEY, new Map([["AAPL", lastFor(101.7)], ["MSFT", lastFor(203.3)], ["NVDA", lastFor(55.9)], ["TSM", lastFor(77.1)]]));
  hashes.set(K.TIINGO_QUOTES_KEY, new Map());
  const sec = new Map([
    ["AAPL", JSON.stringify(fullRow({ ...shares(1.3e9), eps: P_EPS }))],
    ["MSFT", JSON.stringify(fullRow({ ...shares(2.3e9), eps: P_EPS }))],
    ["NVDA", JSON.stringify(fullRow({ ...shares(3.3e9), eps: P_EPS }))],
    ["TSM", JSON.stringify(fullRow({ inputs: { shares: { val: 5e9, asOf: "2026-07-20" }, refusals: ["ads-ratio-makes-shares-incomparable", "ads-ratio-makes-eps-incomparable"] }, eps: P_EPS }))],
    ["ZZZ", JSON.stringify(fullRow({ ...shares(9.1e9), eps: P_EPS }))],
  ]);
  hashes.set(S.PICKERS_SEC_KEY, withSec ? sec : new Map());
  // The SEC x Tiingo figures this fixture produces, through the real overlay.
  const eodObj = Object.fromEntries([...hashes.get(K.TIINGO_EOD_LAST_KEY)].map(([k, v]) => [k, JSON.parse(v)]));
  const vals = P.secTiingoValuations(PSYMS, null, eodObj, S.parseSecCapHash(Object.fromEntries(sec), NOW), NOW);
  const forbidden = [...vals.values()].flatMap((v) => [v.marketCap, v.pe]).filter((n) => typeof n === "number");
  return { kv, hashes, writes: [], fetches: [], vals, fmpCap, forbidden };
}
function stubRedis(st) {
  const answer = (cmd) => {
    const [op0, key, ...rest] = cmd.map(String);
    const op = op0.toLowerCase();
    if (WRITE_OPS.has(op)) st.writes.push({ op, key, args: cmd.slice(2) });
    switch (op) {
      case "hgetall": return [...(st.hashes.get(key) ?? new Map()).entries()].flat();
      case "hmget": return rest.map((f) => st.hashes.get(key)?.get(f) ?? null);
      case "hget": return st.hashes.get(key)?.get(rest[0]) ?? null;
      case "get": return st.kv.get(key) ?? null;
      case "mget": return [key, ...rest].map((k) => st.kv.get(k) ?? null);
      case "set": st.kv.set(key, rest[0]); return "OK";
      case "zrange": case "zrangebyscore": case "smembers": case "keys": return [];
      case "exists": return 0;
      default: return WRITE_OPS.has(op) ? "OK" : null;
    }
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    if (!url.startsWith(REDIS)) { st.fetches.push(url); return new Response("[]", { status: 200 }); }
    const body = JSON.parse(init.body ?? "null");
    if (/\/pipeline|\/multi-exec/.test(url)) return new Response(JSON.stringify(body.map((c) => ({ result: b64(answer(c)) }))), { status: 200 });
    return new Response(JSON.stringify({ result: b64(answer(body)) }), { status: 200 });
  };
}
function numbersIn(v, out = []) {
  if (typeof v === "number") out.push(v);
  else if (typeof v === "string") {
    const t = v.trim();
    if (/^[-+]?[0-9.eE+-]+$/.test(t) && Number.isFinite(Number(t))) out.push(Number(t));
    else if (/^[[{]/.test(t)) { try { numbersIn(JSON.parse(t), out); } catch { /* not JSON */ } }
  } else if (Array.isArray(v)) v.forEach((x) => numbersIn(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => numbersIn(x, out));
  return out;
}
/** Every write outside msh:tiingo: that carries a fixture SEC x Tiingo cap or P/E. */
function leaks(st) {
  return st.writes
    .filter((w) => !String(w.key).startsWith("msh:tiingo:"))
    .flatMap((w) => numbersIn(w.args).filter((n) => st.forbidden.some((f) => near(n, f))).map((n) => `${w.op} ${w.key} carries ${n}`));
}
async function persistBehaviour({ F, U, Pn }) {
  const fails = [];
  const want = (l, ok) => { if (!ok) fails.push(l); };
  const keep = { pool: process.env.PRICE_PROVIDER_POOL, key: process.env.FMP_API_KEY };
  process.env.PRICE_PROVIDER_POOL = "tiingo";
  try {
    // (a) The warm (needs the key; every symbol is a pool hit, so no FMP call), the index, the table.
    const st = persistFixture();
    stubRedis(st);
    process.env.FMP_API_KEY = "x";
    const warm = await F.warmFundamentals(PSYMS);
    delete process.env.FMP_API_KEY;
    const idx = await U.getSectorIndex();
    await Pn.getSectorPerformanceTable();
    // The property first, so a mutant is reported by it.
    const l = leaks(st);
    want(`no write outside msh:tiingo: carries a SEC x Tiingo cap or P/E${l.length ? ` (${l[0]})` : ""}`, l.length === 0);
    const fundWrites = st.writes.filter((w) => /fundamentals:v1:/.test(w.key));
    want("the warm ran and wrote the fundamentals rows (the scan is measuring something)", warm?.written === PSYMS.length && fundWrites.length === PSYMS.length && st.fetches.length === 0);
    want("the sector index and the performance table were written (the scan covers them)",
      st.writes.some((w) => w.key === U.SECTOR_INDEX_KEY) && st.writes.some((w) => w.key === PN_PERF_KEY) && idx.capBasis === "sec-tiingo");
    want("the fixture has SEC x Tiingo figures to look for (AAPL cap 1.3e9 x 101.7)", near(st.vals.get("AAPL")?.marketCap, 1.3e9 * 101.7) && st.forbidden.length >= 6);
    const aaplRow = JSON.parse(String(fundWrites.find((w) => w.key.endsWith(":AAPL"))?.args?.[0] ?? "{}"));
    want("the stored fundamentals row holds the FMP pool's figures (7.7e11, P/E 30)", aaplRow.marketCap === st.fmpCap.AAPL && aaplRow.peRatio === 30);

    // (b) Readers, at read time, from the rows just written.
    const read = await F.readCachedFundamentalsBulk(["AAPL", "TSM", "ZZZ"]);
    want("a reader on the gate gets SEC x Tiingo for AAPL (cap and P/E)",
      near(read.get("AAPL")?.marketCap, st.vals.get("AAPL").marketCap) && near(read.get("AAPL")?.peRatio, st.vals.get("AAPL").pe));
    want("a refused filer (TSM) reads null, not its stored FMP figure", read.get("TSM")?.marketCap === null && read.get("TSM")?.peRatio === null);
    want("a symbol Tiingo cannot price (ZZZ) keeps its stored row", read.get("ZZZ")?.marketCap === st.fmpCap.ZZZ);
    const rawRead = await F.readCachedFundamentalsBulk(["AAPL"], { raw: true });
    want("raw: the stored FMP figure", rawRead.get("AAPL")?.marketCap === st.fmpCap.AAPL);
    const before = st.writes.length;
    await F.readCachedFundamentalsBulk(["AAPL", "MSFT"]);
    want("the read-time overlay writes nothing", st.writes.length === before);

    // (c) The "fmp" basis stays FMP's: no SEC inputs, the key set -> ranked on the stored FMP caps.
    const st2 = persistFixture({ withSec: false });
    stubRedis(st2);
    process.env.FMP_API_KEY = "x";
    await F.warmFundamentals(PSYMS);
    const idx2 = await U.getSectorIndex();
    delete process.env.FMP_API_KEY;
    const tech2 = (idx2.bySlug.technology ?? []).filter((s) => ["AAPL", "MSFT", "NVDA"].includes(s));
    want("with no SEC caps the index ranks on the stored FMP caps (MSFT, AAPL, NVDA), not the overlay's nulls",
      idx2.capBasis === "fmp" && tech2.join() === "MSFT,AAPL,NVDA");
  } finally {
    if (keep.pool === undefined) delete process.env.PRICE_PROVIDER_POOL; else process.env.PRICE_PROVIDER_POOL = keep.pool;
    if (keep.key === undefined) delete process.env.FMP_API_KEY; else process.env.FMP_API_KEY = keep.key;
    globalThis.fetch = realFetch;
  }
  return fails;
}
const F6 = await real("lib/server/fundamentalsCache.ts");
const Pn6 = await real(FILES.panels);
const PN_PERF_KEY = Pn6.PERFORMANCE_KEY;
const persistReal = await persistBehaviour({ F: F6, U, Pn: Pn6 });
for (const f of persistReal) check(f, false);
check("only FMP figures (or none) persisted; readers still get SEC x Tiingo at read time", persistReal.length === 0);
const FUND = "lib/server/fundamentalsCache.ts";
for (const [name, rel, from, to] of [
  ["the warm reads the Tiingo overlay (SEC x Tiingo into the FMP rows)", FUND, /readPricePoolBulk\(cleanSymbols, \{ raw: true \}\)/, "readPricePoolBulk(cleanSymbols)"],
  ["the warm writes the read-time figures", FUND, /quoteMap\.set\(sym, \{ marketCap: row\.marketCap, peRatio: row\.pe \}\);/,
    "const sx = (await (await import(\"./tiingoPool\")).readSecTiingoCaps([sym], Date.now())).get(sym);\n      quoteMap.set(sym, { marketCap: sx ?? row.marketCap, peRatio: row.pe });"],
  ["the reader no longer overlays at read time", FUND, /if \(!opts\.raw && result\.size && priceProviderFor\("POOL"\) === "tiingo"\) \{/, "if (false) {"],
  ["the sector index persists its caps", FILES.universe, /index\.capBasis = basis;/, "index.capBasis = basis;\n  (index as unknown as Record<string, unknown>).caps = Object.fromEntries(caps);"],
  ["the sector index's FMP basis reads the overlaid rows", FILES.universe, /readCachedFundamentalsBulk\(symbols, \{ raw: true \}\)/, "readCachedFundamentalsBulk(symbols)"],
  ["the performance table persists each constituent's weight", FILES.panels, /rank: null,\n      dayBasis: "last-close",/,
    "rank: null,\n      weights: Object.fromEntries((bySector.get(sector.slug) ?? []).map((s) => [s, caps.get(s) ?? null])),\n      dayBasis: \"last-close\","],
]) {
  const src = raw(rel);
  const m = src.replace(from, to);
  if (m === src) { check(`persistence mutant "${name}" applies`, false, "the replacement matched nothing"); continue; }
  const mod = await loadMutant(rel, m);
  const fails = await persistBehaviour({
    F: rel === FUND ? mod : F6,
    U: rel === FILES.universe ? mod : U,
    Pn: rel === FILES.panels ? mod : Pn6,
  });
  check(`persistence mutant "${name}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
