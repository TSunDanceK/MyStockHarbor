// Tiingo step 4 (#553 COWORK #71 row 4): the dashboard quote, the stock page
// header and the benchmark tiles, behind PRICE_PROVIDER_STOCK_PAGE.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE LABEL LIES: yesterday's close shown as today's, IEX's prevClose used
//      where the consolidated close is stored, or IEX volume presented as the
//      day's volume (#553 COWORK #53 §3, #56).
//   2. A SURFACE SWITCHED WITHOUT ITS GATE, or without the FMP fallback that
//      stays until the owner flips the env var (COWORK #56).
//   3. A TIINGO PRICE STORED OUTSIDE msh:tiingo: (contract §7: the purge only
//      SCANs that prefix). msh:quote:v1, msh:benchmarks:* and the insight
//      snapshot are all outside it.
//   4. THE TILES READ AS INDEX LEVELS (COWORK #32 §3): the old "(via SPY)"
//      labels, ^GSPC requested, or the note missing.
//   5. THE STOCK PAGE SEEDS FROM FMP AND FLIPS TO TIINGO on hydration.
//
// Section 1 runs the real buildTiingoQuote; section 2 re-runs it on mutated
// copies, each of which must fail. Section 3 reads source; section 4 plants a
// mutant for every static rule, and each must fail.
//
//   node scripts/check-tiingo-step4.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const ROOT = process.cwd();
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const FILES = {
  quote: "lib/server/tiingoQuote.ts",
  quoteData: "lib/server/quoteData.ts",
  bench: "lib/server/benchmarksBuilder.ts",
  dashPage: "app/dashboard/page.tsx",
  dashClient: "app/components/DashboardClient.tsx",
  stockPage: "app/stock/[symbol]/page.tsx",
  stockClient: "app/stock/[symbol]/StockSymbolPageClient.tsx",
};

