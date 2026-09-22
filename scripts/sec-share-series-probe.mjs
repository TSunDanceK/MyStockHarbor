// HOW LONG IS THE NEW SHARE HISTORY, AND WHAT DOES IT COST PER STORED SET?
//
// Owner question on #517: points per symbol for ONDS, AAPL and ABVX once the
// extractor stores `as` (fiscal-year basic shares, every year in the payload)
// and the chart appends the stored quarters since the last fiscal year-end —
// and the bytes `as` adds to each stored set.
//
// Runs the SHIPPED extractor and codec, lifted, on the live companyfacts
// payload. Read-only, no credentials, writes nothing.
//
//   SYMBOLS="ONDS AAPL ABVX" node scripts/sec-share-series-probe.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";
import { symbolSpellings } from "../lib/symbolSpellings.mjs";

const UA = process.env.SEC_USER_AGENT ||
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; share series probe)";
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const sec = await lift([
  readCodeOnly("lib/server/secFields.ts"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/secFactCodec.ts"),
  strip("lib/server/secShareHistory.ts"),
  "export { extractCompanyFacts, encodeFactSet, buildShareHistory };",
].join("\n"));
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift([grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile"), "export { parseTickerFile, padCik };"].join("\n"));
const { map } = tick.parseTickerFile(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const cikMap = JSON.parse(fs.readFileSync("data/cik-map.json", "utf8"));
const cikFor = (s) => {
  for (const v of symbolSpellings(s)) {
    if (cikMap[v]) return tick.padCik(cikMap[v]);
    if (map.get(v)?.cik) return map.get(v).cik;
  }
  return null;
};

const SYMBOLS = (process.env.SYMBOLS || "ONDS AAPL ABVX").split(/[,\s]+/).filter(Boolean);
console.log(`symbol  years  first..last            quarters-after  chart-points  was(quarters-only)  as-bytes  set-bytes`);
for (const symbol of SYMBOLS) {
  const cik = cikFor(symbol);
  if (!cik) { console.log(`${symbol.padEnd(7)} no CIK`); continue; }
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) { console.log(`${symbol.padEnd(7)} companyfacts HTTP ${res.status}`); continue; }
  const set = sec.encodeFactSet(sec.extractCompanyFacts(symbol, await res.json()));
  const as = set.as ?? [];
  const withAs = sec.buildShareHistory(set);
  const without = sec.buildShareHistory({ ...set, as: undefined });
  const asBytes = as.length ? JSON.stringify(as).length + 6 : 0; // + `,"as":`
  const after = withAs?.basis === "annual+quarters" ? withAs.points.length - as.length : 0;
  console.log(
    `${symbol.padEnd(7)} ${String(as.length).padStart(5)}  ${(as[0]?.[0] ?? "-")}..${(as.at(-1)?.[0] ?? "-")}  ` +
      `${String(after).padStart(14)}  ${String(withAs?.points.length ?? 0).padStart(12)}  ${String(without?.points.length ?? 0).padStart(18)}  ` +
      `${String(asBytes).padStart(8)}  ${String(JSON.stringify(set).length).padStart(9)}`
  );
  await new Promise((r) => setTimeout(r, 150));
}
