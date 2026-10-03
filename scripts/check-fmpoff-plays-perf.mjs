// FMP-OFF: THE /plays SCANS AND THE PICKERS PERFORMANCE TAB ON STORED TIINGO
// BARS (#553 CODE-B #94, FMP-off checklist B4 and B6).
//
// What must hold, and how each is shown:
//   B4 /plays, /plays/bull-flags, /plays/descending-triangles
//     1. EXECUTED (marketData/playsHistory.ts): with PRICE_PROVIDER_PICKERS=tiingo
//        the scan reads stored Tiingo bars; FMP is asked only for symbols Tiingo
//        has none for, and only with FMP_API_KEY set; a symbol's series is
//        Tiingo's whole (never spliced with FMP's); off the flag nothing is read
//        and the builder keeps its FMP path.
//     2. SOURCE (the three builders): the scan goes through playsTiingoHistory,
//        the Tiingo branch never touches the FMP reads, and the scan loop reads
//        through that branch.
//     3. SOURCE (the three pages + clients): the linked credit, under the flag.
//   B6 the Pickers Performance tab (1W/1M/6M/YTD/1Y)
//     4. EXECUTED (lib/pickerPerf.ts): the five windows on fixtures with known
//        answers; base = last close on or before the window start; every refused
//        period carries a TRUE reason, and "Not enough price history for this
//        period" is used only where the history really starts too late.
//     5. EXECUTED (applyPerf): on Tiingo the build's row replaces any FMP figure;
//        off Tiingo the stored figures stay.
//     6. SOURCE: the build computes `perf` from Tiingo-sourced series only; the
//        page skips stockDataCache's perf fields on the flag; FMP's
//        stock-price-change is not called on the flag; the grid's reason comes
//        from the row's code, never a hard-coded sentence.
//   7. Mutants: each rule above broken once, and caught.
//
//   node scripts/check-fmpoff-plays-perf.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const code = (f, src = read(f)) => stripComments(src, { file: f });

const PERF = "lib/pickerPerf.ts";
const PLAYS_HISTORY = "lib/server/marketData/playsHistory.ts";
const BUILDERS = ["lib/server/playsBuilder.ts", "lib/server/bullFlagsBuilder.ts", "lib/server/descendingTrianglesBuilder.ts"];
const PAGES = {
  "app/plays/page.tsx": ["PlaysClient", "app/plays/PlaysClient.tsx"],
  "app/plays/bull-flags/page.tsx": ["BullFlagsClient", "app/plays/bull-flags/BullFlagsClient.tsx"],
  "app/plays/descending-triangles/page.tsx": ["DescendingTrianglesClient", "app/plays/descending-triangles/DescendingTrianglesClient.tsx"],
};
const PICKERS_BUILDER = "lib/server/pickersBuilder.ts";
const PICKER_PAGE = "app/components/PickerResultPage.tsx";
const GRID = "app/components/PickerResultsGrid.tsx";
const STOCK_DATA = "lib/server/stockDataCache.ts";
const FALSE_REASON = "Not enough price history for this period";

