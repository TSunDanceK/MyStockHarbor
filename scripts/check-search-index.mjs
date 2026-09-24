// Symbol search off FMP (Relay B, #553 inventory #21/#22, 2026-09-23).
//
// WHAT IS AT RISK. Search is now a local index of the Nasdaq Trader directory
// (+ the committed SEC ticker file). symbolSearch.ts records three bugs an
// earlier directory-based version shipped; this check pins that none returns,
// plus the new failure a full index makes possible:
//   1. ADS names excluded           -> ARM must be findable, and first for "ARM".
//   2. name-substring matching      -> "arm" must not return Pharming.
//   3. fetched per request          -> the index is memoised (wiring, below).
//   4. NEW: every row is a candidate now, so a "no match" row must never be
//      returned -- a popular ticker's -5 bonus must not lift it into results.
// It also pins what the move must keep: ETFs (SPY, IWM, QQQ) are found; test
// issues and IEX-only listings are not; preferreds are demoted; the SEC
// fallback spells class shares the site's way (BRK.B).
//
// FIXTURES: scripts/fixtures/search-{nasdaqlisted,otherlisted}.txt, written in
// the directory's published column format (headers verbatim) with real
// symbols and names. Constructed, not captured: the sandbox cannot reach
// nasdaqtrader.com. Each run also re-runs the assertions on mutated copies.
//
//   node scripts/check-search-index.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const INDEX = "lib/server/searchIndex.ts";
const SEARCH = "lib/server/symbolSearch.ts";
const indexSrc = read(INDEX);
const searchSrc = read(SEARCH);

// The index imports the SEC file through the "@/" alias, which bare Node cannot
// resolve; the harness swaps that one line for a direct read of the same file.
const ALIAS_IMPORT = 'import secTickers from "@/data/sec/company-tickers.json";';
if (!indexSrc.includes(ALIAS_IMPORT)) {
  console.error("FAIL: the SEC ticker import moved; update this harness.");
  process.exit(1);
}

let seq = 0;
const made = [];
function sibling(dir, source) {
  const name = `.check-search-${process.pid}-${seq++}`;
  fs.writeFileSync(path.join(ROOT, dir, `${name}.ts`), source);
  made.push(path.join(ROOT, dir, `${name}.ts`));
  return name;
}
async function load(idxSource, searchSource) {
  const idxName = sibling("lib/server", idxSource.replace(ALIAS_IMPORT,
    'import fs from "node:fs";\nconst secTickers = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));'));
  const searchName = sibling("lib/server", searchSource.replace('from "./searchIndex";', `from "./${idxName}";`));
  const idx = await import(pathToFileURL(path.join(ROOT, "lib/server", `${idxName}.ts`)).href);
  const search = await import(pathToFileURL(path.join(ROOT, "lib/server", `${searchName}.ts`)).href);
  return { idx, search };
}

