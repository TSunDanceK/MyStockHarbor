// WHY DOES A NAMED SYMBOL'S RE-READ FAIL? (#552 COWORK #56: TSM after #624)
//
// sec-reread.yml prints status and counts only (public logs), so an
// `error=yes` names no cause. This runs the SHIPPED fetch rule and extraction
// (the same lift sec-facts-failures.mjs uses) on the named symbols, CIKs from
// the repo's own map, and prints the error the job would record. No store is
// touched, and no figure is printed: only the error text, with any URL cut.
//
//   dispatch relay.yml, task `sec-facts-one`, symbols "TSM"
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; one-symbol failure diagnosis)";
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const sec = await lift(
  [
    readCodeOnly("lib/server/secFields.ts"),
    strip("lib/server/secExtract.ts"),
    strip("lib/server/fxRates.ts"),
    strip("lib/server/secCurrency.ts"),
    strip("lib/server/secFactCodec.ts"),
    strip("lib/server/secFactBuild.ts"),
    strip("lib/server/secStaleness.ts"),
    "export { extractCompanyFacts, toStoredSet };",
  ].join("\n")
);
const cikMap = JSON.parse(fs.readFileSync("data/cik-map.json", "utf8"));
const symbols = (process.env.SYMBOLS || process.argv[2] || "TSM").split(/[\s,]+/).filter(Boolean);
const clean = (s) => String(s).replace(/https?:\/\/\S+/g, "<url>").slice(0, 400);

const fxCache = new Map();
for (const symbol of symbols) {
  const cik = cikMap[symbol] ? String(cikMap[symbol]).padStart(10, "0") : null;
  if (!cik) { console.log(`${symbol}: no CIK in data/cik-map.json`); continue; }
  let stage = "fetch";
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    stage = "extract";
    const ex = sec.extractCompanyFacts(symbol, json);
    stage = "toStoredSet";
    const set = await sec.toStoredSet(ex, undefined, fxCache);
    console.log(`${symbol}: OK (stored set built; ${Object.keys(set ?? {}).length} top-level fields)`);
  } catch (err) {
    console.log(`${symbol}: FAILS at ${stage}: ${err?.name ?? "Error"}: ${clean(err?.message ?? err)}`);
    for (const l of String(err?.stack ?? "").split("\n").slice(1, 6)) console.log(`   ${clean(l.trim())}`);
  }
}
console.log("No writes were performed.");
