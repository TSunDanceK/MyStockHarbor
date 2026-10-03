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
//   #553 COWORK #103 (the #689 blocker): "Tiingo-derived bars and returns don't
//   go out through public JSON; pages read them in-process."
//     8. EXECUTED (lib/playsPublic.ts): the public plays shape has no
//        chartPoints unless the payload says it was built from FMP (fail
//        closed), never mutates the in-process memo; the credit follows the
//        payload's recorded provider; the client's refresh keeps the server
//        props' bars or reads in-process, never adopting route bars it lacks.
//     9. EXECUTED (the three REAL route handlers, stubbed I/O): no response
//        carries chartPoints from a Tiingo-built payload; an FMP one is as was.
//    10. EXECUTED (the REAL server actions, stubbed builders): the pages'
//        in-process read keeps the bars, and never builds (cacheOnly).
//    11. EXECUTED (the REAL handlePickersRequest + getPickersData, stubbed
//        I/O): no /api/pickers answer carries signalRecords[].perf, on every
//        payload path; the in-process read the Pickers pages use still does.
//    12. SOURCE: the clients refresh through resolvePlaysRefresh with their own
//        server action and gate the credit on playsBarsFromTiingo(history).
//    13. Mutants for 8-12, each caught.
//
//   node scripts/check-fmpoff-plays-perf.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
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
    // #103: the page hands the linked credit over; the CLIENT shows it only
    // while the payload on screen records Tiingo bars (not on the flag alone).
    if (!new RegExp(`<${client}\\s+initialPayload=\\{initialPayload\\}\\s+marketDataCredit=\\{\\s*<a href=\\{TIINGO_URL\\}[^>]*>\\{TIINGO_CREDIT\\}</a>\\s*\\}`).test(p))
      fails.push(`${page} hands ${client} the linked credit`);
    if (/priceProviderFor\(/.test(p)) fails.push(`${page} decides the credit from the flag, not from the bars`);
    if (!/\{marketDataCredit && playsBarsFromTiingo\(history\) \? <> · \{marketDataCredit\}<\/> : null\}/.test(cl)) fails.push(`${clientFile} renders the credit only when the payload's bars are Tiingo's`);
    if (!/const \[history, setHistory\] = useState<PlaysHistoryInfo>\(initialPayload\?\.history \?\? null\);/.test(cl)) fails.push(`${clientFile} seeds the credit's provider from the server payload`);
    if (!/setHistory\(data\.history \?\? null\);/.test(cl)) fails.push(`${clientFile} moves the credit's provider with the payload it shows`);
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
  ["the descending-triangles client never renders it", "credit", "app/plays/descending-triangles/DescendingTrianglesClient.tsx", /\s*\{marketDataCredit && playsBarsFromTiingo\(history\) \? <> · \{marketDataCredit\}<\/> : null\}/, ""],
  ["the /plays credit shows whenever handed over (the flag decides)", "credit", "app/plays/PlaysClient.tsx", /\{marketDataCredit && playsBarsFromTiingo\(history\) \?/, "{marketDataCredit ?"],
  ["the bull-flags page gates the credit on the flag again", "credit", "app/plays/bull-flags/page.tsx", /marketDataCredit=\{\s*<a href/, 'marketDataCredit={priceProviderFor("PICKERS") === "tiingo" && <a href'],
  ["the descending-triangles credit keeps the first payload's provider", "credit", "app/plays/descending-triangles/DescendingTrianglesClient.tsx", /setHistory\(data\.history \?\? null\);/, ""],
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

// ═════ #553 COWORK #103: NO TIINGO BARS OR RETURNS IN PUBLIC JSON ═══════════
const PUBLIC = "lib/playsPublic.ts";
const ACTIONS = "app/plays/playsPagePayload.ts";
const ROUTES = {
  "app/api/plays/route.ts": "getPlaysData",
  "app/api/bull-flags/route.ts": "getBullFlagsData",
  "app/api/descending-triangles/route.ts": "getDescendingTrianglesData",
};
const CLIENTS = {
  "app/plays/PlaysClient.tsx": "readPlaysPagePayload",
  "app/plays/bull-flags/BullFlagsClient.tsx": "readBullFlagsPagePayload",
  "app/plays/descending-triangles/DescendingTrianglesClient.tsx": "readDescendingTrianglesPagePayload",
};

/** Every key anywhere in a JSON-serialised value. */
function keysIn(value) {
  const out = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); walk(x); }
  };
  walk(JSON.parse(JSON.stringify(value)));
  return out;
}

