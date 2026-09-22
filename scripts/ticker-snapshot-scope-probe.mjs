// WHAT REFRESHING THE COMMITTED REGISTRANT SNAPSHOT WOULD BUY, AND COST.
//
// BK, EA, EQR and WBS do not resolve through cikForSymbol, so their /earnings
// pages have no filings to show. SQ does not resolve either, for a different
// reason: Block renamed SQ -> XYZ and curatedSymbols.ts still says SQ. Those
// are two different fixes and this separates them with evidence.
//
// ── EVERY LOOKUP GOES THROUGH THE SHIPPED GATE ───────────────────────────
// parseTickerFile and lookupBySpelling are the site's own, lifted. A bare
// Map.has reported BRK.B as unresolvable earlier tonight — the file spells it
// BRK-B and the shipped lookup bridges that. Reimplementing the gate is how a
// probe produces a wrong answer that reads as a finding.
//
// ── AND THE UNIVERSE IS THE PUBLISHED ONE ────────────────────────────────
// lib/curatedSymbols.ts is what app/sitemap.ts submits. An earlier attempt used
// a dynamic-universe Redis key, got 895 symbols dominated by stored fact sets,
// and did not even contain MSTY — the symbol the whole question came from.
import fs from "node:fs";
import ts from "typescript";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";
import { lookupBySpelling } from "../lib/symbolSpellings.mjs";

const constant = (src, n) => (readCodeOnly(src).match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const TICKER_FILE = constant("lib/server/secTickerMap.ts", "TICKER_FILE");
const TICKER_URL = constant("lib/server/secTickerMap.ts", "TICKER_URL");
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; registrant snapshot scope)";

const tickerSrc = readCodeOnly("lib/server/secTickerMap.ts");
const parser = await lift([
  grabFunction(tickerSrc, "padCik"),
  grabFunction(tickerSrc, "parseTickerFile"),
  "export { parseTickerFile };",
].join("\n"));

const committed = parser.parseTickerFile(fs.readFileSync(TICKER_FILE, "utf8"));
console.log(`committed: ${committed.map.size} tickers, shape=${committed.shape}`);