let seq = 0;
/** Import a (possibly mutated) copy of a module from its own directory, so relative imports resolve. */
async function loadCopy(rel, src) {
  const file = path.join(ROOT, path.dirname(rel), `.check-fmpoff-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, src);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

// ── 1. the plays history, executed ──────────────────────────────────────────
const bar = (d, c) => [d, c, c, c, c, 100];
async function playsSuite(P) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const tiingoBars = { AAPL: [bar("2026-09-30", 10), bar("2026-10-01", 11)], "BRK-B": [bar("2026-10-01", 5)] };
  const fmpPts = { AAPL: [{ date: "2026-09-01", close: 99 }, { date: "2026-10-02", close: 98 }], NEW: [{ date: "2026-10-01", close: 7 }] };
  const universe = ["AAPL", "BRK.B", "NEW", "GONE"];
  const run = async (env) => {
    const reads = [];
    const fmpAsked = [];
    const readOne = async (s) => { reads.push(s); return tiingoBars[s] ? { asOf: "x", fetchedAt: 0, basis: "split", bars: tiingoBars[s] } : null; };
    const fmpOne = async (s) => { fmpAsked.push(s); return fmpPts[s] ?? []; };
    const r = await P.playsTiingoHistory(universe, fmpOne, { env, readOne });
    return { r, reads, fmpAsked };
  };

  const off = await run({ FMP_API_KEY: "k" });
  want("off the flag: null (the builder keeps its FMP path) and nothing is read", off.r === null && off.reads.length === 0 && off.fmpAsked.length === 0);
  const typo = await run({ PRICE_PROVIDER_PICKERS: "tiingoo", FMP_API_KEY: "k" });
  want("a typo is the FMP path", typo.r === null);

  const withKey = await run({ PRICE_PROVIDER_PICKERS: "tiingo", FMP_API_KEY: "k" });
  const r = withKey.r;
  want("on the flag the scan reads stored Tiingo bars", r && r.bySymbol.get("AAPL")?.map((p) => p.close).join() === "10,11", JSON.stringify(r?.bySymbol.get("AAPL")));
  want("no splice: AAPL's series is Tiingo's whole, with none of FMP's dates", r && r.bySymbol.get("AAPL")?.every((p) => p.date.startsWith("2026-09-30") || p.date.startsWith("2026-10-01")));
  want("BRK.B is read as BRK-B and returned as BRK.B", r && r.bySymbol.get("BRK.B")?.[0]?.close === 5);
  want("with FMP_API_KEY set, FMP is asked only for the symbols Tiingo lacks", withKey.fmpAsked.sort().join() === "GONE,NEW", withKey.fmpAsked.join());
  want("...and its series is FMP's whole", r && r.bySymbol.get("NEW")?.[0]?.close === 7 && r.bySymbol.get("NEW").length === 1);
  want("fromTiingo names the Tiingo-sourced symbols only", r && [...r.fromTiingo].sort().join() === "AAPL,BRK.B", r ? [...r.fromTiingo].join() : "");
  want("tier counts", r && JSON.stringify(r.stats) === JSON.stringify({ memory: 0, cache: 2, fmpFallback: 1, missing: 1 }), JSON.stringify(r?.stats));

  const noKey = await run({ PRICE_PROVIDER_PICKERS: "tiingo" });
  want("without FMP_API_KEY, FMP is never asked", noKey.fmpAsked.length === 0, noKey.fmpAsked.join());
  want("...and the residual drops out (missing), the Tiingo symbols still scan", noKey.r && noKey.r.stats.missing === 2 && noKey.r.bySymbol.size === 2, JSON.stringify(noKey.r?.stats));

  const broken = await P.playsTiingoHistory(["AAPL", "NEW"], async () => { throw new Error("fmp down"); }, {
    env: { PRICE_PROVIDER_PICKERS: "tiingo", FMP_API_KEY: "k" },
    readOne: async () => { throw new Error("redis down"); },
  });
  want("a failing read is a missing symbol, never a failed scan", broken && broken.stats.missing === 2, JSON.stringify(broken?.stats));
  return fails;
}

const playsSrc = read(PLAYS_HISTORY);
{
  const fails = await playsSuite(await loadCopy(PLAYS_HISTORY, playsSrc));
  for (const f of fails) check(f, false);
  check("B4: the plays history passes on the real module", fails.length === 0);
}

// ── 2. the three builders, on their code ────────────────────────────────────
function builderRules(f, src) {
  const c = code(f, src);
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(`${f}: ${label}`); };
  want("imports playsTiingoHistory", /import \{ playsTiingoHistory \} from "\.\/marketData\/playsHistory";/.test(c));
  want("the scan's history comes from playsTiingoHistory, with the FMP read as the residual path", /const tiingoScan = await playsTiingoHistory\(universe, getFmpHistoryForScan\);/.test(c));
  const start = c.indexOf("async function getHistoryForScan(symbol: string) {");
  const body = start >= 0 ? c.slice(start, c.indexOf("\n  }\n", start)) : "";
  want("getHistoryForScan found", body.length > 0);
  want("off the flag (tiingoScan null) it is the FMP path, unchanged", /^async function getHistoryForScan\(symbol: string\) \{\s*if \(!tiingoScan\) return getFmpHistoryForScan\(symbol\);/.test(body));
  const tiingoBranch = body.replace(/if \(!tiingoScan\) return getFmpHistoryForScan\(symbol\);/, "");
  want("the Tiingo branch reads Tiingo's series only (no FMP read, so no splice)", /tiingoScan\.bySymbol\.get\(symbol\)/.test(tiingoBranch) && !/getFmpHistoryForScan|getCachedDailyHistory|getDailyHistory|fetchHistory/.test(tiingoBranch));
  want("the scan loop reads through getHistoryForScan", /const dailyPoints = await getHistoryForScan\(symbol\);/.test(c));
  want("the payload records which provider the scan read", /history: tiingoScan \? \{ provider: "tiingo", \.\.\.tiingoScan\.stats \} : \{ provider: "fmp" \}/.test(c));
  return fails;
}
const builderSrcs = Object.fromEntries(BUILDERS.map((f) => [f, read(f)]));
{
  const fails = BUILDERS.flatMap((f) => builderRules(f, builderSrcs[f]));
  for (const f of fails) check(f, false);
  check("B4: the three builders scan through the Tiingo switch", fails.length === 0);
}

// ── 3. the credit on the three pages ────────────────────────────────────────
function creditRules(srcs) {
  const fails = [];
  for (const [page, [client, clientFile]] of Object.entries(PAGES)) {
    const p = code(page, srcs[page]);
    const cl = code(clientFile, srcs[clientFile]);
    if (!new RegExp(`<${client}\\s+initialPayload=\\{initialPayload\\}\\s+marketDataCredit=\\{\\s*priceProviderFor\\("PICKERS"\\) === "tiingo" \\? \\(\\s*<a href=\\{TIINGO_URL\\}[^>]*>\\{TIINGO_CREDIT\\}</a>\\s*\\) : null\\s*\\}`).test(p))
      fails.push(`${page} hands ${client} the linked credit under PRICE_PROVIDER_PICKERS`);
    if (!/marketDataCredit \? <> · \{marketDataCredit\}<\/> : null/.test(cl)) fails.push(`${clientFile} renders the credit in its footer`);
  }
  return fails;
}
const creditFiles = Object.entries(PAGES).flatMap(([p, [, c]]) => [p, c]);
const creditSrcs = Object.fromEntries(creditFiles.map((f) => [f, read(f)]));
{
  const fails = creditRules(creditSrcs);
  for (const f of fails) check(f, false);
  check("B4: the three plays pages carry the linked Tiingo credit", fails.length === 0);
}

// ── 4/5. the Performance windows, executed ──────────────────────────────────
function weekdays(from, to, close) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, close: close(iso) });
  }
  return out;
}
// Known answers. Last close 2026-10-02 (Fri) = 120. Every other bar is 1000, so
// a wrong base shows up as a wildly wrong number.
const KNOWN = { "2026-10-02": 120, "2026-09-25": 100, "2026-09-02": 96, "2026-04-02": 80, "2025-12-31": 150, "2025-10-02": 60 };
const FIXTURE = weekdays("2025-09-01", "2026-10-02", (d) => KNOWN[d] ?? 1000);
const EXPECT = { perf1w: 20, perf1m: 25, perf6m: 50, perfYtd: -20, perf1y: 100 };

async function perfSuite(M) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const keys = M.PERF_KEYS;
  want("the five keys, in tab order", keys.join() === "perf1w,perf1m,perf6m,perfYtd,perf1y", keys.join());

  const r = M.computePerfFromBars([...FIXTURE].reverse());
  const got = Object.fromEntries(keys.map((k, i) => [k, r.v[i]]));
  want("1W/1M/6M/YTD/1Y on the fixture match the known answers", JSON.stringify(got) === JSON.stringify(EXPECT), JSON.stringify(got));
  want("labelled by the close they run to", r.asOf === "2026-10-02" && M.perfAsOfLabel(r.asOf) === "to the close of 2 Oct 2026", `${r.asOf} / ${M.perfAsOfLabel(r.asOf)}`);
  want("no reason on a computed period", r.why.every((w) => w === null), JSON.stringify(r.why));

  // The base is the last close ON OR BEFORE the window start (a holiday).
  const holiday = M.computePerfFromBars(FIXTURE.filter((p) => p.date !== "2026-09-25").map((p) => (p.date === "2026-09-24" ? { ...p, close: 96 } : p)));
  want("a missing start day takes the close before it", holiday.v[0] === 25, String(holiday.v[0]));

  want("month arithmetic clamps to month end", M.perfWindowStart("perf1m", "2026-03-31") === "2026-02-28" && M.perfWindowStart("perf6m", "2026-08-31") === "2026-02-28" && M.perfWindowStart("perf1y", "2024-02-29") === "2023-02-28" && M.perfWindowStart("perfYtd", "2026-01-05") === "2025-12-31" && M.perfWindowStart("perf1w", "2026-01-02") === "2025-12-26");

  // TRUE REASONS.
  const short = M.computePerfFromBars(FIXTURE.filter((p) => p.date >= "2026-03-02"));
  want("history starting after the window: 'short' for YTD and 1Y only", JSON.stringify(short.why) === JSON.stringify([null, null, null, "short", "short"]), JSON.stringify(short.why));
  const gappy = M.computePerfFromBars(FIXTURE.filter((p) => p.date <= "2025-09-05" || p.date >= "2026-09-01"));
  want("a hole at the window start is 'gap', not 'short'", JSON.stringify(gappy.why) === JSON.stringify([null, null, "gap", "gap", "gap"]), JSON.stringify(gappy.why));
  const none = M.computePerfFromBars([{ date: "2026-10-01", close: 0 }, { date: "bad", close: 5 }]);
  want("no usable bars: 'noBars' on all five", none.asOf === null && none.why.every((w) => w === "noBars") && none.v.every((v) => v === null), JSON.stringify(none));
  want("the false reason belongs to 'short' alone", M.perfWhyText("short") === FALSE_REASON && Object.entries(M.PERF_WHY_WORDS).filter(([, w]) => w === FALSE_REASON).map(([k]) => k).join() === "short");
  want("every code has words", ["short", "gap", "noBars", "notBuilt", "noCache"].every((c) => typeof M.perfWhyText(c) === "string" && M.perfWhyText(c).length > 10));

  // applyPerf: Tiingo replaces FMP; off Tiingo the stored figures stay.
  const e1 = { perf1w: 9.9, perf1m: 8.8, perf6m: 7.7, perfYtd: 6.6, perf1y: 5.5 };
  M.applyPerf(e1, short, true);
  want("on Tiingo the build's row replaces every FMP figure", e1.perf1w === 20 && e1.perf6m === 50 && !("perfYtd" in e1) && !("perf1y" in e1) && e1.perfWhy?.perfYtd === "short" && e1.perfAsOf === "2026-10-02", JSON.stringify(e1));
  const e2 = { perf1w: 9.9 };
  M.applyPerf(e2, undefined, true);
  want("on Tiingo a row with no build figures shows none of FMP's, and says 'notBuilt'", !("perf1w" in e2) && e2.perfWhy?.perf1w === "notBuilt", JSON.stringify(e2));
  const e3 = { perf1w: 9.9, perfAsOf: "2026-10-02" };
  M.applyPerf(e3, r, false);
  want("off Tiingo the stored figures stay and the build's row is ignored", e3.perf1w === 9.9 && e3.perfWhy?.perf1m === "noCache" && !("perfAsOf" in e3), JSON.stringify(e3));
  return fails;
}
const perfSrc = read(PERF);
{
  const fails = await perfSuite(await loadCopy(PERF, perfSrc));
  for (const f of fails) check(f, false);
  check("B6: the Performance windows and reasons pass on the real module", fails.length === 0);
}

// ── 6. the build, the page, the FMP call, the grid ──────────────────────────
function b6Rules(srcs) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const b = code(PICKERS_BUILDER, srcs[PICKERS_BUILDER]);
  want("the build takes fromTiingo from the Tiingo history tiers", /historyBySymbol = got\.bySymbol;\s*perfFromTiingo = got\.fromTiingo;/.test(b));
  want("perf is computed only for Tiingo-sourced series", /const perf: PerfRow \| undefined = perfFromTiingo\s*\?\s*perfFromTiingo\.has\(symbol\)\s*\?\s*computePerfFromBars\(pts\)\s*:\s*perfRowRefused\("noBars"\)\s*:\s*undefined;/.test(b));
  want("each signal record carries perf", /isPopularSearch: popularName,\s*perf,\s*\}\);/.test(b));

  const p = code(PICKER_PAGE, srcs[PICKER_PAGE]);
  want("the page's switch is PRICE_PROVIDER_PICKERS", /const perfOnTiingo = priceProviderFor\("PICKERS"\) === "tiingo";/.test(p));
  const perfLines = p.match(/if \(d\.perf(1w|1m|6m|Ytd|1y) != null\) entry\.perf\1 = d\.perf\1;/g) ?? [];
  want("stockDataCache's five perf fields are applied only off the flag", perfLines.length === 5 && /if \(!perfOnTiingo\) \{\s*(if \(d\.perf\w+ != null\) entry\.perf\w+ = d\.perf\w+;\s*){5}\}/.test(p));
  want("every entry takes the build's row through applyPerf", /for \(const entry of entries\) applyPerf\(entry, perfBySymbol\.get\(entry\.symbol\), perfOnTiingo\);/.test(p));
  want("the row map is keyed from signalRecords' perf", /if \(symbol && record\.perf\) perfBySymbol\.set\(symbol, record\.perf\);/.test(p));

  const s = code(STOCK_DATA, srcs[STOCK_DATA]);
  want("FMP stock-price-change is not called on the flag", /if \(priceProviderFor\("PICKERS"\) !== "tiingo"\) \{\s*try \{\s*const row = firstRow\(await fetchJson\(`\$\{base\}\/stock-price-change/.test(s));

  const g = code(GRID, srcs[GRID]);
  for (const k of ["perf1w", "perf1m", "perf6m", "perfYtd", "perf1y"]) want(`the grid's ${k} cell goes through perfCell`, new RegExp(`key: "${k}"[^\\n]*cell: \\(e\\) => perfCell\\(e, "${k}"\\) \\}`).test(g));
  want("perfCell's reason is the row's own code", /const why = perfWhyText\(e\.perfWhy\?\.\[key\]\);/.test(g));
  want("perfCell labels a return with its close", /const asOf = perfAsOfLabel\(e\.perfAsOf\);/.test(g));
  const hardCoded = Object.entries(srcs).filter(([f, src]) => f !== PERF && code(f, src).includes(FALSE_REASON)).map(([f]) => f);
  want(`nobody hard-codes "${FALSE_REASON}" outside lib/pickerPerf.ts${hardCoded.length ? ` (${hardCoded.join(", ")})` : ""}`, hardCoded.length === 0);
  return fails;
}
const b6Files = [PICKERS_BUILDER, PICKER_PAGE, GRID, STOCK_DATA];
const b6Srcs = Object.fromEntries(b6Files.map((f) => [f, read(f)]));
{
  const fails = b6Rules(b6Srcs);
  for (const f of fails) check(f, false);
  check("B6: build, page, FMP call and grid hold", fails.length === 0);
}