/** A TS module's source with its import declarations removed (the bench supplies them). */
function withoutImports(src, file) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let out = src;
  for (const st of [...sf.statements].filter(ts.isImportDeclaration).reverse()) out = out.slice(0, st.getStart(sf)) + out.slice(st.getEnd());
  return out.replace(/^\s*["']use server["'];?/, "");
}
async function importTs(src) {
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

// The fixtures: a payload as the builders write it. Tiingo-built, FMP-built,
// and one that does not say (a pre-#689 cache entry).
const pts = (n) => Array.from({ length: n }, (_, i) => ({ date: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, close: 10 + i, high: 11 + i, low: 9 + i, volume: 1000 + i }));
const item = (symbol) => ({ symbol, timeframe: "D", score: 80, tone: "green", note: "n", latestClose: 12, chartPoints: pts(280), dashboardHref: `/?s=${symbol}` });
const playsPayload = (history) => ({
  updatedAt: "2026-10-02T21:00:00.000Z",
  universeSize: 700,
  ...(history ? { history } : {}),
  sections: [
    { title: "Daily", description: "d", foundCount: 2, shownCount: 2, items: [item("AAPL"), item("MSFT")] },
    { title: "Weekly", description: "w", foundCount: 1, shownCount: 1, items: [item("NVDA")] },
  ],
});
const TIINGO_HISTORY = { provider: "tiingo", memory: 0, cache: 690, fmpFallback: 4, missing: 6 };
const FMP_HISTORY = { provider: "fmp" };

// ── 8. lib/playsPublic.ts, executed ─────────────────────────────────────────
async function publicSuite(M) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  const tiingo = playsPayload(TIINGO_HISTORY);
  const before = JSON.stringify(tiingo);
  const pub = M.publicPlaysPayload(tiingo);
  want("a Tiingo-built payload goes out with no chartPoints anywhere", !keysIn(pub).has("chartPoints"));
  want("...and says so (chartPointsWithheld)", pub.chartPointsWithheld === true);
  want("...keeping everything else (items, scores, history, updatedAt)", pub.sections?.[0]?.items?.[1]?.symbol === "MSFT" && pub.sections[0].items[0].score === 80 && pub.history?.provider === "tiingo" && pub.updatedAt === tiingo.updatedAt);
  want("the in-process payload (the builder's memo) is not mutated: the page keeps its bars", JSON.stringify(tiingo) === before && tiingo.sections[0].items[0].chartPoints.length === 280);

  const unsaid = M.publicPlaysPayload(playsPayload(null));
  want("a payload that does not record its provider is treated as Tiingo's (fail closed)", !keysIn(unsaid).has("chartPoints") && unsaid.chartPointsWithheld === true);
  const odd = M.publicPlaysPayload(playsPayload({ provider: "tiingoo" }));
  want("an unknown provider is withheld too", !keysIn(odd).has("chartPoints"));

  const fmp = playsPayload(FMP_HISTORY);
  want("an FMP-built payload is served as it was", M.publicPlaysPayload(fmp) === fmp && keysIn(fmp).has("chartPoints"));
  const err = { error: "x" };
  want("an error payload passes through", M.publicPlaysPayload(err) === err);

  // THE CREDIT FOLLOWS THE BARS.
  want("credit: on a Tiingo-built payload", M.playsBarsFromTiingo(TIINGO_HISTORY) === true);
  want("credit: not on an FMP-built one", M.playsBarsFromTiingo(FMP_HISTORY) === false);
  want("credit: not when the payload does not say", M.playsBarsFromTiingo(undefined) === false && M.playsBarsFromTiingo(null) === false);
  want("credit: not when every series came from the FMP fallback", M.playsBarsFromTiingo({ provider: "tiingo", memory: 0, cache: 0, fmpFallback: 690, missing: 10 }) === false);
  want("credit: never on a non-Tiingo provider, whatever counts it carries", M.playsBarsFromTiingo({ provider: "fmp", memory: 5, cache: 5 }) === false);
  want("credit: from the memory tier counts", M.playsBarsFromTiingo({ provider: "tiingo", memory: 3, cache: 0 }) === true);

  // THE CLIENT'S REFRESH.
  let reads = 0;
  const inProcess = (p) => async () => { reads++; return p; };
  const same = await M.resolvePlaysRefresh(pub, tiingo.updatedAt, inProcess(tiingo));
  want("same scan as the server props: keep what is on screen (null), no extra read", same === null && reads === 0, `${same} / ${reads} reads`);
  reads = 0;
  const newer = await M.resolvePlaysRefresh(pub, "2026-10-01T21:00:00.000Z", inProcess(tiingo));
  want("a newer scan is read in-process, bars included", newer === tiingo && reads === 1 && newer.sections[0].items[0].chartPoints.length === 280);
  reads = 0;
  const cold = await M.resolvePlaysRefresh(pub, null, inProcess(tiingo));
  want("nothing on screen yet: read in-process", cold === tiingo && reads === 1);
  const failed = await M.resolvePlaysRefresh(pub, null, async () => { throw new Error("action down"); });
  want("a failed in-process read shows the route's payload, which still has no bars", failed === pub && !keysIn(failed).has("chartPoints"));
  const empty = await M.resolvePlaysRefresh(pub, null, async () => null);
  want("an empty in-process read shows the route's payload", empty === pub);
  const stillWithheld = await M.resolvePlaysRefresh(pub, null, async () => pub);
  want("an in-process read without bars is not taken for one with them", stillWithheld === pub);
  reads = 0;
  const fmpRoute = await M.resolvePlaysRefresh(fmp, tiingo.updatedAt, inProcess(tiingo));
  want("an FMP route payload (bars kept) is shown as is, no extra read", fmpRoute === fmp && reads === 0);
  return fails;
}
const publicSrc = read(PUBLIC);
{
  const fails = await publicSuite(await loadCopy(PUBLIC, publicSrc));
  for (const f of fails) check(f, false);
  check("#103: the public plays shape, the credit rule and the client refresh pass on the real module", fails.length === 0);
}

// ── 9. the three REAL route handlers, stubbed I/O ───────────────────────────
const fakeReq = (params = {}) => ({
  headers: { get: () => null },
  nextUrl: { searchParams: new URLSearchParams(params) },
});
async function routeSuite(srcs) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  for (const [route, builderFn] of Object.entries(ROUTES)) {
    const prelude = `
export const bench = { data: null, calls: [] };
const NextResponse = { json: (data, init) => ({ data, status: init?.status ?? 200, headers: init?.headers ?? {} }) };
const isUnwantedBot = async () => false;
const getClientIp = () => "1.2.3.4";
const checkBackfillLockout = async () => ({ locked: false, retryAfterSeconds: 0 });
const recordBackfillFailure = async () => {};
const clearBackfillFailures = async () => {};
const checkBackfillKey = () => false;
const ${builderFn} = async (origin, opts) => { bench.calls.push(opts); return { data: bench.data, headers: { "Cache-Control": "public, s-maxage=60" }, status: 200 }; };
`;
    let m;
    try {
      m = await importTs(`${prelude}\n${withoutImports(srcs[PUBLIC], PUBLIC)}\n${withoutImports(srcs[route], route)}`);
    } catch (e) {
      want(`${route} loads on the bench`, false, e.message);
      continue;
    }
    for (const req of [fakeReq(), fakeReq({ debugSymbol: "AAPL" }), fakeReq({ force: "1", key: "wrong" })]) {
      const memo = playsPayload(TIINGO_HISTORY);
      m.bench.data = memo;
      const res = await m.GET(req);
      const q = [...req.nextUrl.searchParams.keys()].join("+") || "plain";
      want(`${route} (${q}): a Tiingo-built answer carries no chartPoints`, !keysIn(res.data).has("chartPoints"));
      want(`${route} (${q}): it still answers the scan (sections, items)`, res.data?.sections?.[0]?.items?.length === 2);
      want(`${route} (${q}): the builder's in-process payload keeps its bars`, memo.sections[0].items[0].chartPoints.length === 280);
    }
    m.bench.data = playsPayload(null);
    want(`${route}: an answer that does not record its provider carries no chartPoints`, !keysIn((await m.GET(fakeReq())).data).has("chartPoints"));
    const fmp = playsPayload(FMP_HISTORY);
    m.bench.data = fmp;
    const fres = await m.GET(fakeReq());
    want(`${route}: an FMP-built answer is as it was`, fres.data === fmp);
  }
  return fails;
}
const routeSrcs = { [PUBLIC]: publicSrc, ...Object.fromEntries(Object.keys(ROUTES).map((f) => [f, read(f)])) };
{
  const fails = await routeSuite(routeSrcs);
  for (const f of fails) check(f, false);
  check("#103: the three real plays routes serve no Tiingo chartPoints", fails.length === 0);
}

