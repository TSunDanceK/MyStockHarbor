// DOES THE PER-RUN FX SERIES CACHE DROP LATER FILERS' NEWEST PERIODS? (#535 COWORK #8)
//
// sec-facts converts every non-USD set through toStoredSet with ONE shared
// Map<currency, series> per run (fxSeriesThisRun). The series is fetched for
// the span of the FIRST filer in that currency and reused for the rest. This
// replays that with the SHIPPED toStoredSet over live companyfacts and live
// FRED/ECB, two ways:
//   FRESH   each filer gets its own cache (what a correct cache would give)
//   SHARED  one cache, primed by the filer whose span ends earliest (BMO/BNS
//           end at a 31 Oct year, MICC at 31 Dec 2024 in its stored set)
// If SHARED refuses periods FRESH converts, the cache is the cause.
// Read-only: no Redis, no writes.  relay task: fx-cache-replay
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; fx cache replay)";
const strip = (f) => fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
  .replace(/^import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";$/gm, "");
const X = await lift([fs.readFileSync("lib/server/secFields.ts", "utf8"), strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"), strip("lib/server/secCurrency.ts"), strip("lib/server/secFactCodec.ts"),
  strip("lib/server/secFactBuild.ts")].join("\n"));
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift([grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") + "\nexport { parseTickerFile };");
const { map } = tick.parseTickerFile(fs.readFileSync("data/sec/company-tickers.json", "utf8"));

const ORDER = { CAD: ["BMO", "BNS", "ENB"], EUR: ["MICC", "VOD"] };
const get = async (u) => { await new Promise((r) => setTimeout(r, 150)); const r = await fetch(u, { headers: { "User-Agent": UA } }); return r.ok ? r.json() : null; };
const summary = (set) => {
  const ends = [...set.quarters, ...set.years].map((p) => p.e).sort();
  return `newest stored ${ends.at(-1) ?? "none"} · refused ${(set.fx?.refused ?? []).length} (${(set.fx?.refused ?? []).slice(-2).join(", ")}) · rates to ${(set.fx?.applied ?? []).map((a) => a.end).sort().at(-1) ?? "—"}`;
};
for (const [cur, syms] of Object.entries(ORDER)) {
  const extracted = [];
  for (const s of syms) {
    const cik = map.get(s)?.cik;
    const facts = cik ? await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`) : null;
    if (!facts) { console.log(`${s}: companyfacts unreadable`); continue; }
    extracted.push([s, X.extractCompanyFacts(s, facts)]);
  }
  console.log(`\n══ ${cur} — processing order ${extracted.map(([s]) => s).join(" → ")}`);
  const shared = new Map();
  for (const [s, ex] of extracted) {
    const fresh = await X.toStoredSet(ex, X.defaultSources(), new Map());
    const sh = await X.toStoredSet(ex, X.defaultSources(), shared);
    console.log(`  ${s.padEnd(5)} reporting ${ex.reportingCurrency}`);
    console.log(`     FRESH  ${summary(fresh)}`);
    console.log(`     SHARED ${summary(sh)}`);
  }
  const cached = shared.get(cur);
  console.log(`  shared cache for ${cur}: ${cached ? `${cached.observations.length} observations, last ${cached.observations.at(-1)?.date} (${cached.source})` : "none"}`);
}
