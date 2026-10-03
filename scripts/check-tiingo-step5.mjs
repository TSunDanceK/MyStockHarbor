// Tiingo step 5 (#553 COWORK #98): the price pool on Tiingo, mapped at read
// time; the Tiingo universe key; one 52-week source and one price basis on the
// stock page; "Sector today" on the last close; the mover lists; the FAQ hedge.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE ROW LIES: IEX volume shown as day volume, the move measured from
//      IEX's prevClose or the open instead of the stored consolidated close, a
//      day-old IEX trade shown over a newer close (IFNNY), a market cap
//      computed from a Tiingo price (COWORK #53 §3, #56).
//   2. A TIINGO VALUE WRITTEN TO msh:price-pool:v1, outside the prefix the
//      termination purge SCANs (contract §7).
//   3. THE FMP-OFF NIGHT: warm-price-pool returning before its keep-alive, so
//      the pool -- the Tiingo jobs' fallback universe -- lapses; or the jobs
//      ignoring the new universe key; or the widened list skipping the retick,
//      debt and PRICE_EXCLUDED rules (COWORK #98 ruling 2).
//   4. TWO 52-WEEK RANGES on one page (KO, COWORK #80 §1).
//   5. "Sector today" mixing two sessions or unlabelled (ruling 4); the
//      ticker's movers unlabelled; FMP discovery still spending (ruling 6).
//   6. The FAQ telling the reader what to do (COWORK #54, #80 §2).
//
// Sections 1-2 run the real modules and then mutated copies (each must fail);
// section 3 runs the real jobs and route against a stubbed network; the rest
// read source and plant a mutant per rule.
//
//   node scripts/check-tiingo-step5.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);

const ROOT = process.cwd();
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const REDIS = "https://fake-redis.test";
process.env.UPSTASH_REDIS_REST_URL = REDIS;
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const FILES = {
  pool: "lib/server/tiingoPool.ts",
  pricePool: "lib/server/pricePool.ts",
  eodLast: "lib/server/marketData/eodLast.ts",
  jobs: "lib/server/marketData/jobs.ts",
  keys: "lib/server/marketData/keys.ts",
  universe: "lib/server/tiingoUniverse.ts",
  route: "app/api/jobs/warm-price-pool/route.ts",
  quote: "lib/server/tiingoQuote.ts",
  stockPage: "app/stock/[symbol]/page.tsx",
  stockClient: "app/stock/[symbol]/StockSymbolPageClient.tsx",
  panels: "lib/server/sectorPanels.ts",
  sectorIndex: "app/sector/page.tsx",
  sectorNews: "app/sector/[slug]/news/page.tsx",
  market: "app/api/market/route.ts",
  movers: "lib/server/tiingoMovers.ts",
  builder: "lib/server/pickersBuilder.ts",
  ticker: "app/components/DashboardTicker.tsx",
  dashPage: "app/dashboard/page.tsx",
  pickerPage: "app/components/PickerResultPage.tsx",
};