const res = await fetch(TICKER_URL, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
if (!res.ok) { console.error(`FATAL: live fetch HTTP ${res.status}`); process.exit(2); }
const liveText = await res.text();
const live = parser.parseTickerFile(liveText);
console.log(`live:      ${live.map.size} tickers, shape=${live.shape}`);

// The curated universe, transpiled rather than re-typed.
const js = ts.transpileModule(fs.readFileSync("lib/curatedSymbols.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
fs.writeFileSync("scripts/.curated-tmp.mjs", js);
const curated = await import(`${process.cwd()}/scripts/.curated-tmp.mjs`);
fs.rmSync("scripts/.curated-tmp.mjs", { force: true });

const hit = (map, s) => Boolean(lookupBySpelling(map, s)?.value?.cik);
const stocks = [...new Set(curated.priorityStocks.map((s) => s.toUpperCase()))];
const etfs = new Set(curated.uniqueEtfs.map((s) => s.toUpperCase()));
const submitted = stocks.filter((s) => !etfs.has(s));

const gained = submitted.filter((s) => !hit(committed.map, s) && hit(live.map, s));
const stillMissing = submitted.filter((s) => !hit(committed.map, s) && !hit(live.map, s));
const lost = submitted.filter((s) => hit(committed.map, s) && !hit(live.map, s));

console.log(`\n${"=".repeat(78)}`);
console.log("WHAT A REFRESH CHANGES, ON THE 129 SYMBOLS THE SITEMAP SUBMITS");
console.log("=".repeat(78));
console.log(`  would START resolving: ${gained.length}${gained.length ? "  " + gained.join(" ") : ""}`);
console.log(`  still missing after:   ${stillMissing.length}${stillMissing.length ? "  " + stillMissing.join(" ") : ""}`);
console.log(`  would STOP resolving:  ${lost.length}${lost.length ? "  " + lost.join(" ") : ""}   <-- a refresh is not free`);

console.log(`\n  ETFs (reachable, not submitted): committed ${[...etfs].filter((s) => !hit(committed.map, s)).length}` +
  ` unresolved -> live ${[...etfs].filter((s) => !hit(live.map, s)).length} unresolved`);

console.log(`\n${"=".repeat(78)}`);
console.log("THE NAMED CASES, COMMITTED vs LIVE");
console.log("=".repeat(78));
for (const t of ["SQ", "XYZ", "BK", "EA", "EQR", "WBS", "MSTY", "JEPI", "SPY", "BRK.B", "AAPL"]) {
  const c = lookupBySpelling(committed.map, t)?.value?.cik;
  const l = lookupBySpelling(live.map, t)?.value?.cik;
  const verdict =
    c && l ? "unchanged" : !c && l ? "FIXED BY A REFRESH" : c && !l ? "LOST BY A REFRESH" : "absent from both";
  console.log(`  ${t.padEnd(6)} committed ${(c ?? "—").padEnd(12)} live ${(l ?? "—").padEnd(12)} ${verdict}`);
}

// ── IS IT THE FILE'S AGE, OR THE FILE? ───────────────────────────────────
//
// If BK, EA, EQR and WBS are absent from the LIVE company_tickers_exchange
// file too, then refreshing the snapshot cannot fix them and the problem is
// WHICH SEC FILE is read, not how old it is. SEC publishes a second one —
// company_tickers.json, the legacy shape with no exchange column — and
// parseTickerFile ALREADY handles that shape (see its LegacyRow branch), so
// the question is worth asking before anyone schedules a refresh.
const LEGACY_URL = "https://www.sec.gov/files/company_tickers.json";
let legacy = null;
try {
  const lr = await fetch(LEGACY_URL, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (lr.ok) {
    legacy = parser.parseTickerFile(await lr.text());
    console.log(`\n  legacy company_tickers.json: ${legacy.map.size} tickers, shape=${legacy.shape}`);
  } else console.log(`\n  legacy file: HTTP ${lr.status}`);
} catch (e) { console.log(`\n  legacy file: FAILED — ${e.message}`); }

if (legacy) {
  console.log(`  ${"symbol".padEnd(7)} ${"exchange-file".padEnd(14)} legacy-file`);
  for (const t of ["BK", "EA", "EQR", "WBS", "SQ", "XYZ", "QQQ", "SPY", "MSTY", "JEPI", "AAPL"]) {
    const a = lookupBySpelling(live.map, t)?.value?.cik ?? "—";
    const b = lookupBySpelling(legacy.map, t)?.value?.cik ?? "—";
    const note = a === "—" && b !== "—" ? "  <-- LEGACY FILE HAS IT" : "";
    console.log(`  ${t.padEnd(7)} ${a.padEnd(14)} ${b}${note}`);
  }
  const rescued = submitted.filter((s) => !hit(live.map, s) && hit(legacy.map, s));
  const etfRescued = [...etfs].filter((s) => !hit(live.map, s) && hit(legacy.map, s));
  console.log(`\n  SUBMITTED symbols the legacy file would rescue: ${rescued.length}${rescued.length ? "  " + rescued.join(" ") : ""}`);
  console.log(`  ETFs the legacy file would rescue:             ${etfRescued.length}${etfRescued.length ? "  " + etfRescued.join(" ") : ""}`);
  const wouldLose = submitted.filter((s) => hit(live.map, s) && !hit(legacy.map, s));
  console.log(`  SUBMITTED symbols the legacy file would LOSE:  ${wouldLose.length}${wouldLose.length ? "  " + wouldLose.join(" ") : ""}`);
}

// THE WHOLE-FILE DELTA, so "refresh the snapshot" has a size rather than a vibe.
const cSet = new Set(committed.map.keys()), lSet = new Set(live.map.keys());
const added = [...lSet].filter((t) => !cSet.has(t));
const removed = [...cSet].filter((t) => !lSet.has(t));
console.log(`\n  whole-file delta: +${added.length} tickers, -${removed.length} tickers`);
console.log(`  removed sample:  ${removed.slice(0, 20).join(" ")}`);
