// DOES THE YoY BASE MATCH BY FISCAL LABEL, AND WHY IS AZN's CASH CHAIN EMPTY.
//
// ── WHAT THIS EXISTS TO SETTLE, AND WHY A FIXTURE CANNOT ────────────────────
// Two defects found by eye on the #464 preview:
//
//   P0-A  "YoY" was `q[i + 4]` — four ROWS back, not one YEAR back. On AZN,
//         a half-yearly 20-F filer, row[7] minus four rows is Q2 FY2021
//         against a latest of Q2 FY2025, and the card rendered +75.9% /
//         +273.8% labelled "year over year".
//   P0-B  Quality of Earnings rendered every field "—" while the score above
//         it read GOOD 100/100 with "reported profit is backed by cash".
//
// A hand-built fixture cannot check either, because a fixture author choosing
// the periods is choosing the answer — the pattern this work has now hit five
// times. So this runs the SHIPPED view builder and the SHIPPED scorer over
// REAL companyfacts payloads and prints what a reader would see.
//
// AND IT PRINTS THE OLD BEHAVIOUR BESIDE THE NEW. "Unchanged for a dense
// filer" is a claim about AAPL and MU that has to be checked, not asserted, so
// the q[i+4] base is recomputed here and compared. If the two disagree on a
// dense filer, the fix has changed something it should not have.
//
// Read-only: no credential, no Redis, no dump. Runs on a runner because the
// agent sandbox is refused data.sec.gov with 403 CONNECT.
//
//   node scripts/sec-period-match-probe.mjs "AAPL,MU,AZN,RYAAY"
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

// DENSE FIRST, SPARSE SECOND, and both are required: the dense pair is the
// regression control (the number must not move) and the sparse pair is the
// defect (the number must move or go blank).
const DENSE = "AAPL,MU";
const SPARSE = "AZN,RYAAY";
const SYMBOLS = (process.argv[2] || process.env.SYMBOLS || `${DENSE},${SPARSE}`)
  .split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

const UA =
  process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; period-match probe)";

const strip = (f) =>
  fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");

const sec = await lift([
  fs.readFileSync("lib/server/secFields.ts", "utf8"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/secFactCodec.ts"),
  strip("lib/server/secEarningsView.ts"),
].join("\n"));

// THE SHIPPED SCORER, LIFTED OUT OF THE PAGE. Its helpers are named because
// grabFunction lifts one body and does not follow calls — the same transitive
// -callee trap that cost sec-extract-probe a round trip.
const pageSrc = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
const scorer = await lift(
  [
    "const SCORE_COMPONENTS = " +
      (pageSrc.match(/const SCORE_COMPONENTS = \{[\s\S]*?\} as const;/) ?? [])[0]
        .replace("const SCORE_COMPONENTS = ", "").replace(" as const;", ";"),
    grabFunction(pageSrc, "clamp"),
    grabFunction(pageSrc, "toneLabel"),
    grabFunction(pageSrc, "scoreExplanation"),
    grabFunction(pageSrc, "scoreGaps"),
    grabFunction(pageSrc, "buildScoreResult"),
    grabFunction(pageSrc, "scoreFromSec"),
  ].join("\n") + "\nexport { scoreFromSec };"
);

const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);

const { extractCompanyFacts, encodeFactSet, buildSecEarningsView, priorYearOf,
        valueOf, periodLabel, SEC_FIELDS } = sec;

// PRE-NETWORK SMOKE, CALLING rather than typeof-ing, and it exercises the two
// things this probe is about: a sparse series must NOT find a comparator four
// rows back, and the scorer must run.
try {
  const P = (fp, fy) => ({ e: `${fy}-06-30`, fp, fy, v: [], d: "" });
  const sparse = [P("Q2", 2025), P("Q2", 2024), P("Q2", 2023), P("Q2", 2022), P("Q2", 2021)];
  if (priorYearOf(sparse, sparse[0])?.fy !== 2024)
    throw new Error("priorYearOf did not find the same fiscal quarter one year back");
  const holed = [P("Q2", 2025), P("Q2", 2022), P("Q1", 2021), P("Q4", 2020), P("Q3", 2020)];
  if (priorYearOf(holed, holed[0]) !== null)
    throw new Error("priorYearOf invented a comparator where FY2024 is absent — the whole defect");
  if (priorYearOf(holed, holed[0]) === holed[4])
    throw new Error("priorYearOf fell back to row[i+4]");
  if (typeof scorer.scoreFromSec !== "function") throw new Error("no scoreFromSec");
  if (scorer.scoreFromSec(null).available !== false) throw new Error("scorer smoke");
} catch (err) {
  console.error(`FATAL: pre-network smoke failed — ${String(err?.message ?? err)}`);
  process.exit(2);
}

