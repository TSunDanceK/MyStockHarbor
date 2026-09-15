// STEP 3, STEP 2 — run the shipped extraction over five real filers and diff
// every extracted number against the frozen FMP ground truth.
//
// FIVE SYMBOLS, DELIBERATELY: ARM, AAPL, MU, PLAB, ASTS. The ones the earlier
// probes already covered, so the fiscal-year spread (31 Mar, 26 Sep, 3 Sep,
// 31 Oct, 31 Dec) is already known and a surprise here is the extraction's, not
// the sample's. No manifest, no cron, no universe: companyfacts is fetched
// directly by CIK.
//
// THE EXTRACTION IS LIFTED, NOT REIMPLEMENTED. lib/server/secExtract.ts is the
// thing under test; a probe with its own differencing would agree with itself
// and with nothing else. Same rule the window fixture is built under.
//
// WHY IT RUNS ON A RUNNER. The agent sandbox is refused data.sec.gov with
// 403 CONNECT. Read-only: no credential, no Redis, no write- prefix. It needs
// the frozen dump for the FMP side of the diff.
//
// WHAT THE GROUND TRUTH ACTUALLY COVERS — READ THIS BEFORE READING THE DIFF.
// The dump is a dump of what FMP had put in Redis, and FMP put four numbers per
// report (msh:pickers:earnings:v1) plus a handful of TTM aggregates
// (msh:stockdata:v1). It never held a balance sheet. So of the 43 stored fields
// there is ground truth for at most eight, and the rest are unvalidatable
// against this dump BY CONSTRUCTION. This probe reports that boundary explicitly
// rather than letting "no differences found" read as "all 43 agree".
//
//   node scripts/sec-extract-probe.mjs <dumpDir>
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const DIR = path.resolve(process.argv[2] ?? "step0-dump");
const SYMBOLS = (process.env.SYMBOLS || "ARM,AAPL,MU,PLAB,ASTS")
  .split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

const UA =
  process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; step3 extraction probe)";

// ── lift the shipped modules ────────────────────────────────────────────────
const fieldsSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
const extractSrc = fs
  .readFileSync("lib/server/secExtract.ts", "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "");
const sec = await lift(`${fieldsSrc}\n${extractSrc}`);
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [
    // A TRANSITIVE CALLEE. grabFunction lifts ONE body and does not follow
    // calls, so padCik has to be named. Omitting it threw
    // `ReferenceError: padCik is not defined` on the first local run — which is
    // the whole reason the smoke test below runs BEFORE the first fetch rather
    // than after it. On a runner that same omission costs a round trip.
    grabFunction(tickSrc, "padCik"),
    grabFunction(tickSrc, "parseTickerFile"),
  ].join("\n") + "\nexport { parseTickerFile, padCik };"
);
const { SEC_FIELDS, SEC_FIELD_INDEX, extractCompanyFacts, cashFlowReconciliation, secFieldsHash } = sec;

// A PRE-NETWORK SMOKE TEST, AND IT CALLS THE FUNCTIONS RATHER THAN TYPEOF-ING
// THEM. A missing transitive callee is present as a symbol and absent only when
// the line that uses it runs, so `typeof === "function"` passes on exactly the
// module that is about to throw. Both are exercised here, before any fetch.
try {
  if (typeof extractCompanyFacts !== "function") throw new Error("no extractCompanyFacts");
  const smoke = tick.parseTickerFile(
    '{"fields":["cik","name","ticker","exchange"],"data":[[320193,"Apple Inc.","AAPL","Nasdaq"]]}'
  );
  if (smoke.map.get("AAPL")?.cik !== "0000320193") throw new Error(`parseTickerFile smoke: ${JSON.stringify([...smoke.map])}`);
  const e = extractCompanyFacts("SMOKE", { cik: 1, facts: { "us-gaap": { Assets: { units: { USD: [
    { end: "2026-06-30", val: 1, accn: "a", filed: "2026-07-01" },
  ] } } } } });
  if (e.instants.length !== 1) throw new Error("extractCompanyFacts smoke produced no instant");
} catch (err) {
  console.error(`FATAL: pre-network smoke test failed — ${String(err?.message ?? err)}`);
  process.exit(2);
}