// ── 10. the REAL server actions: the pages' in-process read ─────────────────
async function actionSuite(src) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const prelude = `
export const bench = { data: null, calls: [], status: 200 };
const stub = (name) => async (origin, opts) => { bench.calls.push({ name, opts }); return { data: bench.data, headers: {}, status: bench.status }; };
const getPlaysData = stub("getPlaysData");
const getBullFlagsData = stub("getBullFlagsData");
const getDescendingTrianglesData = stub("getDescendingTrianglesData");
`;
  let m;
  try {
    m = await importTs(`${prelude}\n${withoutImports(src, ACTIONS)}`);
  } catch (e) {
    return [`${ACTIONS} loads on the bench — ${e.message}`];
  }
  for (const [fn, builderFn] of [["readPlaysPagePayload", "getPlaysData"], ["readBullFlagsPagePayload", "getBullFlagsData"], ["readDescendingTrianglesPagePayload", "getDescendingTrianglesData"]]) {
    if (typeof m[fn] !== "function") { want(`${fn} is exported`, false); continue; }
    m.bench.calls = [];
    m.bench.status = 200;
    m.bench.data = playsPayload(TIINGO_HISTORY);
    const got = await m[fn]();
    want(`${fn}: the page's in-process read keeps the bars`, got?.sections?.[0]?.items?.[0]?.chartPoints?.length === 280);
    want(`${fn}: reads its own builder, cache-only (never builds)`, m.bench.calls.length === 1 && m.bench.calls[0].name === builderFn && m.bench.calls[0].opts?.cacheOnly === true, JSON.stringify(m.bench.calls));
    m.bench.status = 503;
    m.bench.data = {};
    want(`${fn}: a cache miss is null, not an empty scan`, (await m[fn]()) === null);
  }
  return fails;
}
const actionsSrc = read(ACTIONS);
{
  const fails = await actionSuite(actionsSrc);
  for (const f of fails) check(f, false);
  const c = code(ACTIONS, actionsSrc);
  check("#103: the in-process read is a server action (no public JSON endpoint)", /^"use server";/.test(actionsSrc.trimStart()) && !/publicPlaysPayload/.test(c));
  check("#103: the pages' server actions read the bars in-process", fails.length === 0);
}