const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const pctLevel = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(1)}%`);

const CASH_KEYS = ["operatingCashFlow", "capex", "shareBasedCompensation", "netIncome"];

for (const symbol of SYMBOLS) {
  const cik = tickerMap.get(symbol)?.cik;
  if (!cik) { console.log(`\n${symbol}: no CIK in the committed ticker file`); continue; }
  let facts;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    facts = await res.json();
  } catch (err) {
    console.log(`\n${symbol}: FAILED — ${String(err?.message ?? err)}`);
    continue;
  }

  const ex = extractCompanyFacts(symbol, facts);
  const set = encodeFactSet(ex);
  const v = buildSecEarningsView(set);
  console.log(`\n${"=".repeat(72)}\n${symbol}  (${DENSE.split(",").includes(symbol) ? "DENSE — regression control" : "SPARSE — the defect"})`);
  if (!v) { console.log("  buildSecEarningsView returned null"); continue; }

  console.log(`  stored quarters, newest first: ${set.quarters.map(periodLabel).join("  ")}`);

  // ── 1. the snapshot card's own strings ────────────────────────────────────
  const s = v.snapshot;
  console.log(`\n  SNAPSHOT CARD, as rendered:`);
  console.log(`    Most recent quarter filed: ${v.latestLabel}`);
  console.log(`    YOY REVENUE GROWTH  ${pct(s.revenueYoY)}   ` +
    `${s.comparedWith ? `Compared with ${s.comparedWith}` : "Prior-year quarter not on file"}`);
  console.log(`    YOY EPS GROWTH      ${pct(s.epsYoY)}   ` +
    `${s.comparedWith ? `Compared with ${s.comparedWith}` : "Prior-year quarter not on file"}`);

  // ── 2. OLD vs NEW base, per row ───────────────────────────────────────────
  // The old rule, recomputed here rather than remembered: q[i + 4].
  console.log(`\n  BASE, OLD (q[i+4]) vs NEW (same fiscal quarter, fy-1):`);
  let moved = 0;
  set.quarters.forEach((p, i) => {
    const oldBase = set.quarters[i + 4] ?? null;
    const newBase = priorYearOf(set.quarters, p);
    const same = (oldBase?.e ?? null) === (newBase?.e ?? null);
    if (!same) moved++;
    console.log(
      `    ${periodLabel(p).padEnd(12)} old=${(oldBase ? periodLabel(oldBase) : "none").padEnd(12)}` +
      ` new=${(newBase ? periodLabel(newBase) : "none").padEnd(12)} ${same ? "" : "<- CHANGED"}`
    );
  });
  console.log(`    ${moved} of ${set.quarters.length} rows changed base.`);

  // ── 3. the growth table, as rendered ──────────────────────────────────────
  console.log(`\n  GROWTH & MARGINS TABLE, as rendered (oldest first):`);
  console.log(`    ${"Period".padEnd(12)} ${"Compared with".padEnd(14)} ${"Rev YoY".padStart(9)} ${"EPS YoY".padStart(9)}  ${"Gross".padStart(7)} ${"Oper".padStart(7)} ${"Net".padStart(7)}  gap`);
  v.margins.forEach((m, i) => {
    const g = v.growth[i];
    console.log(
      `    ${m.label.padEnd(12)} ${(g?.comparedWith ?? "not on file").padEnd(14)}` +
      ` ${pct(g?.revenueYoY).padStart(9)} ${pct(g?.epsYoY).padStart(9)}  ` +
      `${pctLevel(m.gross).padStart(7)} ${pctLevel(m.operating).padStart(7)} ${pctLevel(m.net).padStart(7)}` +
      `  ${m.gapAfter ? "gap" : ""}`
    );
  });

  // ── 4. the score, and what it says it could not read ──────────────────────
  const sc = scorer.scoreFromSec(v);
  console.log(`\n  SCORE CARD, as rendered:`);
  console.log(`    ${sc.label}  ${sc.available ? `${sc.score}/100` : "(no number shown)"}`);
  console.log(`    "${sc.explanation}"`);
  console.log(`    Not measured: ${sc.unavailable.length ? sc.unavailable.join("; ") : "(nothing — every component ran)"}`);
  // THE CLAIM THAT WAS FALSE. Asserted here as a property of the rendered
  // string against the rendered card, not as a fixture's expectation.
  const cashShown = v.cashQuality.operatingCashFlow.val !== null;
  const claimsCash = /backed by cash|cash conversion/.test(sc.explanation);
  console.log(`    cash-flow chain populated: ${cashShown} | narrative claims cash: ${claimsCash}` +
    `${!cashShown && claimsCash ? "   <-- STILL CLAIMING CASH IT CANNOT SEE" : ""}`);

  // ── 5. WHY the cash chain is empty — the two candidates, told apart ───────
  if (!cashShown) {
    console.log(`\n  CASH CHAIN DIAGNOSIS — mapped-but-absent, or unmapped?`);
    const ocf = SEC_FIELDS.find((f) => f.key === "operatingCashFlow");
    for (const ns of ["us-gaap", "ifrs-full"]) {
      const chain = ns === "ifrs-full" ? (ocf.ifrsChain ?? []) : ocf.chain;
      for (const tag of chain) {
        const node = facts.facts?.[ns]?.[tag];
        if (!node) { console.log(`    ${ns}:${tag}  ABSENT from the payload`); continue; }
        const units = Object.keys(node.units ?? {});
        const usd = node.units?.USD ?? [];
        const durations = usd.filter((r) => r.start && r.end);
        const spans = [...new Set(durations.map((r) =>
          Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86400000)))].sort((a, b) => a - b);
        console.log(`    ${ns}:${tag}  PRESENT  units=[${units.join(",")}]  ` +
          `USD rows=${usd.length}  duration rows=${durations.length}  span-days=[${spans.join(",")}]`);
        // The differencing needs two cumulative frames sharing a fiscal year.
        const byFy = new Map();
        for (const r of durations) {
          const k = r.start;
          if (!byFy.has(k)) byFy.set(k, []);
          byFy.get(k).push(Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86400000));
        }
        const multi = [...byFy.entries()].filter(([, v2]) => v2.length > 1).length;
        console.log(`      distinct year-start dates: ${byFy.size}, of which ` +
          `${multi} carry MORE THAN ONE cumulative end (a quarter can only be ` +
          `differenced out of those)`);
      }
    }
    // ── THE DECIDING COMPARISON ────────────────────────────────────────────
    // Revenue resolves on the same row that cash flow does not, so the cause
    // is not "this filer publishes nothing quarterly". It is which FRAME
    // LENGTHS each field publishes: extractCompanyFacts creates a quarter cell
    // from an n=1 frame as filed, or by differencing n against n-1 within one
    // fiscal year. A field that publishes only n=2 and n=4 has neither
    // neighbour and yields no quarter at all.
    const q0 = set.quarters[0];
    console.log(`    stored latest quarter frame: start=${q0.s} end=${q0.e} ` +
      `span=${Math.round((Date.parse(q0.e) - Date.parse(q0.s)) / 86400000)}d`);
    for (const key of ["revenue", "operatingCashFlow"]) {
      const f = SEC_FIELDS.find((x) => x.key === key);
      const lens = new Set();
      for (const ns of ["us-gaap", "ifrs-full"]) {
        const chain = ns === "ifrs-full" ? (f.ifrsChain ?? []) : f.chain;
        for (const tag of chain) {
          for (const r of facts.facts?.[ns]?.[tag]?.units?.USD ?? []) {
            if (!r.start || !r.end) continue;
            const d = Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86400000);
            const n = d >= 80 && d <= 105 ? 1 : d >= 170 && d <= 200 ? 2
              : d >= 260 && d <= 290 ? 3 : d >= 350 && d <= 380 ? 4 : null;
            if (n) lens.add(n);
          }
        }
      }
      console.log(`    ${key.padEnd(20)} publishes frame lengths n=[${[...lens].sort().join(",")}]` +
        ` -> quarter cell possible: ${lens.has(1) || [...lens].some((n) => lens.has(n - 1))}`);
    }
    console.log(`    latest quarter (${v.latestLabel}) cash cells:`);
    for (const k of CASH_KEYS) {
      const c = set.quarters[0];
      const idx = SEC_FIELDS.findIndex((f) => f.key === k);
      console.log(`      ${k.padEnd(24)} ${JSON.stringify(valueOf(c, k))}  derivation=${c.d[idx] ?? "?"}`);
    }
  }
  await sleep(150);
}