// ── 7. mutants ──────────────────────────────────────────────────────────────
const mutate = (src, from, to, label) => {
  const m = src.replace(from, to);
  if (m === src) check(`mutant "${label}" applies`, false, "the replacement matched nothing");
  return m === src ? null : m;
};

const EXEC_MUTANTS = [
  [PLAYS_HISTORY, playsSrc, playsSuite, "FMP fallback without the key", /const fmpBulk = env\.FMP_API_KEY\s*\?/, "const fmpBulk = true ?"],
  [PLAYS_HISTORY, playsSrc, playsSuite, "the scan ignores the flag", /if \(priceProviderFor\("PICKERS", env\) !== "tiingo"\) return null;/, ""],
  [PLAYS_HISTORY, playsSrc, playsSuite, "the scan never switches", /if \(priceProviderFor\("PICKERS", env\) !== "tiingo"\) return null;/, "return null;"],
  [PERF, perfSrc, perfSuite, "1W counts 5 days, not 7", /return isoDay\(t - 7 \* DAY_MS\);/, "return isoDay(t - 5 * DAY_MS);"],
  [PERF, perfSrc, perfSuite, "the base is the close after the start", /if \(rows\[i\]\.t <= start\) \{ base = rows\[i\]; break; \}/, "if (rows[i].t <= start) { base = rows[Math.min(i + 1, rows.length - 1)]; break; }"],
  [PERF, perfSrc, perfSuite, "YTD from Jan 1 of this year", /return `\$\{new Date\(t\)\.getUTCFullYear\(\) - 1\}-12-31`;/, "return `${new Date(t).getUTCFullYear()}-01-01`;"],
  [PERF, perfSrc, perfSuite, "a gap reported as 'short' (the false reason)", /v\.push\(null\); why\.push\("gap"\);/, 'v.push(null); why.push("short");'],
  [PERF, perfSrc, perfSuite, "every code reads 'Not enough price history'", /gap: "No stored close near the start of this period",/, `gap: "${FALSE_REASON}",`],
  [PERF, perfSrc, perfSuite, "on Tiingo an FMP figure survives a refused period", /else \{\s*delete entry\[key\];/, "else {"],
  [PERF, perfSrc, perfSuite, "the label drops the close date", /return `to the close of \$\{Number\(m\[3\]\)\} \$\{MONTHS\[Number\(m\[2\]\) - 1\]\} \$\{m\[1\]\}`;/, "return \"latest\";"],
];
for (const [file, src, suite, label, from, to] of EXEC_MUTANTS) {
  const m = mutate(src, from, to, label);
  if (!m) continue;
  let fails;
  try { fails = await suite(await loadCopy(file, m)); } catch (e) { fails = [`threw: ${e.message}`]; }
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

const SRC_MUTANTS = [
  ["the Tiingo branch splices FMP into the series", "builder", BUILDERS[0], /tiingoScan\.bySymbol\.get\(symbol\) \?\? \[\]/, "[...(await getFmpHistoryForScan(symbol)), ...(tiingoScan.bySymbol.get(symbol) ?? [])]"],
  ["bull flags never switch", "builder", BUILDERS[1], /if \(!tiingoScan\) return getFmpHistoryForScan\(symbol\);/, "return getFmpHistoryForScan(symbol);"],
  ["descending triangles skip the Tiingo read", "builder", BUILDERS[2], /const tiingoScan = await playsTiingoHistory\(universe, getFmpHistoryForScan\);/, "const tiingoScan = null as Awaited<ReturnType<typeof playsTiingoHistory>>;"],
  ["/plays drops its credit", "credit", "app/plays/page.tsx", /<a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a>/, "null"],
  ["the bull-flags credit is unlinked", "credit", "app/plays/bull-flags/page.tsx", /<a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a>/, "<span>{TIINGO_CREDIT}</span>"],
  ["the descending-triangles client never renders it", "credit", "app/plays/descending-triangles/DescendingTrianglesClient.tsx", /\s*\{marketDataCredit \? <> · \{marketDataCredit\}<\/> : null\}/, ""],
  ["the page takes FMP's perf on the flag", "b6", PICKER_PAGE, /if \(!perfOnTiingo\) \{/, "if (true) {"],
  ["perf from FMP-fallback series", "b6", PICKERS_BUILDER, /perfFromTiingo\.has\(symbol\)\s*\?/, "true ?"],
  ["stock-price-change still called on the flag", "b6", STOCK_DATA, /if \(priceProviderFor\("PICKERS"\) !== "tiingo"\) \{/, "if (true) {"],
  ["the grid shows the false reason for every empty perf cell", "b6", GRID, /const why = perfWhyText\(e\.perfWhy\?\.\[key\]\);/, `const why = "${FALSE_REASON}";`],
  ["a perf column bypasses perfCell", "b6", GRID, /cell: \(e\) => perfCell\(e, "perfYtd"\) \}/, "cell: (e) => pctCell(num(e.perfYtd)) }"],
];
for (const [label, kind, file, from, to] of SRC_MUTANTS) {
  const base = kind === "builder" ? builderSrcs : kind === "credit" ? creditSrcs : b6Srcs;
  const m = mutate(base[file], from, to, label);
  if (!m) continue;
  const next = { ...base, [file]: m };
  const fails = kind === "builder" ? BUILDERS.flatMap((f) => builderRules(f, next[f])) : kind === "credit" ? creditRules(next) : b6Rules(next);
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
