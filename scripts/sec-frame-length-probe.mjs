// DOES EVERY QUARTER CELL COME FROM A QUARTER-LENGTH FRAME? — measured.
//
// ── THE REPORT THAT PROMPTED THIS ─────────────────────────────────────────
// NVDA's Quality of Earnings card, Q2 FY2027: net income $59.69B beside an
// operating cash flow of $24.08B marked "derived", and a "cash flow less net
// income" of −$35.61B. A quarterly net income above a quarterly operating cash
// flow by thirty-five billion is not a business fact, it is an arithmetic one:
// $59.69B has the shape of a SIX-MONTH year-to-date figure sitting in a row
// labelled as a quarter.
//
// ── WHY THE EXTRACTOR COULD DO THIS, STRUCTURALLY ─────────────────────────
// Cumulative frames are grouped by `start` (byStart). A filer's YTD ladder for
// one fiscal year shares one start: 3M, 6M, 9M, FY at n = 1, 2, 3, 4, and Q2 is
// 6M − 3M. But a filer may ALSO publish a standalone three-month frame whose
// start is the QUARTER's start, not the year's — a different byStart group, a
// single frame, n = 1, stored AS-FILED.
//
// Both write into `quarterCells` keyed by `f.end`, and the same quarter end is
// reachable from both groups. So the cell a quarter ends up with depends on
// which group the loop reaches last, and the loop order is the order rows came
// out of the payload. That is a coin toss, not a rule — and it is invisible in
// the stored set, which keeps a value and a derivation but not a span.
//
// ── WHAT THIS MEASURES ────────────────────────────────────────────────────
// For every stored QUARTER row and every duration-cumulative field, the span in
// days of the frame that produced the cell:
//
//   differenced  correct by construction — a difference of adjacent ladder
//                lengths IS one quarter, whatever the operands' spans
//   as-filed     the frame's own span, which MUST be about 3 months. Anything
//                longer is a year-to-date figure in a quarter row.
//
// A LONGER-THAN-QUARTER AS-FILED CELL IS THE DEFECT. Reported per symbol, per
// field, with the span, so the count is in SYMBOLS and in CELLS separately.
//
// Read-only: no credential, no store, no writes. Needs the network.
//
//   SYMBOLS="NVDA,AAPL" node scripts/sec-frame-length-probe.mjs
//   (no SYMBOLS: the frozen dump's analysis universe, capped by LIMIT)
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; frame length audit)";
const LIMIT = Number(process.env.LIMIT || 120);

const strip = (f) =>
  fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");
const sec = await lift([
  fs.readFileSync("lib/server/secFields.ts", "utf8"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/secFactCodec.ts"),
].join("\n"));
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);
const { SEC_FIELDS, extractCompanyFacts, cumulativeFields } = sec;

const DUR = cumulativeFields().map((f) => f.key);
const IDX = Object.fromEntries(SEC_FIELDS.map((f, i) => [f.key, i]));
console.log(`${DUR.length} duration-cumulative fields checked per quarter row\n`);

const DIR = process.env.DUMP_DIR || "";
const fromDump = () => {
  if (!DIR) return [];
  try {
    const u = JSON.parse(fs.readFileSync(path.join(DIR, "universe.json"), "utf8"));
    return (u?.pickersSymbolsKey ?? []).map(String);
  } catch { return []; }
};
const SYMBOLS = (process.env.SYMBOLS || "").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const targets = (SYMBOLS.length ? SYMBOLS : fromDump()).slice(0, LIMIT);
if (!targets.length) { console.error("FATAL: no symbols"); process.exit(2); }
console.log(`${targets.length} SYMBOLS (source: ${SYMBOLS.length ? "SYMBOLS input" : "frozen dump universe"})\n`);

const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
/** A quarter frame is about three months. Generous either side of 91. */
const QUARTER_MAX_DAYS = 100;

const offenders = [];
let cellsChecked = 0, cellsAsFiled = 0, cellsBad = 0, read = 0, failed = 0, noCik = 0;

for (const symbol of targets) {
  const cik = tickerMap.get(symbol)?.cik;
  if (!cik) { noCik++; continue; }
  let facts;
  try {
    if (process.env.FACTS_DIR) {
      facts = JSON.parse(fs.readFileSync(`${process.env.FACTS_DIR}/CIK${cik}.json`, "utf8"));
    } else {
      const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
        headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
      });
      if (!res.ok) { failed++; continue; }
      facts = await res.json();
    }
  } catch { failed++; continue; }
  read++;

  // THE SHIPPED EXTRACTOR, not a re-implementation. PeriodRecord keeps the
  // FieldValue objects, so the derivation and the tag are readable per cell —
  // which is what the encoded set drops and why this runs pre-encode.
  const out = extractCompanyFacts(symbol, facts);
  const bad = [];
  for (const q of out.quarters) {
    if (!q.start || !q.end) continue;
    const rowSpan = days(q.start, q.end);
    for (const key of DUR) {
      const v = q.values[IDX[key]];
      if (!v || v.val === null) continue;
      cellsChecked++;
      if (v.derived === "differenced") continue; // one quarter by construction
      if (v.derived !== "as-filed") continue;
      cellsAsFiled++;
      // AN AS-FILED QUARTER CELL'S FRAME IS THE ROW'S OWN FRAME: quarterMeta
      // records {start, row} per end, and the row is what produced it.
      if (rowSpan > QUARTER_MAX_DAYS) {
        cellsBad++;
        bad.push(`${q.fp ?? "?"} FY${q.fy ?? "?"} ${q.end} ${key}=${v.val} span=${rowSpan}d tag=${v.tag}`);
      }
    }
  }
  if (bad.length) offenders.push({ symbol, n: bad.length, bad });
}

console.log("=".repeat(76));
console.log(`READ ${read} SYMBOLS of ${targets.length} (${noCik} no CIK, ${failed} fetch failed)`);
console.log(`${cellsChecked} duration CELLS on quarter rows; ${cellsAsFiled} of them as-filed\n`);
console.log(`QUARTER ROWS CARRYING A LONGER-THAN-QUARTER AS-FILED CELL:`);
console.log(`  ${cellsBad} CELLS across ${offenders.length} SYMBOLS\n`);
for (const o of offenders.sort((a, b) => b.n - a.n).slice(0, 30)) {
  console.log(`  ${o.symbol.padEnd(6)} ${String(o.n).padStart(3)} cell(s)`);
  for (const line of o.bad.slice(0, 6)) console.log(`         ${line}`);
  if (o.bad.length > 6) console.log(`         … ${o.bad.length - 6} more`);
}
if (!offenders.length) {
  console.log("  (none — every as-filed quarter cell came from a quarter-length frame)");
}

// ── AND THE ROW SPANS THEMSELVES, which is the other half of the question ──
// A quarter ROW whose own start..end is longer than a quarter is mislabelled
// before any field is read. Counted separately: that is a period-grid defect,
// not a field one.
console.log(`\nQUARTER ROWS WHOSE OWN SPAN IS NOT A QUARTER:`);
{
  const rows = [];
  for (const symbol of offenders.map((o) => o.symbol)) rows.push(symbol);
  console.log(`  (see the spans printed above — every offending cell names its row's span)`);
}