// ── CIKs ────────────────────────────────────────────────────────────────────
const tickerJson = fs.readFileSync("data/sec/company-tickers.json", "utf8");
const { map: tickerMap } = tick.parseTickerFile(tickerJson);
const ciks = new Map();
for (const s of SYMBOLS) {
  const e = tickerMap.get(s);
  if (!e) { console.error(`FATAL: no CIK for ${s} in data/sec/company-tickers.json`); process.exit(2); }
  ciks.set(s, e.cik);
}
console.log(`CIKs: ${[...ciks].map(([s, c]) => `${s}=${c}`).join(" ")}`);
console.log(`fieldsHash: ${secFieldsHash()}\n`);

// ── the FMP ground truth, out of the frozen dump ────────────────────────────
const readDump = (name) => {
  const p = path.join(DIR, `${name}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
};
const earningsDump = readDump("earnings-rows");
const stockDump = readDump("stockdata");
const fundDump = readDump("fundamentals");
if (!earningsDump || !stockDump) {
  console.error(`FATAL: dump at ${DIR} has no earnings-rows.json / stockdata.json. Files: ${fs.existsSync(DIR) ? fs.readdirSync(DIR).join(" ") : "(no dir)"}`);
  process.exit(2);
}
console.log(`dump ${path.basename(DIR)}: earnings-rows ${earningsDump.present} present, stockdata ${stockDump.present} present, dumpedAt ${earningsDump.dumpedAt}\n`);

// ── fetch, paced at SEC's stated ceiling ────────────────────────────────────
const MIN_GAP_MS = Math.ceil(1000 / Number(process.env.SEC_REQS_PER_SEC ?? 8));
let lastAt = 0;
async function paced(url) {
  const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ct = res.headers.get("content-type") ?? "";
  // A 200 carrying HTML is not data. Parsing it as data is how this site got
  // wrong numbers before.
  if (!ct.includes("json")) throw new Error(`expected JSON from ${url}, got ${ct}`);
  return res.json();
}

// ── the diff ────────────────────────────────────────────────────────────────
const at = (rec, key) => rec?.values?.[SEC_FIELD_INDEX[key]] ?? null;
const valOf = (rec, key) => at(rec, key)?.val ?? null;
const fmt = (n) =>
  n === null || n === undefined ? "—"
  : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
  : Math.abs(n) >= 1000 ? n.toLocaleString("en-US")
  : String(Number(n.toFixed(4)));

function rel(a, b) {
  if (a === null || b === null) return null;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / scale;
}
const verdict = (r) =>
  r === null ? "NO-GT" : r <= 0.005 ? "AGREE" : r <= 0.05 ? "CLOSE" : "DIFFER";

/** TTM = the four newest quarters, but only if all four carry the field. */
function ttm(quarters, key) {
  const vals = quarters.slice(0, 4).map((q) => valOf(q, key));
  if (vals.length < 4 || vals.some((v) => v === null)) return null;
  return vals.reduce((a, b) => a + b, 0);
}

const summary = [];

for (const symbol of SYMBOLS) {
  console.log("=".repeat(78));
  console.log(`${symbol}  CIK ${ciks.get(symbol)}`);
  console.log("=".repeat(78));

  let facts;
  try {
    facts = await paced(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(ciks.get(symbol)).padStart(10, "0")}.json`
    );
  } catch (e) {
    console.log(`  FETCH FAILED: ${String(e?.message ?? e)}\n`);
    summary.push({ symbol, error: String(e?.message ?? e) });
    continue;
  }

  const out = extractCompanyFacts(symbol, facts, { quarters: 8, years: 5 });
  console.log(`  ${out.entityName} — ${out.quarters.length} quarters, ${out.years.length} fiscal years, ${out.instants.length} instants`);

  // COVERAGE FIRST. How many of the 43 the extraction actually populated, which
  // is a different question from whether they are right and is the one nothing
  // else in this repo can answer yet.
  const newest = out.quarters[0];
  const newestInstant = out.instants[0];
  const filled = SEC_FIELDS.filter((f) =>
    f.statement === "balance-sheet" ? valOf(newestInstant, f.key) !== null : valOf(newest, f.key) !== null
  );
  const missing = SEC_FIELDS.filter((f) => !filled.includes(f));
  console.log(`  newest quarter ${newest?.start ?? "?"}..${newest?.end ?? "?"} (${newest?.fp ?? "?"} FY${newest?.fy ?? "?"}, accn ${newest?.accession ?? "?"}, filed ${newest?.filed ?? "?"})`);
  console.log(`  newest instant ${newestInstant?.end ?? "?"}`);
  console.log(`  COVERAGE ${filled.length}/43 on the newest period; missing: ${missing.map((f) => f.key).join(", ") || "none"}`);

  const breaks = cashFlowReconciliation(out.quarters);
  console.log(`  cash-flow reconciliation: ${breaks.length ? `${breaks.length} break(s) — ${breaks.map((b) => `${b.end} ${(b.relative * 100).toFixed(1)}%`).join(", ")}` : "all quarters reconcile (or lack a leg)"}`);
  if (out.notes.length) {
    console.log(`  notes (${out.notes.length}):`);
    for (const n of out.notes.slice(0, 8)) console.log(`    - ${n}`);
    if (out.notes.length > 8) console.log(`    ... ${out.notes.length - 8} more`);
  }

  // Every quarter, every field, printed. The owner asked for the diff INCLUDING
  // where the two agree, and a field with no ground truth is a third state that
  // must not read as agreement.
  console.log("\n  --- the 8 quarters, as extracted (derivation in brackets) ---");
  const tags = { "as-filed": "F", differenced: "D", ambiguous: "A" };
  const head = out.quarters.map((q) => q.end.slice(2)).join("  ");
  console.log(`  ${"field".padEnd(34)}${head}`);
  for (const f of SEC_FIELDS) {
    const src = f.statement === "balance-sheet" ? out.instants : out.quarters;
    const cells = src.map((p) => {
      const v = at(p, f.key);
      return (v ? `${fmt(v.val)}${tags[v.derived] ?? "?"}` : "—").padStart(8);
    });
    console.log(`  ${f.key.padEnd(34)}${cells.join("")}`);
  }

  // ── against FMP ───────────────────────────────────────────────────────────
  const fmpRows = (earningsDump.values?.[symbol] ?? []).filter((r) => r?.date);
  const fmpStock = stockDump.values?.[symbol] ?? null;
  const fmpFund = fundDump?.values?.[symbol] ?? null;

  console.log(`\n  --- vs FMP ground truth (earnings rows: ${fmpRows.length}, stockdata: ${fmpStock ? "present" : "ABSENT"}) ---`);

  // FMP's `date` is the ANNOUNCEMENT date, not the period end. Match each row to
  // the latest SEC quarter ending at or before it, within 120 days — and PRINT
  // the offset, so a mis-mapping is visible as a number rather than assumed away.
  const rows = [];
  for (const r of fmpRows) {
    let best = null;
    for (const q of out.quarters) {
      const gap = (Date.parse(r.date) - Date.parse(q.end)) / 86400000;
      if (gap < 0 || gap > 120) continue;
      if (!best || gap < best.gap) best = { q, gap };
    }
    if (!best) continue;
    rows.push({ fmp: r, q: best.q, gap: best.gap });
  }
  if (!rows.length) console.log("    no FMP report row maps to any extracted quarter");

  for (const { fmp, q, gap } of rows) {
    const secRev = valOf(q, "revenue");
    const secD = valOf(q, "epsDiluted");
    const secB = valOf(q, "epsBasic");
    const rr = rel(secRev, fmp.revenueActual ?? null);
    const re = rel(secD, fmp.epsActual ?? null);
    const rb = rel(secB, fmp.epsActual ?? null);
    console.log(
      `    report ${fmp.date} -> quarter ${q.end} (+${Math.round(gap)}d)\n` +
      `      revenue     SEC ${fmt(secRev).padStart(10)}  FMP ${fmt(fmp.revenueActual ?? null).padStart(10)}  ${verdict(rr)}${rr === null ? "" : ` ${(rr * 100).toFixed(2)}%`}\n` +
      `      epsDiluted  SEC ${fmt(secD).padStart(10)}  FMP ${fmt(fmp.epsActual ?? null).padStart(10)}  ${verdict(re)}${re === null ? "" : ` ${(re * 100).toFixed(2)}%`}\n` +
      `      epsBasic    SEC ${fmt(secB).padStart(10)}  (same FMP actual)          ${verdict(rb)}${rb === null ? "" : ` ${(rb * 100).toFixed(2)}%`}`
    );
    summary.push({ symbol, kind: "quarter", end: q.end, revenue: verdict(rr), epsDiluted: verdict(re) });
  }

  if (fmpStock) {
    const fcfQ = out.quarters.slice(0, 4).map((q) => {
      const o = valOf(q, "operatingCashFlow"); const c = valOf(q, "capex");
      return o === null || c === null ? null : o - c;
    });
    const pairs = [
      ["revenue (TTM)", ttm(out.quarters, "revenue"), fmpStock.revenue ?? null],
      ["operatingIncome (TTM)", ttm(out.quarters, "operatingIncome"), fmpStock.operatingIncome ?? null],
      ["netIncome (TTM)", ttm(out.quarters, "netIncome"), fmpStock.netIncome ?? null],
      ["freeCashFlow (TTM)", fcfQ.length === 4 && !fcfQ.some((v) => v === null) ? fcfQ.reduce((a, b) => a + b, 0) : null, fmpStock.freeCashFlow ?? null],
      ["epsTtm", ttm(out.quarters, "epsDiluted"), fmpStock.epsTtm ?? null],
      ["divPerShare (TTM)", ttm(out.quarters, "dividendsDeclaredPerShare"), fmpStock.divPerShare ?? null],
    ];
    console.log(`\n    TTM aggregates (FMP updatedAt ${fmpStock.updatedAt ?? "?"}, quarterlyUpdatedAt ${fmpStock.quarterlyUpdatedAt ?? "—"})`);
    for (const [label, s, f] of pairs) {
      const r = rel(s, f);
      console.log(`      ${label.padEnd(24)} SEC ${fmt(s).padStart(12)}  FMP ${fmt(f).padStart(12)}  ${verdict(r)}${r === null ? "" : ` ${(r * 100).toFixed(2)}%`}`);
      summary.push({ symbol, kind: "ttm", label, verdict: verdict(r) });
    }
  }

  if (fmpFund) {
    const sh = at(newestInstant, "sharesOutstandingCover");
    console.log(`\n    shares / market cap (no price here, so this is reported not diffed)`);
    console.log(`      sharesOutstandingCover   ${sh ? `${fmt(sh.val)} [${sh.derived}]${sh.candidates ? ` candidates ${sh.candidates.map(fmt).join(", ")}` : ""}` : "—"}`);
    console.log(`      FMP marketCap            ${fmt(fmpFund.marketCap ?? null)}   implied price = marketCap / shares = ${sh?.val ? fmt((fmpFund.marketCap ?? 0) / sh.val) : "—"}`);
    console.log(`      FMP peRatio              ${fmt(fmpFund.peRatio ?? null)}`);
  }

  // WHAT COULD NOT BE CHECKED, named field by field. "No differences found" over
  // 8 of 43 fields is not evidence about the other 35, and a report that does not
  // say so invites exactly that reading.
  const GROUND_TRUTHED = new Set([
    "revenue", "epsDiluted", "epsBasic", "operatingIncome", "netIncome",
    "operatingCashFlow", "capex", "dividendsDeclaredPerShare",
  ]);
  const unchecked = SEC_FIELDS.filter((f) => !GROUND_TRUTHED.has(f.key));
  console.log(`\n    NO GROUND TRUTH IN THE DUMP for ${unchecked.length}/43 fields — FMP never cached a balance sheet.`);
  console.log(`      ${unchecked.map((f) => f.key).join(", ")}`);
  console.log("");
}

console.log("=".repeat(78));
console.log("SUMMARY");
const tally = {};
for (const s of summary) {
  const v = s.verdict ?? s.revenue ?? s.error ?? "?";
  tally[v] = (tally[v] ?? 0) + 1;
}
console.log(JSON.stringify(tally));
console.log(JSON.stringify(summary, null, 1));
