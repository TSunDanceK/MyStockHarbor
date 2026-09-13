// Build the static profile snapshot from data ALREADY CAPTURED under the FMP
// licence, and emit it compactly enough to travel through a job log.
//
// ── WHY THERE ARE NO FMP CALLS HERE ────────────────────────────────────────
// The obvious source is /stable/profile, one call per symbol. This sandbox has
// no FMP key and is refused financialmodelingprep.com outright (403 CONNECT,
// retested 2026-09-13), and the relay holds only Upstash secrets. But the Step 0
// dump the relay already downloads turns out to carry the taxonomy three times
// over, from when the licence was live:
//
//   screener-fundamentals  2,609 symbols  sector+industry 100% populated
//   fundamentals             760 symbols  sector+industry 100% populated
//   profile                  651 symbols  sector+industry 100% populated
//
// So the two fields the whole pipeline actually turns on cost nothing to
// snapshot. The fields that are NOT in any cache — exchange, country, ipoDate,
// isin, cusip, website, ceo, employees — would each need that per-symbol call,
// and are reported as absent rather than invented.
//
// ── THE WIRE FORMAT IS INDEXED; THE COMMITTED FILE IS NOT ──────────────────
// 2,609 rows of full strings is ~150KB, which does not survive a log tail and
// would be transcribed by hand. Indexed against a sector/industry dictionary it
// is a few tens of KB, and scripts/static-profile-expand.mjs turns it back into
// readable JSON locally. The expansion is deterministic and checked.
//
//   node scripts/static-profile-build.mjs <dumpDir>
import fs from "node:fs";
import path from "node:path";
import { emitPayload } from "./lib/relay-capture.mjs";

const DUMP_DIR = process.argv[2] || "";
if (!DUMP_DIR) { console.log("no dump dir"); process.exit(0); }

const readDump = (file) => {
  const full = path.join(DUMP_DIR, file);
  if (!fs.existsSync(full)) return {};
  try { return JSON.parse(fs.readFileSync(full, "utf8"))?.values ?? {}; }
  catch { return {}; }
};

const symbolFromKey = (key) => (key.split(":").pop() || "").trim().toUpperCase();
const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

// ── PRECEDENCE, MOST-TRUSTED FIRST ────────────────────────────────────────
// screener-fundamentals is widest (2,609) and is the FMP screener's own
// taxonomy. fundamentals and profile are the per-symbol profile cache for the
// covered universe — same upstream fields, narrower. Later sources only FILL
// GAPS; they never overwrite, so one source's answer for a symbol is used
// consistently rather than mixed field by field.
const SOURCES = [
  ["screener-fundamentals.json", "screener"],
  ["fundamentals.json", "fundamentals"],
  ["profile.json", "profile"],
];

const rows = new Map();
const provenance = {};
for (const [file, label] of SOURCES) {
  const values = readDump(file);
  let added = 0;
  for (const [key, value] of Object.entries(values)) {
    if (!value || typeof value !== "object") continue;
    const symbol = clean(value.symbol)?.toUpperCase() || symbolFromKey(key);
    if (!symbol || !/^[A-Z][A-Z.\-]{0,6}$/.test(symbol)) continue;
    if (rows.has(symbol)) continue;

    const sector = clean(value.sector);
    const industry = clean(value.industry);
    // A row with neither is not a row. Sector alone is useful (it reaches a
    // bucket); industry alone is not, but it is kept because bucketFor tries
    // industry first and a sector may arrive later.
    if (!sector && !industry) continue;

    rows.set(symbol, { sector, industry });
    added += 1;
  }
  provenance[label] = added;
}

const sectors = [...new Set([...rows.values()].map((r) => r.sector).filter(Boolean))].sort();
const industries = [...new Set([...rows.values()].map((r) => r.industry).filter(Boolean))].sort();
const sIdx = new Map(sectors.map((s, i) => [s, i]));
const iIdx = new Map(industries.map((s, i) => [s, i]));

const symbols = [...rows.keys()].sort();
const lines = symbols.map((sym) => {
  const { sector, industry } = rows.get(sym);
  return `${sym} ${sector ? sIdx.get(sector) : ""} ${industry ? iIdx.get(industry) : ""}`;
});

console.log(`\n=== static profile snapshot`);
console.log(`  symbols:    ${symbols.length}`);
console.log(`  by source:  ${Object.entries(provenance).map(([k, v]) => `${k}=${v}`).join(" ")}`);
console.log(`  sectors:    ${sectors.length}`);
console.log(`  industries: ${industries.length}`);
console.log(`  with sector:   ${[...rows.values()].filter((r) => r.sector).length}`);
console.log(`  with industry: ${[...rows.values()].filter((r) => r.industry).length}`);

const dict = JSON.stringify({ sectors, industries });
const body = lines.join("\n");
console.log(`  wire size:  dictionary ${Buffer.byteLength(dict)}B + rows ${Buffer.byteLength(body)}B`);
console.log(`  (expanded to readable JSON this is roughly ${Math.round((Buffer.byteLength(body) + Buffer.byteLength(dict)) * 4.5 / 1024)}KB)`);

// Chunked, because even indexed this is larger than one log tail can carry.
const CHUNK = 700;
const chunks = [];
for (let i = 0; i < lines.length; i += CHUNK) chunks.push(lines.slice(i, i + CHUNK).join("\n"));
console.log(`  chunks:     ${chunks.length} of up to ${CHUNK} rows\n`);

emitPayload("static-profile-dict", dict);
chunks.forEach((chunk, i) => emitPayload(`static-profile-rows-${i + 1}`, chunk));
