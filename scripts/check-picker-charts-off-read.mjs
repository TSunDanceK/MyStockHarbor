// THE PICKER CHARTS HASH IS OFF THE PAYLOAD READ, AND THE METER SEES THE READS
// (#553 COWORK #214, PR A: cuts 1 and 3, 2026-10-12).
//
// The Upstash bill was ~9.4 GB/day and its largest term was readPickersCache
// re-attaching every symbol's 72 bars from msh:picker-charts:v1 (~7.6 MB) on
// every picker read, for a grid that draws at most 21 candles. What must hold:
//
//   1. No charts read on the payload path. readPickersCache reads the hash only
//      for records with neither bars nor a chart lite (the one rollout case),
//      never attaches bars, and no render path HGETALLs the charts hash.
//      Run on the REAL function body against stubs, not grepped.
//   2. The meter flushes on the cached path: getPickersData's and the route's
//      cached returns await flushRedisReadMeter() before returning.
//   3. The payload byte constant is within ±25% of the 2026-10-12 census.
//   4. The chart lite derives what the bars did: rowBars over a lite and over
//      the full bars agree on the last close, the one before it, volume, MA200
//      and Stretch's 20 closes -- on the real modules, including bars with gaps.
//   5. Candles are fetched for drawn rows only: /api/picker-charts caps at 30
//      symbols, reads through the HMGET reader and is BotID-protected; the grid
//      asks for the shown rows that draw a chart, not the whole universe.
//   6. The census's unmetered keyspaces are metered: Tiingo EOD / pool /
//      EOD-last, SEC fact sets, news and the SEC fundamentals rows.
//   7. Mutants: each rule above broken once, and caught.
//
//   node scripts/check-picker-charts-off-read.mjs
import ts from "typescript";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const code = (f, text = read(f)) => stripComments(text, { file: f });
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const BUILDER = "lib/server/pickersBuilder.ts";
const METER = "lib/server/redisBandwidth.ts";
const LITE = "lib/pickerChartLite.ts";
const STRETCH = "lib/stretch.ts";
const ROUTE = "app/api/picker-charts/route.ts";
const GRID = "app/components/PickerResultsGrid.tsx";
const HOOK = "app/components/usePickerBars.ts";
const CHARTS = "lib/server/pickerChartsCache.ts";
const PROTECT = "instrumentation-client.ts";

/** A function declaration's text by name, from TS source. */
function fnText(src, name, file = BUILDER) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let out = null;
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) out = n.getText(sf).replace(/^export\s+/, "");
    if (!out) ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const js = (tsSrc) =>
  ts.transpileModule(tsSrc, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "picker-charts-off-"));
let seq = 0;
async function importTs(tsSrc) {
  const f = path.join(TMP, `m${seq++}.mjs`);
  fs.writeFileSync(f, js(tsSrc));
  return import(pathToFileURL(f).href);
}

// ─── 1. No charts read on the payload path ──────────────────────────────────
// The real readPickersCache, with its I/O stubbed. Three payloads: every
// record summarised (the steady state), one record unsummarised (rollout),
// and the v9 fallback. Returns what the hash was asked for and what came back.
async function runReadPickersCache(builderSrc) {
  const body = fnText(builderSrc, "readPickersCache");
  if (!body) return { error: "readPickersCache not found" };
  const mod = await importTs(`
    export const bench = { asked: [], records: [], v10: null };
    const redis = { get: async () => null };
    const PICKERS_LAST_GOOD_MANIFEST_KEY = "lg";
    const PICKERS_REDIS_KEY = "v9";
    const readPickersV10 = async () => bench.v10;
    const recordRedisRead = async (source, units) => { bench.records.push([source, units]); };
    const readPickerChartsBulk = async (symbols) => {
      bench.asked.push([...symbols]);
      return new Map(symbols.map((s) => [s, [{ date: "d", close: 1, volume: 2, ma200: 3 }]]));
    };
    const chartLiteOf = (pts) => ({ c: pts.map((p) => p.close), v: 2, m: 3 });
    ${body}
    export { readPickersCache };
  `);
  const lite = { c: [1], v: 1, m: 1 };
  const steady = { cachedAt: 1, data: { signalRecords: [{ symbol: "AAA", chartLite: lite }, { symbol: "BBB", chartLite: lite }] } };
  const rollout = { cachedAt: 1, data: { signalRecords: [{ symbol: "AAA", chartLite: lite }, { symbol: "OLD" }] } };

  mod.bench.v10 = steady;
  const a = await mod.readPickersCache({});
  const steadyAsked = mod.bench.asked.splice(0);
  mod.bench.v10 = rollout;
  const b = await mod.readPickersCache({});
  const rolloutAsked = mod.bench.asked.splice(0);
  const records = b?.data?.signalRecords ?? [];
  return {
    steadyAsked,
    rolloutAsked,
    steadyBars: (a?.data?.signalRecords ?? []).some((r) => r.chartPoints),
    rolloutBars: records.some((r) => Array.isArray(r.chartPoints) && r.chartPoints.length),
    rolloutLite: records.find((r) => r.symbol === "OLD")?.chartLite ?? null,
    metered: mod.bench.records.some(([s, u]) => s === "picker-payload" && u === 2),
  };
}

