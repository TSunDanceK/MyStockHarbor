// WHERE DOES THE QUALITY OF EARNINGS CARD'S NET INCOME ACTUALLY COME FROM? —
// the cell, the frame that produced it, and the filer's raw ladder beside it.
//
// ── THE REPORT ────────────────────────────────────────────────────────────
// NVDA Q2 FY2027: net income $59.69B against a derived operating cash flow of
// $24.08B, "cash flow less net income −$35.61B". Those two figures are read
// from the SAME PeriodRecord by secEarningsView (both `view(cashFrom, …)`), so
// if they disagree by thirty-five billion either one cell is built from the
// wrong frame or the business really did that.
//
// sec-frame-length-probe already established that no AS-FILED quarter cell
// comes from a longer-than-quarter frame (1420 cells, 816 as-filed, 0
// offenders across 7 SYMBOLS). That exonerates one half. It says NOTHING about
// a DIFFERENCED cell, whose span is `prior.end .. f.end` and is never checked
// against the row it lands in — and nothing about two fields in one row
// landing from DIFFERENT frames, which is the mix the card must never show.
//
// ── WHAT THIS PRINTS ──────────────────────────────────────────────────────
// Per symbol, for the newest quarters and years:
//   the row's own start..end, and per cash-card field the value, the
//   derivation, the concept, and — for a differenced cell — the two ends it
//   was differenced across, with that difference's span in days.
// Then the RAW ladder from the payload for net income and operating cash flow,
// so the extractor's arithmetic can be checked against what the filer filed.
//
// Read-only: no credential, no store, no writes. Needs the network.
//
//   SYMBOLS="NVDA" ROWS=6 node scripts/sec-cash-card-probe.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; cash card audit)";
const ROWS = Number(process.env.ROWS || 6);

const strip = (f) =>
  fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");
const sec = await lift([
  fs.readFileSync("lib/server/secFields.ts", "utf8"),
  strip("lib/server/secExtract.ts"),
].join("\n"));
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);
const { SEC_FIELDS, extractCompanyFacts } = sec;
const IDX = Object.fromEntries(SEC_FIELDS.map((f, i) => [f.key, i]));

// The card's own fields, in the order secEarningsView reads them.
const CARD = ["revenue", "netIncome", "operatingCashFlow", "capex", "shareBasedCompensation"];
// The concepts behind the two figures the report puts side by side.
const RAW_TAGS = [
  "NetIncomeLoss", "ProfitLoss",
  "NetCashProvidedByUsedInOperatingActivities",
  "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
];

const SYMBOLS = (process.env.SYMBOLS || "NVDA").split(/[,\s]+/)
  .map((s) => s.trim().toUpperCase()).filter(Boolean);
const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const bn = (v) => (v === null || v === undefined ? "—" : `${(v / 1e9).toFixed(2)}B`);

for (const symbol of SYMBOLS) {
  const cik = tickerMap.get(symbol)?.cik;
  if (!cik) { console.log(`${symbol}: no CIK\n`); continue; }
  let facts;
  try {
    if (process.env.FACTS_DIR) {
      facts = JSON.parse(fs.readFileSync(`${process.env.FACTS_DIR}/CIK${cik}.json`, "utf8"));
    } else {
      const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
        headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
      });
      if (!res.ok) { console.log(`${symbol}: HTTP ${res.status}\n`); continue; }
      facts = await res.json();
    }
  } catch (e) { console.log(`${symbol}: ${e.message}\n`); continue; }

  const out = extractCompanyFacts(symbol, facts);
  console.log("=".repeat(78));
  console.log(`${symbol}  CIK ${cik}  ${out.entityName ?? ""}`);
  console.log("=".repeat(78));

  for (const [name, list] of [["QUARTERS", out.quarters], ["YEARS", out.years]]) {
    console.log(`\n${name} (newest ${ROWS}):`);
    for (const p of list.slice(0, ROWS)) {
      const rowSpan = p.start ? days(p.start, p.end) : null;
      console.log(
        `\n  ${p.fp ?? "?"} FY${p.fy ?? "?"}  row ${p.start ?? "?"}..${p.end}` +
          ` (${rowSpan ?? "?"}d)  filed ${p.filed ?? "?"} ${p.accession ?? ""}`
      );
      for (const key of CARD) {
        const v = p.values[IDX[key]];
        if (!v) { console.log(`      ${key.padEnd(24)} —`); continue; }
        // THE CELL'S OWN SPAN, which is the thing the row's start cannot tell
        // you: quarterMeta keeps ONE start per end, written by whichever field
        // reached it first and overwritten by every differenced write after.
        const cellSpan = v.from ? days(v.from[0], v.from[1]) : rowSpan;
        console.log(
          `      ${key.padEnd(24)} ${String(bn(v.val)).padStart(10)}  ${String(v.derived).padEnd(12)}` +
            ` span=${cellSpan ?? "?"}d  ${v.ns}|${v.tag}` +
            (v.from ? `  from ${v.from[0]}..${v.from[1]}` : "")
        );
      }
    }
  }

  if (out.notes?.length) {
    console.log(`\nNOTES (${out.notes.length}):`);
    for (const n of out.notes.slice(0, 20)) console.log(`  ${n}`);
  }

  // ── THE FILER'S OWN LADDER, uncollapsed ─────────────────────────────────
  // Every duration row for the two concepts, newest ends first, so the
  // extractor's difference can be checked against what was actually filed.
  const cutoff = out.quarters[0]?.end
    ? new Date(Date.parse(out.quarters[0].end) - 800 * 86400000).toISOString().slice(0, 10)
    : "2000-01-01";
  console.log(`\nRAW FILED FRAMES (ends >= ${cutoff}):`);
  for (const tag of RAW_TAGS) {
    for (const ns of ["us-gaap", "ifrs-full"]) {
      const units = facts?.facts?.[ns]?.[tag]?.units ?? null;
      if (!units) continue;
      for (const [unit, rowsRaw] of Object.entries(units)) {
        const rows = rowsRaw
          .filter((r) => r.start && r.end && r.end >= cutoff)
          .sort((a, b) => (a.end === b.end ? String(a.start).localeCompare(String(b.start)) : a.end < b.end ? 1 : -1));
        if (!rows.length) continue;
        console.log(`\n  ${ns}|${tag} [${unit}] — ${rows.length} rows`);
        for (const r of rows.slice(0, 40)) {
          console.log(
            `    ${r.start}..${r.end} ${String(days(r.start, r.end)).padStart(4)}d ` +
              `${String(bn(r.val)).padStart(10)}  ${String(r.form).padEnd(6)} ` +
              `${r.fy ?? "?"}${r.fp ?? "?"} filed ${r.filed ?? "?"} ${r.accn ?? ""}` +
              (r.frame ? `  frame=${r.frame}` : "")
          );
        }
        if (rows.length > 40) console.log(`    … ${rows.length - 40} more`);
      }
    }
  }
  console.log("");
}