/** Import a mutated copy of a module, next to the original so its relative imports resolve. */
let seq = 0;
async function loadMutant(rel, src) {
  const tmp = path.join(ROOT, path.dirname(rel), `.check-step5-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(tmp, src);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
const real = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

// 2026-10-01 18:05 UTC = 14:05 EDT, a Thursday session.
const THU_1405 = Date.UTC(2026, 9, 1, 18, 5);

// ── 1. The pool row, mapped at read time ─────────────────────────────────
console.log("\n=== 1. tiingoPool: what each field of a mapped row is ===\n");
const LAST = { d: "2026-09-30", o: 99, h: 101, l: 97, c: 100, v: 3000, pc: 98, w: 1, m: 2, y: 3, a50: true, a200: false };
// `volume` on the IEX row is planted: no stored row has one, and none may ever be shown.
const IEX = { price: 103, open: 101, high: 104, low: 99, prevClose: 100.5, at: THU_1405, volume: 999 };
const FMP = { price: 90, changePct: 9, volume: 1, marketCap: 5e9, open: 1, dayHigh: 1, dayLow: 1, pe: 22, ts: 1, peTs: 7, failStreak: 2, failAt: 3 };

function poolBehaviour(P) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const r = P.mapTiingoPoolRow(FMP, IEX, LAST, THU_1405);
  want("in session: the IEX trade, labelled with its ET time", r?.price === 103 && r.priceLabel === "last IEX trade, 14:05 ET" && r.ts === THU_1405 && r.source === "tiingo");
  want("% change from the STORED consolidated close (100), not IEX's prevClose or the open", r && Math.abs(r.changePct - 3) < 1e-9);
  want("open and day range are the IEX row's while the price is IEX", r?.open === 101 && r.dayHigh === 104 && r.dayLow === 99);
  want("volume is the last EOD bar's, labelled \"as of last close\" (never IEX's)", r?.volume === 3000 && r.volumeLabel === "as of last close");
  // B8 (#683 Q1): SEC shares x this price, or null -- never the FMP row's frozen
  // figure. No SEC row is passed here, so both are null (check-fmpoff-sec-cap
  // covers the computed case).
  want("market cap and P/E are never the FMP row's, nor invented from the Tiingo price", r?.marketCap === null && r.pe === null);
  want("the FMP row's bookkeeping is carried (rotation, eviction)", r?.peTs === 7 && r.failStreak === 2 && r.failAt === 3);

  // IFNNY-shaped: the IEX trade is 29 h old and a newer close is stored.
  const stale = { ...IEX, at: Date.UTC(2026, 8, 29, 17, 0) };
  const c = P.mapTiingoPoolRow(null, stale, LAST, THU_1405);
  want("an IEX trade older than the stored close: the close, labelled as a close (IFNNY)", c?.price === 100 && c.priceLabel === "close, 30 Sep 2026");
  want("...its move is from the close before it (98)", c && Math.abs(c.changePct - (2 / 98) * 100) < 1e-9);
  want("...its range is the bar's and its time is 16:00 ET of that day", c?.open === 99 && c.dayHigh === 101 && c.ts === Date.UTC(2026, 8, 30, 20, 0));
  want("...and with no FMP row, no market cap is invented", c?.marketCap === null && c.pe === null);

  const noBars = P.mapTiingoPoolRow(null, IEX, null, THU_1405);
  want("no stored bar: IEX's prevClose is the only base, and there is no volume", noBars && Math.abs(noBars.changePct - ((103 - 100.5) / 100.5) * 100) < 1e-9 && noBars.volume === null && noBars.volumeLabel === null);
  want("nothing usable: null, so the reader keeps its FMP row", P.mapTiingoPoolRow(FMP, null, null, THU_1405) === null);

  const fmpRows = new Map([["BRK-B", FMP], ["BRK.B", FMP], ["XYZ", FMP]]);
  const out = P.overlayRows(fmpRows, ["BRK.B", "XYZ", "NEW"], { "BRK-B": IEX, NEW: IEX }, { "BRK-B": LAST }, THU_1405);
  want("the overlay answers under the caller's spelling and the pool field", out.get("BRK.B")?.price === 103 && out.get("BRK-B")?.price === 103);
  want("a symbol Tiingo has nothing for keeps its FMP row unchanged", out.get("XYZ") === FMP);
  want("a Tiingo-only symbol gets a row", out.get("NEW")?.price === 103);
  return fails;
}
const P = await real(FILES.pool);
const poolFails = poolBehaviour(P);
for (const f of poolFails) check(f, false);
check("the mapped row is labelled and based as ruled", poolFails.length === 0);

console.log("\n=== 2. Behaviour mutants (tiingoPool) ===\n");
const POOL_SRC = raw(FILES.pool);
const POOL_MUTANTS = [
  ["IEX volume shown as the day's volume", /const volume = last && pos\(last\.v\) \? last\.v : null;/, "const volume = (iex as unknown as { volume?: number })?.volume ?? null;"],
  ["% change from IEX's prevClose first", /\? last && last\.d < surface\.date && pos\(last\.c\)\n\s*\? last\.c\n\s*: pos\(iex\?\.prevClose\)\n\s*\? iex!\.prevClose\n\s*: null/, "? pos(iex?.prevClose) ? iex!.prevClose : last && pos(last.c) ? last.c : null"],
  ["% change from the open", /changePct: base != null \? \(\(surface\.price - base\) \/ base\) \* 100 : null,/, "changePct: pos(iex?.open) ? ((surface.price - iex!.open!) / iex!.open!) * 100 : null,"],
  ["the IEX trade always wins (no newer-of)", /const surface = pickSurfacePrice\(iex \?\? null, bars, nowMs\);/, "const surface = pickSurfacePrice(iex ?? null, [], nowMs) ?? pickSurfacePrice(null, bars, nowMs);"],
  ["a market cap computed from the Tiingo price", /marketCap: valuation\.marketCap,/, "marketCap: surface.price * 1e9,"],
  ["the FMP row's market cap carried onto the Tiingo row", /marketCap: valuation\.marketCap,/, "marketCap: fmp?.marketCap ?? null,"],
  ["the volume loses its label", /volumeLabel: volume != null \? VOLUME_LABEL : null,/, "volumeLabel: null,"],
];
for (const [label, from, to] of POOL_MUTANTS) {
  const m = POOL_SRC.replace(from, to);
  if (m === POOL_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = poolBehaviour(await loadMutant(FILES.pool, m));
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

// ── 3. The pool hash never receives a Tiingo value ────────────────────────
console.log("\n=== 3. No Tiingo value is written to msh:price-pool:v1 ===\n");
function fnBody(src, name) {
  const i = src.search(new RegExp(`(export )?(async )?function ${name}\\b`));
  if (i < 0) return "";
  const rest = src.slice(i + 1);
  const j = rest.search(/\n(export |async function |function |const [A-Za-z_]+ = )/);
  return j < 0 ? src.slice(i) : src.slice(i, i + 1 + j);
}
function boundaryRules(srcs) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const code = Object.fromEntries(Object.entries(srcs).map(([f, s]) => [f, stripComments(s, { file: f })]));
  const pp = code[FILES.pricePool];
  const read = fnBody(pp, "readPricePoolBulk");
  want("readPricePoolBulk maps only behind the POOL switch, and never on a raw read",
    /if \(!opts\.raw && priceProviderFor\("POOL"\) === "tiingo"\) \{/.test(read) && /await overlayTiingoPool\(out, symbols, /.test(read));
  want("warmPricePool merges into FMP rows only (raw read)", /const existing = await readPricePoolBulk\(clean, \{ raw: true \}\);/.test(fnBody(pp, "warmPricePool")));
  want("seedColdPricePoolRows checks FMP rows only (raw read)", /const existing = await readPricePoolBulk\(clean\.map\(\(r\) => r\.symbol\), \{ raw: true \}\);/.test(fnBody(pp, "seedColdPricePoolRows")));
  // (Its Map .set calls are not writes; a Redis client or a hash verb would be.)
  want("tiingoPool.ts writes nothing", !/@upstash\/redis|\bredis\b|\.(hset|mset|setex|expire|del)\(/.test(code[FILES.pool]));
  return fails;
}
const bSrcs = { [FILES.pricePool]: raw(FILES.pricePool), [FILES.pool]: raw(FILES.pool) };
const bReal = boundaryRules(bSrcs);
for (const f of bReal) check(f, false);
check("the pool hash's own writers read raw; only readers see Tiingo rows", bReal.length === 0);
const B_MUTANTS = [
  ["warmPricePool reads the mapped rows back into its write", FILES.pricePool, /const existing = await readPricePoolBulk\(clean, \{ raw: true \}\);/, "const existing = await readPricePoolBulk(clean);"],
  ["the cold seed reads the mapped rows", FILES.pricePool, /readPricePoolBulk\(clean\.map\(\(r\) => r\.symbol\), \{ raw: true \}\)/, "readPricePoolBulk(clean.map((r) => r.symbol))"],
  ["the overlay ignores the raw flag", FILES.pricePool, /if \(!opts\.raw && priceProviderFor\("POOL"\) === "tiingo"\) \{/, 'if (priceProviderFor("POOL") === "tiingo") {'],
  ["the overlay writes its rows to the pool", FILES.pool, /return overlayRows\(fmpRows, symbols,/, "await (globalThis as any).redis.hset(\"msh:price-pool:v1\", {}); return overlayRows(fmpRows, symbols,"],
];
for (const [label, file, from, to] of B_MUTANTS) {
  const m = bSrcs[file].replace(from, to);
  if (m === bSrcs[file]) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = boundaryRules({ ...bSrcs, [file]: m });
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

// ── 4. The universe: planned without FMP, preferred by the jobs ───────────
console.log("\n=== 4. msh:tiingo:universe:v1 ===\n");
const K = await real(FILES.keys);
check("the universe key and the EOD summary key are under the purge's prefix",
  K.TIINGO_UNIVERSE_KEY === "msh:tiingo:universe:v1" && K.TIINGO_EOD_LAST_KEY.startsWith(K.TIINGO_PREFIX) && K.TIINGO_UNIVERSE_TTL_SECONDS >= 3 * 86400);
const U = await real(FILES.universe);
const plan = U.planTiingoUniverse({ targets: ["AAPL", "BRK.B", "TBB", "CCZ"], etfs: ["SPY"], video: ["IFNNY", "aapl"] });
check("the plan unions every source, in pool spelling, sorted", plan.symbols.join() === "AAPL,BRK-B,IFNNY,SPY", plan.symbols.join());
check("...less debt listings (TBB, CCZ) by the jobs' own rules", !plan.symbols.includes("TBB") && !plan.symbols.includes("CCZ") && plan.dropped.debt + plan.dropped.excluded === 2, JSON.stringify(plan.dropped));
check("...and says how many each source gave", plan.sources.targets === 4 && plan.sources.etfs === 1 && plan.sources.video === 2);
const NAMES = Object.keys(JSON.parse(raw("data/company-names.json")).rows);
const pagesPlan = U.planTiingoUniverse({ stockPages: U.STOCK_PAGE_SYMBOLS });
check("5b: every symbol with a stock page is in (the name file + the sitemap's curated list)",
  NAMES.every((s) => U.STOCK_PAGE_SYMBOLS.includes(s)) && ["VTI", "GLD", "KO", "BRK.B"].every((s) => U.STOCK_PAGE_SYMBOLS.includes(s)), `${U.STOCK_PAGE_SYMBOLS.length} listed`);
check("5b: ...with debt dropped, ~2,580 symbols (the PR's cost figures assume this size)",
  pagesPlan.symbols.length >= 2400 && pagesPlan.symbols.length <= 3000 && pagesPlan.dropped.debt > 0 && pagesPlan.symbols.includes("BRK-B"), `${pagesPlan.symbols.length} kept, ${pagesPlan.dropped.debt} debt dropped`);
check("a stored list parses; an empty or junk one is null (the jobs fall back)",
  U.parseTiingoUniverse(JSON.stringify({ at: 1, symbols: ["aapl"] }))?.symbols.join() === "AAPL" &&
  U.parseTiingoUniverse({ at: 1, symbols: [] }) === null && U.parseTiingoUniverse("nope") === null && U.parseTiingoUniverse(null) === null);

// The jobs, run against a stubbed Upstash and Tiingo (as check-tiingo-step1 does).
const net = { strings: new Map(), hashes: new Map(), cmds: [], tiingo: [] };
const b64 = (v) => (typeof v === "string" ? Buffer.from(v).toString("base64") : Array.isArray(v) ? v.map(b64) : v);
function redisAnswer(cmd) {
  net.cmds.push(cmd);
  const [op, key, ...rest] = cmd.map(String);
  switch (op.toLowerCase()) {
    case "get": return net.strings.get(key) ?? null;
    case "set": net.strings.set(key, rest[0]); return "OK";
    case "hkeys": return [...(net.hashes.get(key)?.keys() ?? [])];
    case "hmget": return rest.map((f) => net.hashes.get(key)?.get(f) ?? null);
    case "hgetall": return [...(net.hashes.get(key) ?? new Map()).entries()].flat();
    case "hset": { const h = net.hashes.get(key) ?? new Map(); for (let i = 0; i < rest.length; i += 2) h.set(rest[i], rest[i + 1]); net.hashes.set(key, h); return rest.length / 2; }
    case "del": for (const k of [key, ...rest]) { net.strings.delete(k); net.hashes.delete(k); } return 1;
    case "incrby": return Number(rest[0]);
    default: return 1;
  }
}
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (url.startsWith(REDIS)) {
    const body = JSON.parse(init.body ?? "null");
    if (/\/pipeline|\/multi-exec/.test(url)) return new Response(JSON.stringify(body.map((c) => ({ result: b64(redisAnswer(c)) }))), { status: 200 });
    return new Response(JSON.stringify({ result: b64(redisAnswer(body)) }), { status: 200 });
  }
  if (url.startsWith("https://api.tiingo.com")) {
    net.tiingo.push(decodeURIComponent(url.replace("https://api.tiingo.com", "")));
    const u = new URL(url);
    if (u.pathname === "/iex/") {
      const tickers = (u.searchParams.get("tickers") ?? "").split(",");
      return new Response(JSON.stringify(tickers.map((t) => ({ ticker: t, last: 10, tngoLast: 10, open: 9, high: 11, low: 8, prevClose: 9.5, lastSaleTimestamp: "2026-09-24T11:00:00-04:00" }))), { status: 200 });
    }
    if (u.pathname === "/tiingo/daily/prices") {
      const lines = ["ticker,date,close,high,low,open,volume,adjClose,adjHigh,adjLow,adjOpen,adjVolume,divCash,splitFactor"];
      for (const t of ["AAPL", "MSFT"]) lines.push(`${t},2026-09-24,1,1,1,1,1,1,1,1,1,1,0,1`);
      return new Response(lines.join("\n"), { status: 200 });
    }
    if (/^\/tiingo\/daily\/[^/]+\/prices$/.test(u.pathname)) {
      const rows = ["date,close,high,low,open,volume,adjClose,adjHigh,adjLow,adjOpen,adjVolume,divCash,splitFactor"];
      for (let i = 259; i >= 0; i--) {
        const d = new Date(Date.UTC(2026, 8, 24) - i * 86_400_000).toISOString().slice(0, 10);
        const c = 100 + (i === 0 ? 5 : i === 1 ? 0 : 0);
        rows.push(`${d},${c},${c + 1},${c - 1},${c},${1000 + i},${c},${c + 1},${c - 1},${c},${1000 + i},0,1`);
      }
      return new Response(rows.join("\n"), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }
  return new Response("unexpected host", { status: 599 });
};
Object.assign(process.env, { VERCEL_ENV: "production", TIINGO_API_KEY: "test-key" });
const resetNet = (universe) => {
  net.strings = new Map();
  net.hashes = new Map([
    ["msh:price-pool:v1", new Map([["ZZZ", "{}"]])],
    ["msh:universe:sec-cik:v1", new Map([["EQR", "0000906107"]])],
  ]);
  if (universe) net.strings.set(K.TIINGO_UNIVERSE_KEY, JSON.stringify({ at: 1, symbols: universe }));
  net.cmds = [];
  net.tiingo = [];
  globalThis.__nextCacheStub = { revalidated: [], cached: [] };
};
const iexTickers = () => net.tiingo.filter((u) => u.startsWith("/iex/")).map((u) => new URL(`https://x${u}`).searchParams.get("tickers")).join(",").split(",").filter(Boolean).sort().join();

async function jobsBehaviour(J) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  resetNet(["AAPL", "MSFT", "EQR", "CCZ"]);
  const q = await J.runTiingoQuotes(Date.parse("2026-09-24T15:00:00Z"));
  want("the quote job reads msh:tiingo:universe:v1 first", q.universeSource === "tiingo-universe" && iexTickers() === "AAPL,MSFT");
  want("...and the pool's HKEYS is not read when the key is there", !net.cmds.some((c) => String(c[0]).toLowerCase() === "hkeys"));
  want("...with the retick guard applied to the key's list (EQR -> VMRK)", JSON.stringify(q.retickered) === '["EQR"]');
  want("...and debt/PRICE_EXCLUDED dropped from it (CCZ)", !iexTickers().includes("CCZ"));
  resetNet(null);
  const f = await J.runTiingoQuotes(Date.parse("2026-09-24T15:00:00Z"));
  want("no key: the pool's HKEYS, as before", f.universeSource === "pool-hkeys" && iexTickers() === "ZZZ");
  // The nightly summary: written on a complete night, from the bars in hand.
  resetNet(["AAPL", "MSFT"]);
  const e = await J.runTiingoEod(Date.parse("2026-09-25T00:45:00Z"));
  const h = net.hashes.get(K.TIINGO_EOD_LAST_KEY);
  const aapl = h ? JSON.parse(h.get("AAPL") ?? "null") : null;
  want("a complete night writes the newest bar per symbol to msh:tiingo:eod-last:v1", e.ok && e.eodLastRows === 2 && aapl?.d === "2026-09-24" && aapl.c === 105 && aapl.pc === 100 && aapl.v === 1000);
  want("...whole (DEL first), with a TTL, before the eod tag is revalidated",
    net.cmds.some((c) => c[0] === "del" && c[1] === K.TIINGO_EOD_LAST_KEY) && net.cmds.some((c) => c[0] === "expire" && c[1] === K.TIINGO_EOD_LAST_KEY));
  return fails;
}
const J = await real(FILES.jobs);
const jFails = await jobsBehaviour(J);
for (const f of jFails) check(f, false);
check("the Tiingo jobs prefer the universe key, guarded, and write the EOD summary", jFails.length === 0);

const JOBS_SRC = raw(FILES.jobs);
const J_MUTANTS = [
  ["the jobs always read the pool's HKEYS", /const keys = stored \? stored\.symbols : await mustRedis\(\)\.hkeys\(PRICE_POOL_KEY\);/, "const keys = await mustRedis().hkeys(PRICE_POOL_KEY);"],
  ["the retick guard skipped for the key's list", /const r = retickeredOut\(pool, live, lastSeen\);/, "const r = stored ? { keep: pool, dropped: [], guard: \"off\" } : retickeredOut(pool, live, lastSeen);"],
  ["the summary is never written", /if \(eodLastRows\) \{/, "if (false) {"],
];
for (const [label, from, to] of J_MUTANTS) {
  const m = JOBS_SRC.replace(from, to);
  if (m === JOBS_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = await jobsBehaviour(await loadMutant(FILES.jobs, m));
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

// The route, lifted and run against spies (as check-pool-keepalive does).
function grabGet(src) {
  const sf = ts.createSourceFile("route.ts", src, ts.ScriptTarget.Latest, true);
  let out = null;
  const visit = (n) => { if (ts.isFunctionDeclaration(n) && n.name?.text === "GET") out = n.getText(sf).replace(/^export\s+/, ""); ts.forEachChild(n, visit); };
  visit(sf);
  return out;
}
async function routeBehaviour(routeSrc) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const getFn = grabGet(stripComments(routeSrc, { file: FILES.route }));
  if (!getFn) return ["GET could not be lifted"];
  const js = ts.transpileModule(
    `const S = () => globalThis.__STEP5_SPY;
const console = { log: () => {}, warn: () => {}, error: () => {} };
const NextResponse = { json: (body, init) => ({ body, init }) };
const isAuthorized = () => true;
const acquireLock = async () => "token";
const releaseLock = async () => {};
const recordJobRun = async (job, ok, summary) => { S().log.push("record"); S().records.push(summary); };
const getWarmTargetSymbols = async () => ({ symbols: ["AAPL"], displayed: 1, universe: 1, tier1: 1 });
const warmPricePool = async (syms, now, opts) => { S().log.push("warm"); S().warmOpts = opts; return { ok: true, written: 1 }; };
const POOL_BENCHMARK_ETFS = ["SPY"];
const POOL_VIDEO_TICKERS = ["IFNNY"];
const STOCK_PAGE_SYMBOLS = ["KO"];
const isActiveMarketWindow = () => S().open;
const keepPricePoolAlive = async () => { S().log.push("keepalive"); return true; };
const planTiingoUniverse = (parts) => ({ symbols: Object.values(parts).flat(), sources: {}, dropped: { debt: 0, excluded: 0 } });
const writeTiingoUniverse = async (plan) => { S().log.push("universe"); S().universe = plan.symbols; return true; };
const priceProviderFor = (s) => (s === "POOL" ? S().pool : "fmp");
const process = { get env() { return S().env; } };
${getFn}
export { GET };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
  ).outputText;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}#${seq++}`);
  const run = async (open, env, pool = "fmp") => {
    globalThis.__STEP5_SPY = { open, env, pool, log: [], records: [], universe: null, warmOpts: null };
    const res = await mod.GET({ headers: { get: () => null } });
    return { ...globalThis.__STEP5_SPY, res };
  };
  const noKey = await run(true, {});
  want("FMP_API_KEY unset, in session: no 500", noKey.res?.init?.status !== 500 && noKey.res?.body?.ok === true);
  want("...the Tiingo universe is still written, from targets + ETFs + video tickers + stock pages (5b)", noKey.log.includes("universe") && noKey.universe?.join() === "AAPL,SPY,IFNNY,KO");
  want("...the pool is kept alive BEFORE the run returns, and recorded", noKey.log.includes("keepalive") && noKey.log.indexOf("keepalive") < noKey.log.indexOf("record") && noKey.records[0]?.poolKeptAlive === true);
  want("...and no FMP warm is attempted", !noKey.log.includes("warm"));
  const shut = await run(false, {});
  want("FMP_API_KEY unset, window shut: kept alive, nothing derived", shut.log.join() === "keepalive,record");
  const withKey = await run(true, { FMP_API_KEY: "x" });
  want("with the key: the universe, then the FMP warm, with the mover buckets on fmp", withKey.log.join() === "universe,warm,record" && withKey.warmOpts?.moverBuckets === true);
  const onTiingo = await run(true, { FMP_API_KEY: "x" }, "tiingo");
  want("on PRICE_PROVIDER_POOL=tiingo the FMP mover buckets are retired", onTiingo.warmOpts?.moverBuckets === false);
  return fails;
}
const ROUTE_SRC = raw(FILES.route);
const rFails = await routeBehaviour(ROUTE_SRC);
for (const f of rFails) check(f, false);
check("warm-price-pool writes the universe and keeps the pool alive with no FMP key", rFails.length === 0);
const R_MUTANTS = [
  ["the route returns before keep-alive (no FMP key)", /const poolKeptAlive = await keepPricePoolAlive\(\);(\s*await recordJobRun\("warm-price-pool", true, \{\s*skipped: true,\s*reason: "no FMP_API_KEY",)/, "const poolKeptAlive = false;$1"],
  ["the early 500 restored", /(if \(!isAuthorized\(req\)\) \{[\s\S]*?\n {2}\})/, '$1\n  if (!process.env.FMP_API_KEY) {\n    return NextResponse.json({ error: "Missing FMP_API_KEY environment variable." }, { status: 500 });\n  }'],
  ["the universe written only with an FMP key", /const tiingoUniverseWritten = await writeTiingoUniverse\(tiingoUniverse\);/, "const tiingoUniverseWritten = process.env.FMP_API_KEY ? await writeTiingoUniverse(tiingoUniverse) : false;"],
  ["the mover buckets kept on Tiingo", /moverBuckets: priceProviderFor\("POOL"\) !== "tiingo",/, "moverBuckets: true,"],
  ["5b: the stock-page symbols left out", /\n\s*stockPages: STOCK_PAGE_SYMBOLS,/, ""],
];
for (const [label, from, to] of R_MUTANTS) {
  const m = ROUTE_SRC.replace(from, to);
  if (m === ROUTE_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = await routeBehaviour(m);
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

// ── 5. One 52-week source, one price basis (KO, COWORK #80) ───────────────
console.log("\n=== 5. The 52-week range and the price basis on the stock page ===\n");
// KO-shaped: FMP's quote said 65.84-92.49, the bars say 65.35-92.49.
const koBar = (i) => {
  const d = new Date(Date.UTC(2025, 8, 1) + i * 86_400_000).toISOString().slice(0, 10);
  const close = 70 + (i % 20);
  return [d, close, i === 200 ? 92.49 : close + 0.5, i === 120 ? 65.35 : close - 0.5, close, 1000];
};
const KO_BARS = Array.from({ length: 300 }, (_, i) => koBar(i));
const KO_ROW = { price: 71, open: 70.5, high: 71.5, low: 70.2, prevClose: 70, at: Date.UTC(2026, 9, 1, 18, 5) };
const FW = await real("lib/server/fiftyTwoWeek.ts");
async function rangeBehaviour(Q) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const q = Q.buildTiingoQuote("KO", KO_ROW, KO_BARS, THU_1405);
  const one = FW.fiftyTwoWeekRange(Q.rangePoints(KO_BARS, KO_ROW, q?.priceLabel?.startsWith("last IEX") ?? false));
  want("the header's 52-week range IS fiftyTwoWeekRange over the same bars", q?.yearLow === one?.low && q?.yearHigh === one?.high && q.yearLow === 65.35 && q.yearHigh === 92.49);
  want("...including its 20-bar minimum (a 10-bar listing shows no range)", Q.buildTiingoQuote("NEW", null, KO_BARS.slice(-10), THU_1405)?.yearLow === null);
  return fails;
}
const QR = await real(FILES.quote);
const qFails = await rangeBehaviour(QR);
for (const f of qFails) check(f, false);
check("the header range comes from the profile row's helper (KO: 65.35-92.49)", qFails.length === 0);
const SP = await real("lib/server/stockProfile.ts");
const header = QR.buildTiingoQuote("KO", KO_ROW, KO_BARS, THU_1405);
const composed = SP.composeCompanyProfile({
  symbol: "KO", directoryName: "Coca-Cola", snapshotName: "", entityName: null, filingDescription: null,
  taxonomy: { sector: null, industry: null }, classificationAsOf: null, valuation: null, price: header.price,
  points: [{ close: 1, high: 1, low: 1 }], exchange: null, registrant: null,
  range: { low: header.yearLow, high: header.yearHigh }, priceLabel: header.priceLabel,
});
check("the profile row shows the header's range, not its own FMP-history one", composed.rangeLow === 65.35 && composed.rangeHigh === 92.49, `${composed.rangeLow}-${composed.rangeHigh}`);
check("stockProfile still re-exports the one helper", SP.fiftyTwoWeekRange === FW.fiftyTwoWeekRange || typeof SP.fiftyTwoWeekRange === "function");
const Q_SRC = raw(FILES.quote);
const Q_MUTANTS = [
  ["the header's own range code again (no 20-bar minimum, its own window)", /const r = fiftyTwoWeekRange\(rangePoints\(bars, row, rowIsNewer\)\);\n\s*return \{ low: r\?\.low \?\? null, high: r\?\.high \?\? null \};/,
    "const pts = rangePoints(bars, row, rowIsNewer).slice(-300);\n  return { low: pts.length ? Math.min(...pts.map((p) => p.low ?? p.close)) : null, high: pts.length ? Math.max(...pts.map((p) => p.high ?? p.close)) : null };"],
];
for (const [label, from, to] of Q_MUTANTS) {
  const m = Q_SRC.replace(from, to);
  if (m === Q_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = await rangeBehaviour(await loadMutant(FILES.quote, m));
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

// ── 6. Static rules: stock page, FAQ, sectors, movers, credit ─────────────
console.log("\n=== 6. Stock page basis, FAQ, Sector today, movers, credit ===\n");
const OLD_FAQ = "Open the full dashboard, review the chart in more detail, compare indicators, and decide whether the setup still makes sense within your own process.";
function staticRules(srcs) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const code = Object.fromEntries(Object.entries(srcs).map(([f, s]) => [f, stripComments(s, { file: f })]));

  // the stock page: one basis, one range
  const page = code[FILES.stockPage];
  want("on a Tiingo quote the profile row takes the header's range and names the price",
    /\.\.\.\(quote\.priceLabel\s*\?\s*\{ range: quote\.yearLow != null && quote\.yearHigh != null \? \{ low: quote\.yearLow, high: quote\.yearHigh \} : null, priceLabel: quote\.priceLabel \}/.test(page));
  want("cap and multiples use the header's price", /price: quote\.price,/.test(page) && /valuationMultiples\(secFacts\.profileFacts\.valuation, secFacts\.profileFacts\.multiples, quote\.price(?:, \{ withEstimates: true \})?\)/.test(page));
  want("the valuation note names that price on Tiingo", /quote\.priceLabel \? ` Price: \$\{quote\.priceLabel\}\.` : ""/.test(page));

  // FAQ
  const client = srcs[FILES.stockClient];
  want("the imperative FAQ answer is gone", !client.includes(OLD_FAQ) && !client.includes("What should I do next after reading this page?"));
  want("the hedged description is there", client.includes("Some readers may open the full dashboard to review the chart in more detail"));
  want("the \"not a recommendation\" Q&A is unchanged",
    client.includes('{ q: "Is this page a buy or sell recommendation?", a: "No. This page is designed to help you review chart structure, momentum and technical context more quickly, but it is not personal financial advice." }'));

  // Sector today
  const panels = code[FILES.panels];
  want("the Tiingo sector table is the EOD move, basis last-close, one session", /dayBasis: "last-close",\s*sessionDate: date,/.test(panels) && /const \{ date, rows: fresh \} = lastCloseRows\(allSymbols, eod\);/.test(panels));
  want("week/month/YTD from the stored bars' summary, not FMP's price-change", /week: weightedAverage\(entries\(\(r\) => r\.w\)\)\.value,/.test(fnBody(panels, "buildSectorPerformanceFromEod")) && !/readCachedStockDataBulk/.test(fnBody(panels, "buildSectorPerformanceFromEod")));
  want("breadth from the stored flags on Tiingo", /const fromEod = eodBreadth\(constituents, eod\);/.test(panels));
  want("the Tiingo paths are gated on POOL", /return priceProviderFor\("POOL"\) === "tiingo";/.test(panels) && /if \(!poolOnTiingo\(\)\) return null;/.test(panels));
  want("the cache key moved to v3", /"msh:sector-performance:v3"/.test(panels));
  want("/sector labels a last-close column \"Last close · <date>\"", /row\?\.dayBasis === "last-close"\s*\? lastCloseLabel\(row\.sessionDate\)/.test(code[FILES.sectorIndex]));
  want("the sector page's card and movers say \"Last close\"",
    /const dayTitle = lastClose \? "Last Close"/.test(code[FILES.sectorNews]) && /movers\.dayBasis === "last-close"\s*\? `Inside the sector · \$\{lastCloseLabel\(movers\.sessionDate\)/.test(code[FILES.sectorNews]));

  // movers: rendered -> computed from Tiingo, labelled; unrendered -> retired
  const market = fnBody(code[FILES.market], "GET");
  const gate = market.search(/if \(priceProviderFor\("POOL"\) === "tiingo"\) \{\s*return NextResponse\.json\(/);
  want("/api/market discovery is retired on POOL=tiingo, before its FMP key check", gate >= 0 && gate < market.search(/const apiKey = process\.env\.FMP_API_KEY;/) && /status: 410/.test(market));
  want("the ticker's movers come from the Tiingo universe on POOL=tiingo", /priceProviderFor\("POOL"\) === "tiingo" \? await readTiingoTickerMovers\(8\)/.test(code[FILES.builder]) && /topMovers: tiingoTickerMovers \?\? topMoversForTicker,/.test(code[FILES.builder]));
  want("...and the ticker shows their label instead of \"today\"", /% \$\{row\.label \?\? "today"\}`/.test(code[FILES.ticker]));
  want("...with no raw close or volume in the stored payload", /rangePct: null, last: null, volume: null, label \}/.test(code[FILES.movers]));

  // credit (rule 1 itself is check-tiingo-credit's)
  want("both sector pages render the linked credit on POOL=tiingo",
    [FILES.sectorIndex, FILES.sectorNews].every((f) => /priceProviderFor\("POOL"\) === "tiingo"/.test(code[f]) && /<a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a>/.test(code[f])));
  want("the Pickers footer credits Tiingo when POOL is switched", /const tiingoPrices = priceProviderFor\("PICKERS"\) === "tiingo" \|\| priceProviderFor\("POOL"\) === "tiingo";/.test(code[FILES.pickerPage]));
  want("...and labels the volume \"as of last close\"", /priceWindow && volumeLabel \? `\$\{priceWindow\} · volume \$\{volumeLabel\}`/.test(code[FILES.pickerPage]));
  want("the dashboard credit covers the ticker's Tiingo movers", /priceProviderFor\("STOCK_PAGE"\) === "tiingo" \|\| priceProviderFor\("POOL"\) === "tiingo"/.test(code[FILES.dashPage]) && /<DashboardTicker credit=\{tiingoCredit\} \/>/.test(srcs["app/components/DashboardClient.tsx"]));
  return fails;
}
const sSrcs = Object.fromEntries([...Object.values(FILES), "app/components/DashboardClient.tsx"].map((f) => [f, raw(f)]));
const sReal = staticRules(sSrcs);
for (const f of sReal) check(f, false);
check("step 5's static rules hold", sReal.length === 0);
const S_MUTANTS = [
  ["the old FAQ copy", FILES.stockClient, /\{ q: "Where can I see this chart in more detail\?", a: "[^"]+" \},/, `{ q: "What should I do next after reading this page?", a: "${OLD_FAQ}" },`],
  ["the not-a-recommendation answer dropped", FILES.stockClient, /\{ q: "Is this page a buy or sell recommendation\?", a: "[^"]+" \},/, ""],
  ["the profile row keeps its own range on Tiingo", FILES.stockPage, /\{ range: quote\.yearLow != null && quote\.yearHigh != null \? \{ low: quote\.yearLow, high: quote\.yearHigh \} : null, priceLabel: quote\.priceLabel \}/, "{ priceLabel: quote.priceLabel }"],
  ["the sector column says Last session on Tiingo", FILES.sectorIndex, /\? lastCloseLabel\(row\.sessionDate\) \?\? "Last close"/, '? "Last session"'],
  ["the sector cache key left at v2", FILES.panels, /"msh:sector-performance:v3"/, '"msh:sector-performance:v2"'],
  ["week/month/YTD from FMP on Tiingo", FILES.panels, /week: weightedAverage\(entries\(\(r\) => r\.w\)\)\.value,/, "week: weightedAverage(entries(() => null)).value, /* readCachedStockDataBulk */"],
  ["/api/market keeps spending on Tiingo", FILES.market, /if \(priceProviderFor\("POOL"\) === "tiingo"\) \{/, "if (false) {"],
  ["the ticker says \"today\" for a last close", FILES.ticker, /% \$\{row\.label \?\? "today"\}`/, "% today`"],
  ["the ticker keeps FMP's movers on Tiingo", FILES.builder, /topMovers: tiingoTickerMovers \?\? topMoversForTicker,/, "topMovers: topMoversForTicker,"],
  ["a sector page without the credit", FILES.sectorNews, /<a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a>/, "null"],
  ["the Pickers credit on PICKERS only", FILES.pickerPage, / \|\| priceProviderFor\("POOL"\) === "tiingo";/, ";"],
];
for (const [label, file, from, to] of S_MUTANTS) {
  const m = sSrcs[file].replace(from, to);
  if (m === sSrcs[file]) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = staticRules({ ...sSrcs, [file]: m });
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

// ── 7. The EOD summary: what it computes, the label, the session rule ─────
console.log("\n=== 7. eodLast: the summary, \"Last close · <date>\", one session ===\n");
const E = await real(FILES.eodLast);
async function eodBehaviour(M) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  want("the label reads \"Last close · 1 Oct\"", M.lastCloseLabel("2026-10-01") === "Last close · 1 Oct" && M.lastCloseLabel("junk") === null);
  // 260 sessions: flat at 100 through 2025, then up 1 a session.
  const days = Array.from({ length: 260 }, (_, i) => new Date(Date.UTC(2025, 9, 1) + i * 86_400_000).toISOString().slice(0, 10));
  const bars = days.map((d, i) => { const c = d < "2026-01-01" ? 100 : 100 + i; return [d, c, c + 1, c - 1, c, 10 + i]; });
  const r = M.eodLastRow(bars);
  const last = bars[259][4];
  want("the newest bar, its close and volume, and the close before it", r?.d === days[259] && r.c === last && r.v === 269 && r.pc === bars[258][4]);
  want("week = from the close 5 sessions earlier", r && Math.abs(r.w - ((last - bars[254][4]) / bars[254][4]) * 100) < 1e-9);
  want("YTD = from the last close of the previous year (100)", r && Math.abs(r.y - (last - 100)) < 1e-9);
  want("month = from the last close on or before a month earlier", r && r.m != null && r.m > 0 && r.m < r.y);
  want("MA flags only with 200+ bars", r?.a50 === true && r.a200 === true && M.eodLastRow(bars.slice(-50))?.a50 === null);
  const eod = { A: { ...r, d: "2026-10-01", c: 110, pc: 100 }, B: { ...r, d: "2026-09-30", c: 50, pc: 100 }, C: { ...r, d: "2026-10-01", c: 95, pc: 100 } };
  const lc = M.lastCloseRows(["A", "B", "C"], eod);
  want("one session per ranking: the newest date's rows only", lc.date === "2026-10-01" && [...lc.rows.keys()].join() === "A,C");
  want("the day move is from the stored close before", Math.abs(M.eodDayMove(eod.A) - 10) < 1e-9 && M.eodDayMove({ ...eod.A, pc: null }) === null);
  return fails;
}
const eFails = await eodBehaviour(E);
for (const f of eFails) check(f, false);
check("the EOD summary computes what the sector pages show", eFails.length === 0);
const E_SRC = raw(FILES.eodLast);
const E_MUTANTS = [
  ["two sessions mixed in one ranking", /if \(r && r\.d === date\) rows\.set\(s, r\);/, "if (r) rows.set(s, r);"],
  ["week from 4 sessions back", /w: n >= 6 \? pct\(c, bars\[n - 6\]\[4\]\) : null,/, "w: n >= 5 ? pct(c, bars[n - 5][4]) : null,"],
  ["the old \"Last session\" wording", /return day \? `Last close · \$\{day\}` : null;/, "return day ? `Last session · ${day}` : null;"],
];
for (const [label, from, to] of E_MUTANTS) {
  const m = E_SRC.replace(from, to);
  if (m === E_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = await eodBehaviour(await loadMutant(FILES.eodLast, m));
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}
const MV = await real(FILES.movers);
const mv = MV.tiingoTickerMovers({ AAA: { d: "2026-10-01", o: 1, h: 1, l: 1, c: 90, v: 1, pc: 100 }, BBB: { d: "2026-09-30", o: 1, h: 1, l: 1, c: 200, v: 1, pc: 100 }, CCZ: { d: "2026-10-01", o: 1, h: 1, l: 1, c: 300, v: 1, pc: 100 } }, 8);
check("the ticker's Tiingo movers: newest session only, PRICE_EXCLUDED dropped, labelled, % only",
  mv.length === 1 && mv[0].symbol === "AAA" && Math.abs(mv[0].changePct + 10) < 1e-9 && mv[0].label === "Last close · 1 Oct" && mv[0].last === null && mv[0].volume === null, JSON.stringify(mv));

// ── 8. Scale: the EOD summary blob at 3,000 symbols (COWORK #59 §2) ───────
console.log("\n=== 8. The EOD summary blob at 3,000 symbols ===\n");
const typical = JSON.stringify({ d: "2026-10-01", o: 1234.56, h: 1240.12, l: 1220.34, c: 1235.78, v: 123456789, pc: 1229.87, w: -12.345678901234567, m: 23.456789012345678, y: -34.56789012345678, a50: true, a200: false });
const blob = 3000 * (typical.length + 8);
check("3,000 rows stay far under the 2 MB Data Cache item limit", blob < 1_000_000, `${(blob / 1e6).toFixed(2)} MB`);
check("...and one HSET of them under the 5 MB request budget", blob < 5_000_000);

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