// ── 1. The quote, on the real module ──────────────────────────────────────
// 2026-10-01 18:05 UTC = 14:05 EDT, a Thursday session.
const THU_1405 = Date.UTC(2026, 9, 1, 18, 5);
const bar = (date, close, volume = 1000, low = close - 1, high = close + 1) => [date, close, high, low, close, volume];
const BARS = [
  ...Array.from({ length: 260 }, (_, i) => bar(`2025-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, 50 + (i % 10), 500)),
  bar("2026-09-29", 98, 2000, 90, 120),
  bar("2026-09-30", 100, 3000, 97, 101),
];
const ROW = { price: 103, open: 101, high: 130, low: 99, prevClose: 100.5, at: THU_1405 };

/** Section-1 assertions over a module; returns the failure labels. */
function behaviour(Q) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };

  const iex = Q.buildTiingoQuote("ABC", ROW, BARS, THU_1405, "ABC Corp");
  want("in session: the IEX trade, labelled with its ET time",
    iex?.price === 103 && iex.priceLabel === "last IEX trade, 14:05 ET" && iex.date === "2026-10-01" && iex.time === "14:05");
  want("previous close is the stored consolidated close, not IEX's prevClose",
    iex?.previousClose === 100 && iex.change === 3 && Math.abs(iex.changePercentage - 3) < 1e-9);
  want("day range and open are the IEX row's while the price is IEX",
    iex?.open === 101 && iex.dayLow === 99 && iex.dayHigh === 130);
  want("volume is the last EOD bar's, labelled \"as of last close\"",
    iex?.volume === 3000 && iex.volumeLabel === "as of last close");
  want("the 52-week range spans the stored bars and the newer IEX row (a new high today)",
    iex?.yearLow === 49 && iex.yearHigh === 130);
  want("no market cap or P/E is invented", iex?.marketCap === null && iex.pe === null);

  const close = Q.buildTiingoQuote("ABC", { ...ROW, at: Date.UTC(2026, 8, 30, 19, 0) }, BARS, THU_1405);
  want("same trading day: the consolidated close wins, labelled as a close",
    close?.price === 100 && close.priceLabel === "close, 30 Sep 2026" && close.time === null);
  want("on a close, the previous close is the session before it",
    close?.previousClose === 98 && close.open === 100 && close.dayLow === 97 && close.dayHigh === 101);

  want("no row and no bars: null, so the caller keeps FMP", Q.buildTiingoQuote("ABC", null, [], THU_1405) === null);
  want("no bars at all: IEX's own prevClose is the only base, still labelled",
    Q.buildTiingoQuote("ABC", ROW, [], THU_1405)?.previousClose === 100.5);
  want("a bar with no volume shows no volume and no label",
    Q.buildTiingoQuote("ABC", ROW, [bar("2026-09-30", 100, 0)], THU_1405)?.volumeLabel === null);
  return fails;
}

console.log("\n=== 1. buildTiingoQuote: what each field is, and its label ===\n");
const Q = await import(pathToFileURL(path.join(ROOT, FILES.quote)).href);
const realFails = behaviour(Q);
for (const f of realFails) check(f, false);
check("the Tiingo quote is labelled and based as ruled", realFails.length === 0);

check("the gate reads PRICE_PROVIDER_STOCK_PAGE: unset and typos stay on FMP",
  Q.stockPageOnTiingo({}) === false && Q.stockPageOnTiingo({ PRICE_PROVIDER_STOCK_PAGE: "tiingoo" }) === false &&
  Q.stockPageOnTiingo({ PRICE_PROVIDER_STOCK_PAGE: " Tiingo " }) === true && Q.stockPageOnTiingo({ PRICE_PROVIDER_VIDEOS: "tiingo" }) === false);

// ── 2. Behaviour mutants: the module, broken once each ────────────────────
console.log("\n=== 2. Behaviour mutants ===\n");
const SRC = raw(FILES.quote);
const BEHAVIOUR_MUTANTS = [
  ["IEX's prevClose preferred over the stored close", /closeBefore\(all, surface\.date\) \?\? \(isIex && pos\(row\?\.prevClose\) \? row!\.prevClose : null\)/, "(isIex && pos(row?.prevClose) ? row!.prevClose : null) ?? closeBefore(all, surface.date)"],
  ["the volume loses its label", /volumeLabel: last && pos\(last\[5\]\) \? VOLUME_LABEL : null/, "volumeLabel: null"],
  ["the price label dropped", /priceLabel: surface\.label,/, "priceLabel: null,"],
  ["the day range from the bar while the price is IEX", /const low = isIex \? row\?\.low : last\?\.\[3\];/, "const low = last?.[3];"],
  ["the 52-week range ignores the newer IEX row", /const year = yearRange\(all, row, isIex\);/, "const year = yearRange(all, row, false);"],
];
for (const [label, from, to] of BEHAVIOUR_MUTANTS) {
  const m = SRC.replace(from, to);
  if (m === SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const tmp = path.join(ROOT, "lib/server", `.check-step4-mutant-${process.pid}.ts`);
  fs.writeFileSync(tmp, m);
  try {
    const M = await import(`${pathToFileURL(tmp).href}?m=${encodeURIComponent(label)}`);
    const fails = behaviour(M);
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ── 3. Static rules ───────────────────────────────────────────────────────
console.log("\n=== 3. Gates, the purge boundary, the ETF labels ===\n");

/** The text of one top-level function, from its signature to the next top-level declaration. */
function fnBody(src, name) {
  const i = src.search(new RegExp(`(export )?(async )?function ${name}\\b`));
  if (i < 0) return "";
  const rest = src.slice(i + 1);
  const j = rest.search(/\n(export |async function |function |const [A-Za-z_]+ = )/);
  return j < 0 ? src.slice(i) : src.slice(i, i + 1 + j);
}

function rules(srcs) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const code = Object.fromEntries(Object.entries(srcs).map(([f, s]) => [f, stripComments(s, { file: f })]));

  // quoteData: the live path switches, gated, before the msh:quote:v1 layer; the render path does not.
  const live = fnBody(code[FILES.quoteData], "fetchQuoteSnapshot");
  const gate = live.indexOf("if (stockPageOnTiingo())");
  want("fetchQuoteSnapshot reads Tiingo only behind the STOCK_PAGE gate", gate >= 0 && live.indexOf("await readTiingoQuote(") > gate);
  want("fetchQuoteSnapshot keeps the FMP fallback after the Tiingo try", live.indexOf("return await fetchQuoteSnapshotInner(") > live.indexOf("await readTiingoQuote("));
  want("the Tiingo quote skips msh:quote:v1 (returned before the Redis layer)", /if \(tiingo\) return tiingo;/.test(live));
  want("the render path (insight snapshots, persisted) stays off Tiingo",
    !/readTiingoQuote|stockPageOnTiingo/.test(fnBody(code[FILES.quoteData], "fetchQuoteSnapshotForRender")) &&
    !/readTiingoQuote|stockPageOnTiingo/.test(fnBody(code[FILES.quoteData], "fetchQuoteSnapshotInner")));

  // benchmarks
  const bench = code[FILES.bench];
  const inner = fnBody(bench, "getBenchmarksDataInner");
  const tBranch = inner.slice(inner.indexOf("&& stockPageOnTiingo()"), inner.indexOf("const stored = await readRedis"));
  want("the Tiingo tiles are gated on STOCK_PAGE and the stock scope", /scope === "stock" && stockPageOnTiingo\(\)/.test(inner));
  want("the Tiingo tiles come before the msh:benchmarks read, and are never written to it",
    tBranch.length > 0 && /await getBenchmarksTiingo\(/.test(tBranch) && !/writeRedis|redis\./.test(tBranch) && !/writeRedis|redis\./.test(fnBody(bench, "getBenchmarksTiingo")));
  want("the FMP path stays the fallback", inner.indexOf("=> fetchFmpQuote(") > inner.indexOf("await getBenchmarksTiingo("));
  for (const [sym, name] of [["SPY", "S&P 500"], ["QQQ", "Nasdaq 100"], ["DIA", "Dow Jones"], ["IWM", "Russell 2000"]])
    want(`the ${sym} tile is named as an ETF ("${sym} · ${name} ETF")`, bench.includes(`"${sym} · ${name} ETF"`));
  want("no \"(via …)\" label, no index symbol, no index level computed",
    !/\(via [A-Z]+\)/.test(bench) && !/\^GSPC|\^NDX|\^DJI|\^RUT/.test(bench) && !/indexLevel|ratio\s*\*/.test(bench));

  // dashboard
  want("the tiles say they are ETF prices", code[FILES.dashClient].includes("ETF prices, not index levels"));
  want("the tiles lead with the % change (the headline figure)",
    /\{it\.label\}<\/div>\s*<div style=\{\{ fontSize: isMobile \? 19 : 20[^>]*>\{pt != null/.test(code[FILES.dashClient]));
  want("the dashboard shows the quote's price label and the credit", /quote\?\.priceLabel \?/.test(code[FILES.dashClient]) && /tiingoCredit=\{tiingoCredit\}/.test(code[FILES.dashPage]));
  want("the dashboard seed carries the price label", /priceLabel: q\.priceLabel/.test(code[FILES.dashPage]));
  want("a benchmark tile shows its own price label", /it\.priceLabel \?\?/.test(code[FILES.dashClient]));
  want("an FMP tile's time is readable, not the raw date and time (COWORK #101)",
    /as of \$\{utcStamp\(/.test(code[FILES.dashClient]) && !/\? `\$\{it\.date\} \$\{it\.time\}` :/.test(code[FILES.dashClient]));

  // stock page
  const fq = fnBody(code[FILES.stockPage], "fetchQuote");
  want("the stock page's SSR quote switches on the same gate, before its FMP call",
    /priceProviderFor\("STOCK_PAGE"\) === "tiingo"/.test(fq) && fq.indexOf("await readTiingoQuote(") >= 0 && fq.indexOf("await readTiingoQuote(") < fq.indexOf("process.env.FMP_API_KEY"));
  want("the SSR seed carries both labels", /priceLabel: t\.priceLabel/.test(fq) && /volumeLabel: t\.volumeLabel/.test(fq));
  want("the header shows the price label and the volume label",
    /Price: \{quote\.priceLabel\}/.test(code[FILES.stockClient]) && /quote\?\.volumeLabel \?/.test(code[FILES.stockClient]));
  return fails;
}

const srcs = Object.fromEntries(Object.values(FILES).map((f) => [f, raw(f)]));
const real = rules(srcs);
for (const f of real) check(f, false);
check("step 4's static rules hold", real.length === 0);

// ── 4. Static mutants ─────────────────────────────────────────────────────
console.log("\n=== 4. Static mutants ===\n");
const MUTANTS = [
  ["the live quote reads Tiingo without the gate", FILES.quoteData, /if \(stockPageOnTiingo\(\)\) \{\n(\s*)const tiingo = await readTiingoQuote\(symbolInput\);/, "{\n$1const tiingo = await readTiingoQuote(symbolInput);"],
  ["the render path follows the switch", FILES.quoteData, /return await fetchQuoteSnapshotInner\(symbolInput, fetchQuoteFromFmpCached\);/, "if (stockPageOnTiingo()) { const t = await readTiingoQuote(symbolInput); if (t) return t; }\n    return await fetchQuoteSnapshotInner(symbolInput, fetchQuoteFromFmpCached);"],
  ["the Tiingo tiles are written to msh:benchmarks", FILES.bench, /cache\.set\(scope, \{ at: Date\.now\(\), payload: tiingo \}\);/, "cache.set(scope, { at: Date.now(), payload: tiingo }); await writeRedis(scope, { at: Date.now(), payload: tiingo });"],
  ["the old \"(via SPY)\" label", FILES.bench, /"SPY · S&P 500 ETF"/, '"S&P 500 (via SPY)"'],
  ["the ETF note dropped", FILES.dashClient, / · ETF prices, not index levels/, ""],
  ["the stock page seeds from FMP only", FILES.stockPage, /if \(priceProviderFor\("STOCK_PAGE"\) === "tiingo"\) \{\n\s*const t = await readTiingoQuote\(symbol\);/, "if (false) {\n    const t = null as any;"],
  ["the FMP tile shows the raw time again", FILES.dashClient, /`as of \$\{utcStamp\(`\$\{it\.date\}T\$\{it\.time\}Z`\) \?\? `\$\{it\.date\} \$\{it\.time\}`\}`/, "`${it.date} ${it.time}`"],
  ["the header drops the volume label", FILES.stockClient, /quote\?\.volumeLabel \?/, "false ?"],
];
for (const [label, file, from, to] of MUTANTS) {
  const m = srcs[file].replace(from, to);
  if (m === srcs[file]) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = rules({ ...srcs, [file]: m });
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