function suite({ idx, search }) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const nasdaq = idx.parseDirectory(read("scripts/fixtures/search-nasdaqlisted.txt"), "nasdaqlisted");
  const other = idx.parseDirectory(read("scripts/fixtures/search-otherlisted.txt"), "otherlisted");
  const all = [...nasdaq, ...other];
  const bySym = new Map(all.map((r) => [r.symbol, r]));

  ok("test issues are dropped (both files)", !bySym.has("ZXZZT") && !bySym.has("ATEST"));
  ok("the directory's $ preferred marker becomes the dash form", bySym.has("BAC-L") && !bySym.has("BAC$L"));
  ok("class shares keep the site's dotted spelling", bySym.has("BRK.B"));
  ok("exchanges map to the labels search has always shown",
    bySym.get("MSFT")?.exchange === "NASDAQ" && bySym.get("XOM")?.exchange === "NYSE" && bySym.get("SPY")?.exchange === "NYSE ARCA");
  ok("the instrument clause is cleaned off the name", bySym.get("MSFT")?.name === "Microsoft Corporation", bySym.get("MSFT")?.name);

  const sec = idx.secRows(JSON.parse(read("data/sec/company-tickers.json")));
  const secBy = new Map(sec.map((r) => [r.symbol, r]));
  ok("SEC fallback: BRK-B becomes BRK.B; a preferred series keeps its dash", secBy.has("BRK.B") && !secBy.has("BRK-B") && [...secBy.keys()].some((s) => /^[A-Z]+-[A-Z]{2,}$/.test(s)));
  ok("SEC fallback: OTC listings are not included", sec.every((r) => r.exchange !== "OTC"));

  const rows = idx.buildIndex(all, []);
  const find = (q) => search.rankIndex(rows, q).map((r) => r.symbol);

  ok("1. ARM is found (an ADS name is NOT excluded) and is first for 'ARM'", find("ARM")[0] === "ARM", find("ARM").join(","));
  ok("2. 'arm' does not match a name merely containing the letters (Pharming)", !find("arm").includes("PHAR"), find("arm").join(","));
  ok("   'microsoft' finds MSFT by name", find("MICROSOFT")[0] === "MSFT");
  ok("   'micro' puts Microsoft above MicroAlgo (the popular tiebreak kept)", find("MICRO").indexOf("MSFT") < find("MICRO").indexOf("MLGO"), find("MICRO").join(","));
  ok("   a warrant is demoted below its common stock", find("MICROALGO").indexOf("MLGO") < find("MICROALGO").indexOf("MLGOW"));
  ok("4. a non-matching popular ticker is NEVER returned", !find("ZZZZ").length && !find("PHARMING").includes("MSFT"), find("ZZZZ").join(","));
  ok("ETFs are found: SPY, IWM, QQQ", find("SPY")[0] === "SPY" && find("IWM")[0] === "IWM" && find("QQQ")[0] === "QQQ");
  ok("IEX-only listings are not offered (no chart behind them)", !find("IEXQ").includes("IEXQ"));
  // #553 COWORK #11 (2026-09-23): geared ETFs below the company and plain ETFs.
  const nvidia = find("NVIDIA");
  ok("GEARED: 'nvidia' puts the company first, its 2x/inverse ETFs after it", nvidia[0] === "NVDA" && nvidia.includes("NVDX") && nvidia.includes("NVDQ"), nvidia.join(","));
  // THE CASE THE DEMOTION DECIDES: ARMG is a TICKER-prefix match (tier 10) and
  // Armstrong World a NAME-prefix one (tier 20), so without the band ARMG wins.
  const arm = find("ARM");
  ok("GEARED: for 'ARM', an operating company (AWI) ranks above ARM's leveraged ETF (ARMG)",
    arm.includes("AWI") && arm.includes("ARMG") && arm.indexOf("AWI") < arm.indexOf("ARMG"), arm.join(","));
  ok("GEARED: every geared match sorts after every non-geared one (exact hit aside)",
    arm.slice(1).every((s, i, rest) => bySym.get(s)?.etfKind !== "geared" || rest.slice(i).every((t) => bySym.get(t)?.etfKind === "geared")), arm.join(","));
  // Needs a NON-geared rival for the same query, or the rule decides nothing:
  // TQQQ (geared, exact) vs TQQQA (plain, ticker-prefix). Constructed rows.
  const rival = idx.buildIndex([
    { symbol: "TQQQ", name: "ProShares UltraPro QQQ", exchange: "NASDAQ", etfKind: "geared" },
    { symbol: "TQQQA", name: "Constructed Operating Co", exchange: "NASDAQ", etfKind: null },
  ], []);
  ok("GEARED: an exact ticker hit on a geared ETF is still first ('TQQQ' means TQQQ)",
    search.rankIndex(rival, "TQQQ")[0]?.symbol === "TQQQ", search.rankIndex(rival, "TQQQ").map((r) => r.symbol).join(","));
  ok("GEARED: classified from the directory's ETF flag + raw name",
    bySym.get("NVDX")?.etfKind === "geared" && bySym.get("SQQQ")?.etfKind === "geared" && bySym.get("QYLD")?.etfKind === "geared" &&
      bySym.get("SPY")?.etfKind === "plain" && bySym.get("SHV")?.etfKind === "plain" && bySym.get("MSFT")?.etfKind === null,
    ["NVDX", "SQQQ", "QYLD", "SPY", "SHV", "MSFT"].map((s) => `${s}:${bySym.get(s)?.etfKind}`).join(" "));

  // #553 COWORK #11: the directory is not always UTF-8.
  const cp1252 = Uint8Array.from(Buffer.from("MicroSectors -3\xD7 Short", "latin1"));
  ok("ENCODING: a Windows-1252 × is decoded, not mangled", idx.decodeDirectory(cp1252) === "MicroSectors -3× Short", idx.decodeDirectory(cp1252));
  ok("ENCODING: valid UTF-8 is read as UTF-8", idx.decodeDirectory(new TextEncoder().encode("Nestlé − S.A.")) === "Nestlé − S.A.");

  ok("results carry only symbol, name and exchange", Object.keys(search.rankIndex(rows, "AAPL")[0] ?? {}).sort().join() === "exchange,name,symbol");
  return fails;
}

