// WHERE DOES A FILER'S TWELVE-MONTH EPS COME FROM? (#552 COWORK #63: SOMN,
// IESC at about half FMP's P/E). The shipped extraction and stored-set build
// on a fresh companyfacts read, then the shipped ttmEpsFromSet. Prints SEC
// values only: each quarter and year's diluted EPS and share count, and the
// basis the P/E would use. No price, no store touched.
//   dispatch relay.yml, task `sec-ttm-eps`, symbols "SOMN IESC"
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; ttm eps probe)";
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const sec = await lift([
  readCodeOnly("lib/server/secFields.ts"), strip("lib/server/secExtract.ts"), strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"), strip("lib/server/secFactCodec.ts"), strip("lib/server/secFactBuild.ts"),
  strip("lib/server/secStaleness.ts"), "export { extractCompanyFacts, toStoredSet, valueOf };",
].join("\n"));
const V = await import("../lib/server/secValuation.ts");
const cikMap = JSON.parse(fs.readFileSync("data/cik-map.json", "utf8"));
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const today = new Date().toISOString().slice(0, 10);
const f = (v, d = 2) => (v == null ? "-" : Number(v).toFixed(d));
for (const symbol of (process.env.SYMBOLS || "SOMN IESC").split(/[\s,]+/).filter(Boolean)) {
  const cik = cikMap[symbol] ? String(cikMap[symbol]).padStart(10, "0") : REG[symbol]?.cik;
  if (!cik) { console.log(`${symbol}: no CIK`); continue; }
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const set = await sec.toStoredSet(sec.extractCompanyFacts(symbol, await res.json()), undefined, new Map());
    console.log(`\n== ${symbol} (fiscal year end ${REG[symbol]?.fiscalYearEnd ?? "?"}, ${REG[symbol]?.annualForm ?? "?"}, cur ${set.cur ?? "USD"})`);
    const row = (p) => `${p.fy ?? "?"} ${String(p.fp ?? "").padEnd(3)} ${p.s ?? "?"}..${p.e}  epsDil ${f(sec.valueOf(p, "epsDiluted"))}  epsBasic ${f(sec.valueOf(p, "epsBasic"))}  shDil ${f(sec.valueOf(p, "sharesDiluted") / 1e6, 1)}M  netInc ${f(sec.valueOf(p, "netIncome") / 1e6, 1)}M`;
    console.log("  quarters (newest first):"); for (const q of set.quarters.slice(0, 8)) console.log(`   ${row(q)}${V.derivedQ4Eps(set, q) != null ? `  [Q4 derived ${f(V.derivedQ4Eps(set, q))}]` : ""}`);
    console.log("  years:"); for (const y of set.years.slice(0, 3)) console.log(`   ${row(y)}`);
    const b = V.ttmEpsFromSet(set, { annualForm: REG[symbol]?.annualForm ?? "10-K" }, today);
    console.log(`  TTM EPS used for P/E: ${b ? `${f(b.val)} (${b.basis}, ends ${b.periodEnd}${b.derivedQ4 ? `, Q4 derived at ${b.derivedQ4}` : ""})` : "none"}`);
  } catch (e) { console.log(`${symbol}: ERROR ${String(e?.message ?? e).slice(0, 200)}`); }
}
