// VERIFY THE CITED CLASS MAP ON REAL FILINGS (#552 COWORK #31).
// Runs the SHIPPED withClassCover (lib/server/secCoverClasses.ts, lifted with
// its real parse/weigh code) over every entry in data/sec/share-classes.json
// against each filer's newest 10-Q/10-K instance, and prints the computed
// cover, its date and filing, or the refusal. Then the pins COWORK #31 named,
// against the per-class counts on each filer's latest 10-Q cover.
// SEC data only; read-only, no credential.
//   node scripts/sec-cover-classes-verify.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; class cover verify)";
const MAP = JSON.parse(fs.readFileSync("data/sec/share-classes.json", "utf8")).entries;
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const SRC = readCodeOnly("lib/server/secCoverClasses.ts");
const FILL = readCodeOnly("lib/server/secFilingFill.ts");
const M = await lift([
  `const ENTRIES = ${JSON.stringify(MAP)};`,
  FILL.match(/^export const FILING_INSTANCE_MAX_BYTES = [^;]+;$/m)[0].replace(/^export /, ""),
  grabFunction(FILL, "pickInstanceName"),
  "function shareClassesFor(s) { return ENTRIES[s] ?? ENTRIES[s.replace('-', '.')] ?? null; }",
  grabFunction(SRC, "parseCoverClasses"),
  grabFunction(SRC, "parseClassRates"),
  grabFunction(SRC, "withFilingRates"),
  grabFunction(SRC, "coverFromClasses"),
  grabFunction(SRC, "withClassCover"),
  "export { withClassCover };",
].join("\n"));

const get = async (u) => { await new Promise((x) => setTimeout(x, 130)); return fetch(u, { headers: { "User-Agent": UA } }); };
const warns = [];
const origWarn = console.warn;
console.warn = (...a) => { warns.push(a.map(String).join(" ")); };
const out = {};
for (const sym of Object.keys(MAP).sort()) {
  const cik = String(REG[sym]?.cik ?? REG[sym.replace(".", "-")]?.cik ?? "");
  if (!cik) { out[sym] = { ok: false, why: "no registrant row" }; continue; }
  warns.length = 0;
  const cover = await M.withClassCover(sym, cik, null, get);
  out[sym] = cover ? { ok: true, ...cover } : { ok: false, why: warns.join(" | ").slice(0, 200) || "no cover" };
}
console.warn = origWarn;

const fmt = (n) => Number(n).toLocaleString("en-US");
let ok = 0;
for (const [s, r] of Object.entries(out)) {
  if (r.ok) ok++;
  console.log(r.ok ? `  OK      ${s.padEnd(6)} ${fmt(r.val).padStart(16)}  as of ${r.asOf}  ${r.accession} (filed ${r.filed})`
    : `  REFUSE  ${s.padEnd(6)} ${r.why}`);
}
console.log(`\nrecovered: ${ok} of ${Object.keys(out).length} cited entries`);

// PINS: the per-class counts printed on each filer's 10-Q cover (COWORK #31).
const PINS = {
  META: 2_205_128_509 + 342_377_716,
  "BRK.B": 488_450 * 1_500 + 1_408_035_161,
  CMCSA: 3_539_192_198 + 9_444_375,
};
console.log("\npins (10-Q cover, per-class counts combined by the cited weights):");
for (const [s, want] of Object.entries(PINS)) {
  const r = out[s];
  console.log(`  ${r?.ok && r.val === want ? "PASS" : "DIFF"}  ${s.padEnd(6)} want ${fmt(want)}  got ${r?.ok ? fmt(r.val) + " as of " + r.asOf : r?.why}`);
}
console.log(`  INFO  V      got ${out.V?.ok ? fmt(out.V.val) + " as of " + out.V.asOf : out.V?.why} (as-converted to Class A at the cited rates)`);