let failures = 0;
try {
  const real = suite(await load(indexSrc, searchSrc));
  console.log("=== search index + ranking (fixtures) ===");
  console.log(real.length ? real.map((f) => `  FAIL  ${f}`).join("\n") : "  PASS  every assertion");
  failures += real.length;

  const MUTANTS = [
    ["search", "no-match decided after the popular bonus", "  if (base === 50) return NO_MATCH;\n", ""],
    ["search", "name-substring matching reintroduced", "    else if (symbolNorm.includes(q)) base = 40;", "    else if (symbolNorm.includes(q) || nameNorm.includes(q)) base = 40;"],
    // At PARSE time, on the raw directory name: cleanName strips the ADS clause
    // before ranking ever sees it, so that is where the original bug lived.
    ["index", "an ADS name excluded", `const name = cleanName(cols[iName] || "");`, `if (/depositary/i.test(cols[iName] || "")) continue;\n    const name = cleanName(cols[iName] || "");`],
    ["index", "test issues kept", `if (iTest >= 0 && (cols[iTest] || "").trim().toUpperCase() === "Y") continue;`, ""],
    ["index", "ETF venue (Arca) unmapped", 'P: "NYSE ARCA",', ""],
    ["index", "preferred marker not converted", '.replace(/\\$/g, "-")', ""],
    ["search", "geared ETFs not demoted", '(e.rank === 0 ? 0 : e.row.etfKind === "geared" ? 2 : 1)', "(e.rank === 0 ? 0 : 1)"],
    ["search", "exact hit on a geared ETF demoted too", '(e.rank === 0 ? 0 : e.row.etfKind === "geared" ? 2 : 1)', '(e.row.etfKind === "geared" ? 2 : e.rank === 0 ? 0 : 1)'],
    ["index", "directory decoded as UTF-8 only", 'return new TextDecoder("windows-1252").decode(bytes);', 'return new TextDecoder("utf-8").decode(bytes);'],
    ["index", "Treasury 'short' duration funds classed as geared", "(?!\\s*-?\\s*(?:term|treasury|duration|maturity|dated|bond))", ""],
  ];
  console.log("\n=== mutants ===");
  for (const [which, label, from, to] of MUTANTS) {
    const base = which === "search" ? searchSrc : indexSrc;
    if (!base.includes(from)) { console.log(`  FAIL  mutant "${label}" no longer matches`); failures++; continue; }
    const mutated = base.replace(from, to);
    const fails = suite(await load(which === "index" ? mutated : indexSrc, which === "search" ? mutated : searchSrc));
    console.log(`  ${fails.length ? "PASS" : "FAIL"}  mutant caught: ${label}${fails.length ? ` (${fails[0]})` : ""}`);
    if (!fails.length) failures++;
  }
} finally {
  for (const f of made) fs.rmSync(f, { force: true });
}

console.log("\n=== wiring ===");
const code = readCodeOnly(SEARCH);
const idxCode = readCodeOnly(INDEX);
const wiring = [
  ["search makes no FMP call and reads no FMP key (NEXT_PUBLIC_FMP_API_KEY included)", !/fmpFetch|financialmodelingprep|FMP_API_KEY/.test(code)],
  ["the index is memoised per instance, not rebuilt per request", /if \(memo\?\.fromDirectory\) return memo\.rows;/.test(idxCode)],
  ["the directory fetch shares companyNames' 24 h fetch cache", /next: \{ revalidate: 86400 \}/.test(idxCode)],
  ["the dead /stock-search route is gone and nothing links to it",
    !fs.existsSync(path.join(ROOT, "app/stock-search/route.ts")) && !/href="\/stock-search"/.test(read("app/stock/[symbol]/page.tsx"))],
];
for (const [label, pass] of wiring) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failures++;
}
console.log(failures ? `\nFAILED (${failures})` : "\nall passed");
process.exit(failures ? 1 : 0);