function rule1(r) {
  if (r.error) return [false, r.error];
  const ok =
    r.steadyAsked.length === 0 &&
    r.rolloutAsked.length === 1 &&
    r.rolloutAsked[0].join(",") === "OLD" &&
    !r.steadyBars &&
    !r.rolloutBars &&
    !!r.rolloutLite &&
    r.metered;
  return [
    ok,
    `steady-state hash reads ${r.steadyAsked.length} (want 0); rollout asked ` +
      `${JSON.stringify(r.rolloutAsked)} (want [["OLD"]]); bars attached ` +
      `${r.steadyBars || r.rolloutBars} (want false); payload metered ${r.metered}`,
  ];
}

// No render path HGETALLs the charts hash: not by its constant, not by its literal.
const RENDER_DIRS = ["app", "lib"];
function filesUnder(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(rel));
    else if (/\.(ts|tsx|mjs)$/.test(e.name)) out.push(rel);
  }
  return out;
}
const HGETALL_CHARTS = /hgetall\s*(<[^()]*>)?\s*\(\s*(PICKER_CHARTS_KEY|["'`]msh:picker-charts)/;
function rule1b(sources) {
  const hits = Object.entries(sources).filter(([, s]) => HGETALL_CHARTS.test(s)).map(([f]) => f);
  return [hits.length === 0, hits.length ? `HGETALL of the charts hash in ${hits.join(", ")}` : "none in app/ or lib/"];
}

// ─── 2. The meter flushes on the cached path ────────────────────────────────
// In each named function, the `if (!forceRefresh && cached?.data)` block must
// await flushRedisReadMeter() before its return.
function cachedBranchFlushes(src, fnName) {
  const body = fnText(src, fnName);
  if (!body) return false;
  const sf = ts.createSourceFile("f.ts", body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let ok = false;
  const visit = (n) => {
    if (
      ts.isIfStatement(n) &&
      n.expression.getText(sf).replace(/\s+/g, "") === "!forceRefresh&&cached?.data" &&
      ts.isBlock(n.thenStatement)
    ) {
      const stmts = n.thenStatement.statements;
      const flushAt = stmts.findIndex((s) => /^await flushRedisReadMeter\(\)/.test(s.getText(sf)));
      const retAt = stmts.findIndex((s) => ts.isReturnStatement(s));
      ok = flushAt >= 0 && retAt > flushAt;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return ok;
}
function rule2(builderSrc) {
  const page = cachedBranchFlushes(builderSrc, "getPickersData");
  const route = cachedBranchFlushes(builderSrc, "handlePickersRequest");
  return [page && route, `getPickersData ${page}, handlePickersRequest ${route}`];
}

// ─── 3. The payload constant against the census ─────────────────────────────
// 2026-10-12 relay census (write-redis-bytes-census, run 38245648810): the v10
// manifest's chunks at 2.29 MB over 688 records.
const CENSUS_BYTES_PER_RECORD = 2_290_000 / 688;
function rule3(meterSrc) {
  const m = meterSrc.match(/BYTES_PER_SYMBOL_PICKER_PAYLOAD = ([0-9_]+);/);
  const v = m ? Number(m[1].replace(/_/g, "")) : NaN;
  const drift = Math.abs(v / CENSUS_BYTES_PER_RECORD - 1);
  const sourced = /BYTES_PER_SYMBOL_PICKER_PAYLOAD_CENSUS = "2026-10-12 /.test(meterSrc);
  return [
    Number.isFinite(v) && drift <= 0.25 && sourced,
    `${v} B against the census's ${Math.round(CENSUS_BYTES_PER_RECORD)} B (${(drift * 100).toFixed(1)}% apart, ` +
      `limit 25%); provenance ${sourced ? "present" : "MISSING"}`,
  ];
}

// ─── 4. The lite derives what the bars did ──────────────────────────────────
async function rule4(liteSrc) {
  const lite = await importTs(liteSrc);
  const stretch = await importTs(read(STRETCH));
  const bars = Array.from({ length: 72 }, (_, i) => ({
    date: `d${i}`,
    close: 100 + Math.sin(i / 3) * 7 + i * 0.2,
    volume: 1_000 + i,
    ma200: 90 + i * 0.1,
  }));
  const gappy = bars.map((b, i) => (i === 60 ? { ...b, close: NaN } : b));
  const short = bars.slice(0, 3);
  const bad = [];
  for (const [name, pts] of [["72 bars", bars], ["a gap at bar 60", gappy], ["3 bars", short]]) {
    const full = lite.rowBars({ chartPoints: pts });
    const thin = lite.rowBars({ chartLite: lite.chartLiteOf(pts) });
    const same = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));
    for (const k of ["lastClose", "prevClose", "lastVolume", "lastMa200"]) {
      if (!same(full[k], thin[k])) bad.push(`${name}: ${k} ${full[k]} vs ${thin[k]}`);
    }
    const zf = stretch.latestStretch(full.closes);
    const zt = stretch.latestStretch(thin.closes);
    if (!same(zf, zt)) bad.push(`${name}: Stretch ${zf} vs ${zt}`);
    // The sparkline is the grid's last 40 BARS' finite closes (sparkCloses),
    // so a gap shortens it by one either way.
    const n = lite.CHART_LITE_CLOSES;
    const spark = pts.slice(-n).map((p) => p.close).filter((c) => Number.isFinite(c));
    if (spark.join() !== thin.closes.join()) bad.push(`${name}: sparkline closes differ`);
  }
  return [bad.length === 0, bad.length ? bad.join("; ") : "last close, prior close, volume, MA200, Stretch and the sparkline agree"];
}

// ─── 5. Candles for drawn rows only ─────────────────────────────────────────
function rule5({ route, grid, hook, charts, protect }) {
  const cap = Number((route.match(/const MAX_SYMBOLS = (\d+);/) ?? [])[1]);
  const batch = Number((hook.match(/PICKER_BARS_BATCH = (\d+);/) ?? [])[1]);
  const parts = {
    "route caps at 30": cap === 30 && /symbols\.length > MAX_SYMBOLS/.test(route),
    "hook batches within the cap": batch > 0 && batch <= cap,
    "route reads via readPickerChartsBulk": /readPickerChartsBulk\(symbols,/.test(route),
    "the reader is HMGET": /redis\.hmget\(PICKER_CHARTS_KEY/.test(charts) && !/hgetall/.test(charts),
    "route is BotID-checked": /await isUnwantedBot\(\)/.test(route),
    "route flushes its meter": /await flushRedisReadMeter\(\)/.test(route),
    "BotID protect list has it": /path:\s*"\/api\/picker-charts"/.test(protect),
    "grid asks for shown rows only": /const barsWanted = shown\s*\.filter\(/.test(grid) && /usePickerBars\(barsWanted\)/.test(grid),
    "only rows that draw a chart": /viewMode === "chart" \|\| expandedRows\.has\(e\.symbol\)/.test(grid),
  };
  const missing = Object.entries(parts).filter(([, ok]) => !ok).map(([k]) => k);
  return [missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : Object.keys(parts).join("; ")];
}

// ─── 6. The census's keyspaces are metered ──────────────────────────────────
const METERED = [
  ["lib/server/marketData/read.ts", /recordRedisRead\("tiingo-eod", 1,/],
  ["lib/server/marketData/read.ts", /recordRedisRead\("tiingo-pool",/],
  ["lib/server/marketData/read.ts", /recordRedisRead\("tiingo-eod-last",/],
  ["lib/server/newsStore.ts", /recordRedisRead\("news", 1,/],
  ["lib/server/newsStore.ts", /recordRedisRead\("news", entries/],
  ["lib/server/pickersSecFundamentals.ts", /recordRedisRead\("sec-fundamentals", fields\.length,/],
  ["lib/server/pickersSecFundamentals.ts", /recordRedisRead\("sec-fundamentals", raw \?/],
  ["lib/server/pickersSecFundamentals.ts", /recordRedisRead\("sec-facts", factSetsRead,/],
  ["app/api/jobs/warm-pickers-sec/route.ts", /await flushRedisReadMeter\(\)/],
];
function rule6(srcs, meterSrc) {
  const missing = METERED.filter(([f, re]) => !re.test(srcs[f])).map(([f, re]) => `${f} ${re.source}`);
  const sources = ["tiingo-eod", "tiingo-pool", "tiingo-eod-last", "sec-facts", "sec-fundamentals"]
    .filter((s) => !new RegExp(`"${s}": BYTES_PER_`).test(meterSrc))
    .concat(/\bnews: BYTES_PER_SYMBOL_NEWS\b/.test(meterSrc) ? [] : ["news"]);
  const ok = !missing.length && !sources.length;
  return [ok, ok ? `${METERED.length} read sites, 6 sources priced` : `unmetered: ${[...missing, ...sources.map((s) => `no bytes for ${s}`)].join("; ")}`];
}

// ─────────────────────────────────────────────────────────────────────────────
const builder = code(BUILDER);
const meter = code(METER);
const liteRaw = read(LITE);
const srcs5 = { route: code(ROUTE), grid: code(GRID), hook: code(HOOK), charts: code(CHARTS), protect: code(PROTECT) };
const srcs6 = Object.fromEntries([...new Set(METERED.map(([f]) => f))].map((f) => [f, code(f)]));
const renderSources = Object.fromEntries(RENDER_DIRS.flatMap(filesUnder).map((f) => [f, code(f)]));

console.log("\n1. No charts read on the payload path");
check("readPickersCache reads the hash only for unsummarised records, and attaches no bars", ...rule1(await runReadPickersCache(builder)));
check("no render path HGETALLs the charts hash", ...rule1b(renderSources));

console.log("\n2. The meter flushes on the cached path");
check("both cached returns flush before returning", ...rule2(builder));

console.log("\n3. The payload byte constant against the census");
check("within ±25% of 2.29 MB / 688 records, with provenance", ...rule3(meter));

console.log("\n4. The chart lite derives what the bars did");
check("rowBars over a lite equals rowBars over the bars", ...(await rule4(liteRaw)));

console.log("\n5. Candles for drawn rows only");
check("/api/picker-charts and the grid", ...rule5(srcs5));

console.log("\n6. The census's keyspaces are metered");
check("Tiingo EOD/pool/EOD-last, SEC facts, news, SEC fundamentals", ...rule6(srcs6, meter));

// ─── 7. Mutants ──────────────────────────────────────────────────────────────
console.log("\n7. Mutants (each must be caught)");
const caught = (label, [ok]) => check(`mutant caught: ${label}`, !ok);
const swap = (src, a, b) => {
  if (!src.includes(a)) throw new Error(`mutant anchor missing: ${a}`);
  return src.replace(a, b);
};

// 1: re-attach every record's bars (the bill this PR removes).
caught(
  "the hash read for every record",
  rule1(
    await runReadPickersCache(
      swap(builder, `.filter((record) => !record.chartLite && (!Array.isArray(record.chartPoints) || !record.chartPoints.length))`, `.filter(() => true)`)
    )
  )
);
caught(
  "bars attached on the rollout read",
  rule1(
    await runReadPickersCache(
      swap(builder, `{ ...record, chartLite: chartLiteOf(points) }`, `{ ...record, chartPoints: points, chartLite: chartLiteOf(points) }`)
    )
  )
);
caught(
  "the payload read unmetered",
  rule1(await runReadPickersCache(swap(builder, `await recordRedisRead("picker-payload", records.length, opts.caller);`, ``)))
);
caught("an HGETALL of the charts hash in a render file", rule1b({ ...renderSources, "lib/x.ts": `await redis.hgetall<Record<string, unknown>>(PICKER_CHARTS_KEY)` }));
caught("an HGETALL by the literal key", rule1b({ ...renderSources, "app/y.ts": `redis.hgetall("msh:picker-charts:v1")` }));

// 2: the cached path loses its flush; the route's too.
{
  const flushes = builder.match(/await flushRedisReadMeter\(\);?/g) ?? [];
  if (!flushes.length) throw new Error("no flush to mutate");
}
const pageFlush = fnText(builder, "getPickersData");
caught("getPickersData's cached path without the flush", rule2(builder.replace(pageFlush, pageFlush.replace(/await flushRedisReadMeter\(\);\s*return cached\.data;/, "return cached.data;"))));
const routeFn = fnText(builder, "handlePickersRequest");
caught("the route's cached path without the flush", rule2(builder.replace(routeFn, routeFn.replace(/await flushRedisReadMeter\(\);(?=[^]*?pickersWithoutBars\(cached\.data\))/, ""))));
caught("the flush after the return", rule2(builder.replace(pageFlush, pageFlush.replace(/await flushRedisReadMeter\(\);\s*return cached\.data;/, "return cached.data; await flushRedisReadMeter();"))));

// 3: the constant back at 2,000, or 30% high, or unsourced.
caught("payload constant at the old 2,000", rule3(swap(meter, "BYTES_PER_SYMBOL_PICKER_PAYLOAD = 3_329;", "BYTES_PER_SYMBOL_PICKER_PAYLOAD = 2_000;")));
caught("payload constant 30% high", rule3(swap(meter, "BYTES_PER_SYMBOL_PICKER_PAYLOAD = 3_329;", "BYTES_PER_SYMBOL_PICKER_PAYLOAD = 4_330;")));
caught("payload constant without its census", rule3(swap(meter, `BYTES_PER_SYMBOL_PICKER_PAYLOAD_CENSUS = "2026-10-12 `, `BYTES_PER_SYMBOL_PICKER_PAYLOAD_CENSUS = "`)));

// 4: the lite keeps too few closes for Stretch; drops the last bar's MA200.
caught("the lite keeps 10 closes", await rule4(swap(liteRaw, "export const CHART_LITE_CLOSES = 40;", "export const CHART_LITE_CLOSES = 10;")));
caught("the lite's MA200 from the first bar", await rule4(swap(liteRaw, "m: finite(last?.ma200)", "m: finite(points[0]?.ma200)")));
caught("the lite keeps the first closes, not the last", await rule4(swap(liteRaw, "points.slice(-CHART_LITE_CLOSES)", "points.slice(0, CHART_LITE_CLOSES)")));

// 5: uncapped route; whole-universe fetch; route without BotID; list rows fetched.
caught("route cap raised to 800", rule5({ ...srcs5, route: swap(srcs5.route, "const MAX_SYMBOLS = 30;", "const MAX_SYMBOLS = 800;") }));
caught("grid asks for every sorted row", rule5({ ...srcs5, grid: swap(srcs5.grid, "const barsWanted = shown", "const barsWanted = sortedEntries") }));
caught("grid asks in list view too", rule5({ ...srcs5, grid: swap(srcs5.grid, `viewMode === "chart" || expandedRows.has(e.symbol)`, `true`) }));
caught("route without BotID", rule5({ ...srcs5, route: swap(srcs5.route, "await isUnwantedBot()", "false") }));
caught("route missing from the protect list", rule5({ ...srcs5, protect: swap(srcs5.protect, `path: "/api/picker-charts"`, `path: "/api/other"`) }));
caught("the reader switched to HGETALL", rule5({ ...srcs5, charts: srcs5.charts + "\nredis.hgetall(PICKER_CHARTS_KEY);" }));

// 6: a read site unmetered; a source unpriced.
caught("Tiingo EOD GET unmetered", rule6({ ...srcs6, "lib/server/marketData/read.ts": swap(srcs6["lib/server/marketData/read.ts"], `recordRedisRead("tiingo-eod", 1,`, `void (1,`) }, meter));
caught("news MGET unmetered", rule6({ ...srcs6, "lib/server/newsStore.ts": swap(srcs6["lib/server/newsStore.ts"], `recordRedisRead("news", entries`, `void (entries`) }, meter));
caught("fact-set reads unmetered", rule6({ ...srcs6, "lib/server/pickersSecFundamentals.ts": swap(srcs6["lib/server/pickersSecFundamentals.ts"], `recordRedisRead("sec-facts", factSetsRead,`, `void (factSetsRead,`) }, meter));
caught("warm-pickers-sec without its flush", rule6({ ...srcs6, "app/api/jobs/warm-pickers-sec/route.ts": swap(srcs6["app/api/jobs/warm-pickers-sec/route.ts"], "await flushRedisReadMeter()", "void 0") }, meter));
caught("news without a byte figure", rule6(srcs6, swap(meter, "news: BYTES_PER_SYMBOL_NEWS", "newz: BYTES_PER_SYMBOL_NEWS")));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