// ── 11. the REAL /api/pickers handler and getPickersData, stubbed I/O ───────
function grabFns(src, file, names) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = {};
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text)) out[n.name.text] = n.getText(sf).replace(/^export\s+/, "");
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
const PICKERS_FNS = ["isDegradedBuild", "recordBuildStats", "getPickersData", "handlePickersRequest", "isCronAuthorized", "GET"];
const PICKERS_PRELUDE = `
const console = { log: () => {}, warn: () => {}, error: () => {} };
const DEGRADED_BUILD_FAILURE_RATIO = 0.15;
let MEMORY_CACHE_MS = 0;
const CACHE_SECONDS = 60;
const STALE_SECONDS = 120;
let memo = null;
export const bench = {};
const readPickersCache = async () => bench.cache;
const writePickersCache = async () => {};
const buildReducedPickersPayload = (d) => d;
const acquirePickersLock = async () => bench.lock;
const releasePickersLock = async () => {};
const flushRedisReadMeter = async () => {};
const recordBuildTrigger = async () => {};
const PICKERS_LOCK_TTL_SECONDS = 120;
const PICKERS_MAX_WAIT_MS = 12_000;
const pickersBuildGate = () => bench.gate;
const readPickersLastGood = async () => bench.lastGood;
const waitForPickersPayload = async () => bench.published;
const buildPickersPayload = async () => { if (bench.buildThrows) throw new Error("build failed"); return bench.built; };
const originFromReq = () => "https://example.test";
const getClientIp = () => "1.2.3.4";
const checkBackfillLockout = async () => ({ locked: false, retryAfterSeconds: 0 });
const recordBackfillFailure = async () => {};
const clearBackfillFailures = async () => {};
const checkBackfillKey = () => bench.keyOk === true;
const NextResponse = { json: (data, init) => ({ data, status: init?.status ?? 200, headers: init?.headers ?? {} }) };
let lastBuildStats = null;
export const reset = (over) => { memo = null; MEMORY_CACHE_MS = 0; Object.keys(bench).forEach((k) => delete bench[k]); Object.assign(bench, { cache: null, lock: "token", gate: "allowed", lastGood: null, published: null, built: null, buildThrows: false }, over); };
export const keepMemo = () => { MEMORY_CACHE_MS = 1e9; };
`;
const perfRow = { asOf: "2026-10-02", v: [1, 2, 3, 4, 5], why: [null, null, null, null, null] };
const pickersPayload = (label, degradedSymbolPct = 0) => ({
  label,
  degradedSymbolPct,
  sections: [{ title: "s", items: [{ symbol: "AAPL" }] }],
  signalRecords: [{ symbol: "AAPL", perf: perfRow, note: "a" }, { symbol: "MSFT", perf: { ...perfRow }, note: "m" }, { symbol: "OLD", note: "no perf" }],
});
async function pickersSuite(builderSrc, perfModSrc) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const fns = grabFns(builderSrc, PICKERS_BUILDER, PICKERS_FNS);
  const missing = PICKERS_FNS.filter((n) => !fns[n]);
  if (missing.length) return [`could not extract ${missing.join(", ")} from ${PICKERS_BUILDER}`];
  let m;
  try {
    m = await importTs(`${PICKERS_PRELUDE}\n${withoutImports(perfModSrc, PERF)}\n${PICKERS_FNS.map((n) => fns[n]).join("\n\n")}\nexport { getPickersData, GET };`);
  } catch (e) {
    return [`the pickers bench loads — ${e.message}`];
  }
  const mkReq = (params = {}) => ({ nextUrl: { searchParams: new URLSearchParams(params) }, headers: { get: () => null }, url: "https://example.test/api/pickers" });
  const req = mkReq();
  // The degraded and build-threw fallbacks serve the cached payload only when a
  // build ran over a good cache: an owner-keyed ?force=1.
  const forced = mkReq({ force: "1", key: "k" });
  const PATHS = [
    ["fresh build", req, "fresh", { built: pickersPayload("fresh") }],
    ["cached payload", req, "cached", { cache: { data: pickersPayload("cached") } }],
    ["preview's last-good", req, "lastGood", { gate: "preview", lastGood: { data: pickersPayload("lastGood") } }],
    ["lock lost, waits for the published payload", req, "published", { lock: null, published: { data: pickersPayload("published") } }],
    ["forced, degraded build keeps the cached one", forced, "cached", { keyOk: true, built: pickersPayload("degraded", 50), cache: { data: pickersPayload("cached") } }],
    ["forced, build throws, cached served", forced, "cached", { keyOk: true, buildThrows: true, cache: { data: pickersPayload("cached") } }],
  ];
  for (const [label, r, expect, over] of PATHS) {
    m.reset(over);
    const res = await m.GET(r);
    want(`/api/pickers (${label}): answers the ${expect} payload`, res.data?.label === expect, JSON.stringify(res.data?.label));
    want(`/api/pickers (${label}): no signalRecords[].perf`, Array.isArray(res.data?.signalRecords) && res.data.signalRecords.length === 3 && !keysIn(res.data).has("perf"));
  }
  // The memo path: a second request inside MEMORY_CACHE_MS.
  m.reset({ built: pickersPayload("memo") });
  m.keepMemo();
  await m.GET(req);
  const again = await m.GET(req);
  want("/api/pickers (memo): no signalRecords[].perf", again.data?.label === "memo" && !keysIn(again.data).has("perf"));

  // The pages' in-process read is untouched: getPickersData keeps perf.
  m.reset({ cache: { data: pickersPayload("cached") } });
  const inProc = await m.getPickersData("o");
  want("getPickersData (what PickerResultPage reads): perf is still there", inProc?.signalRecords?.[0]?.perf?.v?.join() === "1,2,3,4,5");
  m.reset({ cache: { data: pickersPayload("cached") } });
  const cachedPayload = (await m.getPickersData("o"));
  await m.GET(req);
  want("serving /api/pickers does not strip the shared payload", cachedPayload.signalRecords[1].perf?.asOf === "2026-10-02");
  return fails;
}
const pickersBuilderSrc = read(PICKERS_BUILDER);
{
  const fails = await pickersSuite(pickersBuilderSrc, perfSrc);
  for (const f of fails) check(f, false);
  check("#103: /api/pickers serves no perf on any payload path; the pages' in-process read keeps it", fails.length === 0);
  const h = code(PICKERS_BUILDER, pickersBuilderSrc);
  const start = h.search(/async function handlePickersRequest\(/);
  const body = start >= 0 ? h.slice(start, h.search(/export async function GET\(req: NextRequest\)/)) : "";
  const payloadAnswers = body.match(/NextResponse\.json\(\s*[a-zA-Z.]+\.data\b|NextResponse\.json\(data\b/g) ?? [];
  check("#103: no /api/pickers answer hands a payload to NextResponse.json unfiltered", body.length > 0 && payloadAnswers.length === 0, payloadAnswers.join(" | "));
}

// ── 12. the clients, on their code ──────────────────────────────────────────
function clientRules(srcs) {
  const fails = [];
  for (const [f, action] of Object.entries(CLIENTS)) {
    const c = code(f, srcs[f]);
    if (!new RegExp(`import \\{ ${action} \\} from "@/app/plays/playsPagePayload";`).test(c)) fails.push(`${f} imports its own server action`);
    if (!new RegExp(`const data = await resolvePlaysRefresh\\(\\s*routeData,\\s*shownWithBars\\.current,\\s*async \\(\\) => \\(await ${action}\\(\\)\\) as unknown as PlaysPayload \\| null\\s*\\);\\s*if \\(!data\\) return;`).test(c)) fails.push(`${f} refreshes through resolvePlaysRefresh with ${action}`);
    if (/setSections\([^;]*routeData/.test(c)) fails.push(`${f} shows the route's payload directly`);
    if (!/setSections\(Array\.isArray\(data\?\.sections\) \? data\.sections : \[\]\);/.test(c)) fails.push(`${f} shows the resolved payload`);
    if (!/shownWithBars\.current =\s*!data\.chartPointsWithheld && typeof data\.updatedAt === "string" \? data\.updatedAt : null;/.test(c)) fails.push(`${f} remembers which scan on screen has its bars`);
  }
  return fails;
}
const clientSrcs = Object.fromEntries(Object.keys(CLIENTS).map((f) => [f, read(f)]));
{
  const fails = clientRules(clientSrcs);
  for (const f of fails) check(f, false);
  check("#103: the three clients take their bars in-process, never from the route", fails.length === 0);
}

// ── 13. mutants for #103 ────────────────────────────────────────────────────
const PUB_MUTANTS = [
  ["withheld only on an explicit 'tiingo' (not fail closed)", /return history\?\.provider !== "fmp";/, 'return history?.provider === "tiingo";'],
  ["the strip keeps chartPoints", /if \(k !== "chartPoints"\) out\[k\] = v;/, "out[k] = v;"],
  ["the strip mutates the in-process memo", /return Array\.isArray\(items\) \? \{ \.\.\.\(section as object\), items: items\.map\(withoutChartPoints\) \} : section;/, "if (Array.isArray(items)) items.forEach((it) => { if (it && typeof it === \"object\") delete (it as Record<string, unknown>).chartPoints; }); return section;"],
  ["the credit follows the flag word only", /if \(!history \|\| history\.provider !== "tiingo"\) return false;\s*const fromTiingo = [^;]+;\s*return [^;]+;/, 'return history?.provider === "tiingo";'],
  ["the credit shows on any payload", /if \(!history \|\| history\.provider !== "tiingo"\) return false;/, "if (!history) return false;"],
  ["the client adopts the route's bar-less payload", /if \(full && Array\.isArray\(full\.sections\) && !full\.chartPointsWithheld\) return full;/, ""],
  ["the client re-reads for the scan already on screen", /if \(shownWithBars && routeData\.updatedAt === shownWithBars\) return null;/, ""],
];
for (const [label, from, to] of PUB_MUTANTS) {
  const m = mutate(publicSrc, from, to, label);
  if (!m) continue;
  let fails;
  try { fails = await publicSuite(await loadCopy(PUBLIC, m)); } catch (e) { fails = [`threw: ${e.message}`]; }
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}
const ROUTE_MUTANTS = [
  ["/api/plays answers the raw payload", "app/api/plays/route.ts", /NextResponse\.json\(publicPlaysPayload\(data\),/, "NextResponse.json(data,"],
  ["/api/bull-flags answers the raw payload", "app/api/bull-flags/route.ts", /NextResponse\.json\(publicPlaysPayload\(data\),/, "NextResponse.json(data,"],
  ["/api/descending-triangles answers the raw payload", "app/api/descending-triangles/route.ts", /NextResponse\.json\(publicPlaysPayload\(data\),/, "NextResponse.json(data,"],
  ["/api/plays filters only its plain answer", "app/api/plays/route.ts", /const \{ data, headers, status \} = await getPlaysData\(origin, \{/, "if (debugSymbol) { const r = await getPlaysData(origin, { debugSymbol }); return NextResponse.json(r.data); }\n  const { data, headers, status } = await getPlaysData(origin, {"],
];
for (const [label, file, from, to] of ROUTE_MUTANTS) {
  const m = mutate(routeSrcs[file], from, to, label);
  if (!m) continue;
  const fails = await routeSuite({ ...routeSrcs, [file]: m });
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}
const ACTION_MUTANTS = [
  ["the server action builds (no cacheOnly)", /getBullFlagsData\(SITE_ORIGIN, \{ cacheOnly: true \}\)/, "getBullFlagsData(SITE_ORIGIN, {})"],
  ["the server action reads the wrong builder", /usable\(await getDescendingTrianglesData\(/, "usable(await getPlaysData("],
  ["the server action passes a cache miss through", /if \(r\.status && r\.status >= 400\) return null;/, ""],
];
for (const [label, from, to] of ACTION_MUTANTS) {
  const m = mutate(actionsSrc, from, to, label);
  if (!m) continue;
  const fails = await actionSuite(m);
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}
const PICKERS_MUTANTS = [
  ["/api/pickers serves the cached payload unfiltered", PICKERS_BUILDER, /if \(!forceRefresh && cached\?\.data\) \{\s*memo = \{ ts: now, data: cached\.data \};\s*return NextResponse\.json\(publicPickersPayload\(cached\.data\),/, "if (!forceRefresh && cached?.data) {\n    memo = { ts: now, data: cached.data };\n\n    return NextResponse.json(cached.data,"],
  ["/api/pickers serves the memo unfiltered", PICKERS_BUILDER, /NextResponse\.json\(publicPickersPayload\(memo\.data\),/, "NextResponse.json(memo.data,"],
  ["/api/pickers serves a fresh build unfiltered", PICKERS_BUILDER, /return NextResponse\.json\(publicPickersPayload\(data\), \{/, "return NextResponse.json(data, {"],
  ["/api/pickers serves the build-threw fallback unfiltered", PICKERS_BUILDER, /\} catch \(error\) \{\s*if \(cached\?\.data\) \{\s*memo = \{ ts: now, data: cached\.data \};\s*return NextResponse\.json\(publicPickersPayload\(cached\.data\),/, "} catch (error) {\n    if (cached?.data) {\n      memo = { ts: now, data: cached.data };\n\n      return NextResponse.json(cached.data,"],
  ["/api/pickers serves the degraded-build fallback unfiltered", PICKERS_BUILDER, /recordBuildStats\(data, \{ degradedFallbackUsed: true, wrote: false \}\);\s*memo = \{ ts: now, data: cached\.data \};\s*return NextResponse\.json\(publicPickersPayload\(cached\.data\),/, "recordBuildStats(data, { degradedFallbackUsed: true, wrote: false });\n      memo = { ts: now, data: cached.data };\n\n      return NextResponse.json(cached.data,"],
  ["/api/pickers serves the preview's last-good unfiltered", PICKERS_BUILDER, /NextResponse\.json\(publicPickersPayload\(lastGood\.data\),/, "NextResponse.json(lastGood.data,"],
  ["publicPickersPayload keeps perf", PERF, /if \(k !== "perf"\) out\[k\] = v;/, "out[k] = v;"],
  ["publicPickersPayload strips perf from the shared memo too", PERF, /const signalRecords = records\.map\(\(r\) => \{/, "for (const r of records) if (r && typeof r === \"object\") delete (r as Record<string, unknown>).perf;\n  const signalRecords = records.map((r) => {"],
];
for (const [label, file, from, to] of PICKERS_MUTANTS) {
  const base = file === PERF ? perfSrc : pickersBuilderSrc;
  const m = mutate(base, from, to, label);
  if (!m) continue;
  let fails;
  try { fails = file === PERF ? await pickersSuite(pickersBuilderSrc, m) : await pickersSuite(m, perfSrc); } catch (e) { fails = [`threw: ${e.message}`]; }
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}
const CLIENT_MUTANTS = [
  ["/plays shows the route's payload", "app/plays/PlaysClient.tsx", /const data = await resolvePlaysRefresh\(/, "const data = routeData; void resolvePlaysRefresh(", ],
  ["bull flags read the /plays action", "app/plays/bull-flags/BullFlagsClient.tsx", /async \(\) => \(await readBullFlagsPagePayload\(\)\)/, "async () => (await readPlaysPagePayload())"],
  ["descending triangles forget which scan has bars", "app/plays/descending-triangles/DescendingTrianglesClient.tsx", /shownWithBars\.current =\s*!data\.chartPointsWithheld && [^;]+;/, ""],
];
for (const [label, file, from, to] of CLIENT_MUTANTS) {
  const m = mutate(clientSrcs[file], from, to, label);
  if (!m) continue;
  const fails = clientRules({ ...clientSrcs, [file]: m });
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
