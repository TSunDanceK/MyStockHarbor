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
// For every stored QUARTER row and every duration field, the frame the CELL
// ITSELF covers — `FieldValue.covers`, which the extractor now stamps on every
// duration write.
//
// THE FIRST VERSION OF THIS PROBE MEASURED THE ROW, AND THAT WAS THE WRONG
// THING. `quarterMeta` keeps ONE start per period end, written by whichever
// field reached that end first and overwritten by every differenced write
// after it, so a PeriodRecord's `start` is one field's frame and not the
// row's. Measured against it, a differenced cell was compared to its own
// start (vacuous) and an as-filed cell to a neighbour's. The 0/1420 it
// reported was true of the as-filed half and said nothing about the rest.
//
// Two counts, kept apart:
//   SPAN      a cell whose own frame is not one quarter (quartersCovered != 1)
//   MIX       a cell covering a DIFFERENT quarter from the rest of its row
//             (sameFrame: same end, starts within SAME_FRAME_SLACK_DAYS)
//
// EITHER IS THE DEFECT. Reported per symbol and per field, so the count is in
// SYMBOLS and in CELLS separately, and netIncome — the field the NVDA report
// was about — is counted on its own line.
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
const LIMIT = Number(process.env.LIMIT || 300);

const strip = (f) =>
  fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");
const sec = await lift([
  fs.readFileSync("lib/server/secFields.ts", "utf8"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  strip("lib/server/secFactCodec.ts"),
].join("\n"));
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);
const { SEC_FIELDS, extractCompanyFacts, quartersCovered, spanDays, sameFrame } = sec;

// EVERY DURATION FIELD, not only the cumulative ones. A duration-average or
// duration-ratio cell sits in the same row and is read by the same card, so
// leaving it out would exempt exactly the share counts and per-share figures a
// mixed row is most visible in.
const DUR = SEC_FIELDS.map((f, i) => [f, i])
  .filter(([f]) => f.kind !== "instant")
  .map(([f, i]) => [f.key, i]);
console.log(`${DUR.length} duration fields checked per quarter row\n`);

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

const offenders = [];
let cellsChecked = 0, cellsSpan = 0, cellsMix = 0, niBad = 0, niSymbols = new Set();
let read = 0, failed = 0, noCik = 0;

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

  // THE SHIPPED EXTRACTOR, not a re-implementation, and pre-encode: `covers`
  // lives on FieldValue and the encoded set keeps only {val, derived}.
  const out = extractCompanyFacts(symbol, facts);
  const bad = [];
  for (const q of out.quarters) {
    const cells = DUR.map(([key, i]) => [key, q.values[i]]).filter(([, v]) => v && v.val !== null);
    // THE ROW'S FRAME IS THE MODAL ONE, not the first field's. Taking cells[0]
    // would let a single bad cell in field order report every OTHER cell as the
    // mix — the count would be right about there being a problem and wrong
    // about its size, which is the kind of number that gets quoted.
    const tally = new Map();
    for (const [, v] of cells) {
      if (!v.covers) continue;
      const k = v.covers.join("..");
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    const modal = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const ref = modal ? { covers: modal.split("..") } : undefined;
    for (const [key, v] of cells) {
      cellsChecked++;
      if (!v.covers) {
        cellsSpan++;
        bad.push(`${q.fp ?? "?"} FY${q.fy ?? "?"} ${q.end} ${key}: NO COVERS`);
        continue;
      }
      const n = quartersCovered(spanDays(v.covers[0], v.covers[1]));
      if (n !== 1) {
        cellsSpan++;
        if (key === "netIncome") { niBad++; niSymbols.add(symbol); }
        bad.push(
          `${q.fp ?? "?"} FY${q.fy ?? "?"} ${q.end} ${key} SPAN covers ${v.covers.join("..")}` +
            ` = ${n ?? "no"} quarter(s) [${v.derived}]`
        );
        continue;
      }
      if (!sameFrame(v.covers, ref?.covers)) {
        cellsMix++;
        if (key === "netIncome") { niBad++; niSymbols.add(symbol); }
        bad.push(
          `${q.fp ?? "?"} FY${q.fy ?? "?"} ${q.end} ${key} MIX covers ${v.covers.join("..")}` +
            ` but the row covers ${ref?.covers?.join("..") ?? "?"} [${v.derived}]`
        );
      }
    }
  }
  if (bad.length) offenders.push({ symbol, n: bad.length, bad });
}

console.log("=".repeat(76));
console.log(`READ ${read} SYMBOLS of ${targets.length} (${noCik} no CIK, ${failed} fetch failed)`);
console.log(`${cellsChecked} duration CELLS on quarter rows\n`);
console.log(`QUARTER ROWS THAT DO NOT COVER ONE PERIOD:`);
console.log(`  ${cellsSpan} CELLS whose own frame is not one quarter`);
console.log(`  ${cellsMix} CELLS covering a different quarter from the rest of their row`);
console.log(`  across ${offenders.length} SYMBOLS of ${read} read\n`);
// THE FIELD THE REPORT WAS ABOUT, counted on its own line because "how many
// SYMBOLS have netIncome from a longer frame than the row's period" is the
// question that was asked, and a total over 30 fields does not answer it.
console.log(`NET INCOME SPECIFICALLY: ${niBad} CELLS across ${niSymbols.size} SYMBOLS` +
  (niSymbols.size ? ` — ${[...niSymbols].sort().join(", ")}` : ""));
console.log("");
for (const o of offenders.sort((a, b) => b.n - a.n).slice(0, 30)) {
  console.log(`  ${o.symbol.padEnd(6)} ${String(o.n).padStart(3)} cell(s)`);
  for (const line of o.bad.slice(0, 6)) console.log(`         ${line}`);
  if (o.bad.length > 6) console.log(`         … ${o.bad.length - 6} more`);
}
if (!offenders.length) {
  console.log("  (none — every duration cell covers one quarter, and the same one)");
}
