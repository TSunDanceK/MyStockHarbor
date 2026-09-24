// A LISTED COMPANY THAT MOVED TO A NEW CIK (#552 COWORK #28, XOM).
//
//   1. The cited map: XOM's successor CIK is the one the ticker file maps XOM
//      to, and every entry carries evidence.
//   2. On XOM-shaped payloads, through the SHIPPED extractor: the successor
//      alone has two unlabelled quarters and no year (the bug); merged with
//      its predecessor it has fiscal years and labelled quarters, the newest
//      being the successor's own. MUTATION: the merge skipped.
//   3. The 1:1 guard: cover counts that disagree refuse the merge. MUTATION:
//      the guard removed.
//   4. Every companyfacts reader merges before it extracts (cold fetch, the
//      sec-facts cron, the sec-filings job). MUTATION: one reader unwired.
//
//   node scripts/check-sec-succession.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};

const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const MAP = JSON.parse(fs.readFileSync("data/sec/successor-ciks.json", "utf8"));
const FILL = readCodeOnly("lib/server/secFilingFill.ts");
const SUCC = strip("lib/server/secSuccession.ts");
const load = (succ = SUCC) => lift([
  readCodeOnly("lib/server/secFields.ts"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  `const successorsFile = ${JSON.stringify(MAP)};`,
  FILL.match(/^const foreignCurrencyIn = [\s\S]*?;$/m)?.[0] ?? "",
  grabFunction(FILL, "mergeFillOnly"),
  succ,
  "export { extractCompanyFacts, mergeSuccession, withPredecessorFacts, predecessorCikFor };",
].join("\n"));
const M = await load();

console.log("1. the cited map");
const tickers = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const xomCik = tickers.data.find((r) => r[2] === "XOM")?.[0];
const xom = MAP.successors.find((s) => s.symbol === "XOM");
check("XOM's successor CIK is the ticker file's XOM CIK", xom && Number(xom.cik) === Number(xomCik), `${xom?.cik} vs ${xomCik}`);
check("every entry names a predecessor and cites evidence",
  MAP.successors.every((s) => s.predecessorCik && s.cik !== s.predecessorCik && s.evidence?.length >= 2));
check("a CIK with no entry has no predecessor", M.predecessorCikFor(320193) === null && M.predecessorCikFor(xom.cik) === "0000034088");

// ── XOM-shaped payloads ────────────────────────────────────────────────────
const row = (start, end, val, form, fy, fp, accn, filed) => ({ start, end, val, form, fy, fp, accn, filed });
const income = (rows) => ({ units: { USD: rows } });
const perShare = (rows) => ({ units: { "USD/shares": rows } });
const cover = (end, val, accn) => ({ units: { shares: [{ end, val, accn, form: "10-Q", fy: 2026, fp: "Q2", filed: end }] } });
const K = "0000034088-26-000045", Q1 = "0000034088-25-000030", Q2 = "0000034088-25-000042", Q3 = "0000034088-25-000061";
const Q126 = "0000034088-26-000067", Q226 = "0000034088-26-000093";
const PRED = {
  cik: 34088, entityName: "EXXON MOBIL CORP",
  facts: {
    dei: { EntityCommonStockSharesOutstanding: cover("2026-07-25", 4_200_000_000, Q226) },
    "us-gaap": {
      NetIncomeLoss: income([
        row("2025-01-01", "2025-12-31", 28_800, "10-K", 2025, "FY", K, "2026-02-18"),
        row("2025-01-01", "2025-03-31", 7_700, "10-Q", 2025, "Q1", Q1, "2025-05-01"),
        row("2025-04-01", "2025-06-30", 7_100, "10-Q", 2025, "Q2", Q2, "2025-08-04"),
        row("2025-07-01", "2025-09-30", 7_500, "10-Q", 2025, "Q3", Q3, "2025-11-03"),
        row("2026-01-01", "2026-03-31", 8_000, "10-Q", 2026, "Q1", Q126, "2026-05-04"),
        row("2026-04-01", "2026-06-30", 14_900, "10-Q", 2026, "Q2", Q226, "2026-08-03"),
      ]),
      EarningsPerShareDiluted: perShare([
        row("2025-01-01", "2025-12-31", 6.70, "10-K", 2025, "FY", K, "2026-02-18"),
        row("2025-01-01", "2025-03-31", 1.76, "10-Q", 2025, "Q1", Q1, "2025-05-01"),
        row("2025-04-01", "2025-06-30", 1.64, "10-Q", 2025, "Q2", Q2, "2025-08-04"),
        row("2025-07-01", "2025-09-30", 1.76, "10-Q", 2025, "Q3", Q3, "2025-11-03"),
        row("2026-01-01", "2026-03-31", 1.90, "10-Q", 2026, "Q1", Q126, "2026-05-04"),
        row("2026-04-01", "2026-06-30", 3.48, "10-Q", 2026, "Q2", Q226, "2026-08-03"),
      ]),
    },
  },
};
const SUCC_FACTS = (coverVal) => ({
  cik: 2115436, entityName: "ExxonMobil Holdings Corp",
  facts: {
    dei: { EntityCommonStockSharesOutstanding: cover("2026-07-30", coverVal, Q226) },
    "us-gaap": {
      NetIncomeLoss: income([
        row("2025-04-01", "2025-06-30", 7_100, "10-Q", 2026, "Q2", Q226, "2026-08-03"),
        row("2026-04-01", "2026-06-30", 14_900, "10-Q", 2026, "Q2", Q226, "2026-08-03"),
      ]),
      EarningsPerShareDiluted: perShare([
        row("2025-04-01", "2025-06-30", 1.64, "10-Q", 2026, "Q2", Q226, "2026-08-03"),
        row("2026-04-01", "2026-06-30", 3.48, "10-Q", 2026, "Q2", Q226, "2026-08-03"),
      ]),
    },
  },
});
const fetcher = (cik) => Promise.resolve(Number(cik) === 34088 ? PRED : { cik: Number(cik), facts: {} });
const shape = (x) => ({ q: x.quarters.length, unlabelled: x.quarters.filter((p) => !p.fp).length, y: x.years.length, newest: x.quarters[0] ? `${x.quarters[0].end} ${x.quarters[0].fp}` : null });

console.log("\n2. the merge, through the shipped extractor");
{
  const alone = shape(M.extractCompanyFacts("XOM", SUCC_FACTS(4_200_000_000)));
  check("the successor alone: two unlabelled quarters and no year (the bug, reproduced)",
    alone.q === 2 && alone.unlabelled === 2 && alone.y === 0, JSON.stringify(alone));
  const facts = await M.withPredecessorFacts(2115436, SUCC_FACTS(4_200_000_000), fetcher);
  const merged = shape(M.extractCompanyFacts("XOM", facts));
  check("merged: a fiscal year, every quarter labelled, the newest is Q2 2026",
    merged.y >= 1 && merged.unlabelled === 0 && merged.q >= 5 && merged.newest === "2026-06-30 Q2", JSON.stringify(merged));
  check("the merged payload keeps the successor's identity", facts.cik === 2115436 && facts.entityName === "ExxonMobil Holdings Corp");
  const other = await M.withPredecessorFacts(320193, { cik: 320193, facts: {} }, () => { throw new Error("fetched for an uncited CIK"); });
  check("an uncited CIK costs no fetch and is returned as is", other.cik === 320193);
  const Mm = await load(once(SUCC, "if (!pred) return facts;", "return facts;"));
  const mut = shape(Mm.extractCompanyFacts("XOM", await Mm.withPredecessorFacts(2115436, SUCC_FACTS(4_200_000_000), fetcher)));
  check("MUTATION: merge skipped → back to no year and unlabelled quarters", mut.y === 0 && mut.unlabelled > 0, JSON.stringify(mut));
}

console.log("\n3. the 1:1 guard");
{
  const out = M.mergeSuccession(SUCC_FACTS(8_400_000_000), PRED);
  check("cover counts 2:1 apart refuse the merge, and say why", out.merged === false && /not a 1:1/.test(out.note), out.note);
  const Mm = await load(once(SUCC, "if (a === null || b === null || Math.abs(a / b - 1) > SUCCESSION_SHARE_TOLERANCE) {", "if (a === null || b === null) {"));
  check("MUTATION: guard removed → a 2:1 history is spliced in", Mm.mergeSuccession(SUCC_FACTS(8_400_000_000), PRED).merged === true);
}

console.log("\n4. every companyfacts reader merges before extracting");
const READERS = {
  "lib/server/secColdFetch.ts": /withPredecessorFacts\(cik, await fetchFactsFor\(cik\), fetchFactsFor\)[\s\S]*extractForSymbol\(symbol, facts\)/,
  "app/api/jobs/sec-facts/route.ts": /withPredecessorFacts\(cik, await fetchCompanyFacts\(cik\), fetchCompanyFacts\);\s*const extracted = extractForSymbol\(symbol, facts\)/,
  "lib/server/secFilingJob.ts": /const cf = await withPredecessorFacts\(cik, await fetch\.companyFacts\(cik\), fetch\.companyFacts\);\s*const base = extractForSymbol\(symbol, cf\)/,
};
const wired = (srcs) => Object.entries(READERS).every(([f, re]) => re.test(srcs[f]));
const SRCS = Object.fromEntries(Object.keys(READERS).map((f) => [f, readCodeOnly(f)]));
check("cold fetch, the sec-facts cron and the sec-filings job all merge", wired(SRCS));
check("MUTATION: the cron unwired → caught",
  !wired({ ...SRCS, "app/api/jobs/sec-facts/route.ts": once(SRCS["app/api/jobs/sec-facts/route.ts"],
    "withPredecessorFacts(cik, await fetchCompanyFacts(cik), fetchCompanyFacts)", "await fetchCompanyFacts(cik)") }));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
