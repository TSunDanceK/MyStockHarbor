// WHY A FIELD IS "—" ON A GIVEN FILER: a chain gap, or nothing filed.
//
// ── THE QUESTION THIS ANSWERS, AND WHY IT COMES BEFORE ANY CHAIN CHANGE ────
// A blank cell has two completely different causes and they need opposite
// responses. Either the filer tagged a concept our chain does not list — a
// CHAIN GAP, which we fix by listing it — or the filer published nothing that
// fits — NOT TAGGED, where adding concepts does nothing and reaching for a
// near-miss concept invents a number.
//
// Guessing between them is how a wrong tag gets added and a plausible wrong
// figure ships. So this lists EVERY concept the filer actually tagged in the
// period, filtered by name pattern, WITH ITS VALUE, and says which of the two
// the null is. Same method that settled ASTS.
//
// Read-only: no credential, no store, no writes. Needs the network.
//
//   SYMBOLS="GEV:capex,cash KTOS:capex" node scripts/sec-missing-field-probe.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; missing-field diagnosis)";

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
const { SEC_FIELDS, extractCompanyFacts } = sec;

/** The chain this field actually searches, primary + IFRS, flattened. */
const chainOf = (key) => {
  const f = SEC_FIELDS.find((x) => x.key === key);
  if (!f) return [];
  return [...(f.chain ?? []), ...(f.ifrsChain ?? [])];
};

/**
 * WHAT COUNTS AS "PLAUSIBLY MATCHING", per field.
 *
 * Deliberately WIDE. The point is to see everything the filer tagged that could
 * conceivably be the figure, including concepts we would reject on inspection —
 * a narrow filter would hide the very concept the gap is about, and the
 * classification below is a human judgement made on a printed list, not a
 * regex's opinion.
 */
const PATTERNS = {
  capex: [/PaymentsToAcquire/i, /CapitalExpenditure/i, /PurchaseOfProperty/i, /AdditionsTo/i],
  freeCashFlow: [/FreeCashFlow/i],
  shareBasedCompensation: [/ShareBased/i, /StockBased/i, /SharebasedPayment/i],
  cash: [/^Cash/i, /CashAndCashEquivalents/i, /CashCashEquivalents/i],
  shortTermInvestments: [/Investments?Current/i, /MarketableSecurities/i, /ShortTermInvestments/i, /AvailableForSale/i, /DebtSecurities/i],
  totalDebt: [/Debt/i, /Borrowings/i, /NotesPayable/i, /LongTermLoans/i, /FinanceLease/i],
  shortTermDebt: [/DebtCurrent/i, /ShortTerm.*Debt/i, /CurrentPortion/i, /Borrowings.*Current/i],
  longTermDebt: [/LongTermDebt/i, /Borrowings.*Noncurrent/i, /DebtNoncurrent/i],
  operatingCashFlow: [/NetCashProvided/i, /CashFlowsFromUsedInOperating/i],
};

const TARGETS = (process.env.SYMBOLS || "GEV:capex,shareBasedCompensation,cash,shortTermInvestments KTOS:capex,cash,shortTermInvestments,totalDebt VRT:shortTermInvestments")
  .split(/\s+/).filter(Boolean)
  .map((spec) => {
    const [symbol, fields] = spec.split(":");
    return { symbol: symbol.toUpperCase(), fields: (fields ?? "").split(",").filter(Boolean) };
  });

const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

for (const { symbol, fields } of TARGETS) {
  const cik = tickerMap.get(symbol)?.cik;
  console.log(`\n${"=".repeat(74)}\n${symbol}${cik ? ` (CIK ${cik})` : " — NO CIK"}`);
  if (!cik) continue;
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
  });
  if (!res.ok) { console.log(`  HTTP ${res.status}`); continue; }
  const facts = await res.json();

  // The period the page is actually showing, taken from the SHIPPED extractor
  // rather than picked here — a diagnosis of a different period than the one
  // rendering "—" answers a question nobody asked.
  const extracted = extractCompanyFacts(symbol, facts);
  const latestQ = extracted.quarters[0] ?? null;
  const latestI = extracted.instants[0] ?? null;
  console.log(`  latest quarter ${latestQ?.end ?? "none"} | latest instant ${latestI?.end ?? "none"}`);
  console.log(`  quarters=${extracted.quarters.length} years=${extracted.years.length} instants=${extracted.instants.length}`);

  for (const field of fields) {
    const chain = chainOf(field);
    const pats = PATTERNS[field] ?? [new RegExp(field, "i")];
    const isInstant = ["cash", "shortTermInvestments", "totalDebt", "shortTermDebt", "longTermDebt"].includes(field);
    const wantEnd = isInstant ? latestI?.end : latestQ?.end;
    console.log(`\n  --- ${field} (${isInstant ? "instant" : "duration"}, period ending ${wantEnd ?? "?"})`);
    console.log(`      our chain: ${chain.join(" -> ") || "(none)"}`);

    const hits = [];
    for (const [tax, byConcept] of Object.entries(facts.facts ?? {})) {
      for (const [concept, def] of Object.entries(byConcept)) {
        if (!pats.some((p) => p.test(concept))) continue;
        for (const [unit, rows] of Object.entries(def.units ?? {})) {
          for (const r of rows) {
            if (wantEnd && r.end !== wantEnd) continue;
            // For durations, only frames that look like one quarter.
            if (!isInstant && r.start) {
              const days = (Date.parse(r.end) - Date.parse(r.start)) / 86400000;
              if (days < 80 || days > 105) continue;
            }
            hits.push({ tax, concept, unit, val: r.val, form: r.form, fy: r.fy, fp: r.fp });
          }
        }
      }
    }
    // Newest filing wins the display slot for a concept; dedupe on concept.
    const seen = new Map();
    for (const h of hits) if (!seen.has(`${h.tax}:${h.concept}`)) seen.set(`${h.tax}:${h.concept}`, h);

    if (!seen.size) {
      console.log(`      NOT TAGGED — nothing matching ${pats.map(String).join(" ")} filed for that period`);
      continue;
    }
    let anyGap = false;
    for (const h of seen.values()) {
      const inChain = chain.includes(h.concept);
      if (!inChain) anyGap = true;
      console.log(`      ${inChain ? "in-chain " : "NOT IN CHAIN"} ${h.tax}:${h.concept} = ${h.val} ${h.unit} (${h.form ?? "?"} ${h.fy ?? ""}${h.fp ?? ""})`);
    }
    console.log(`      => ${anyGap ? "CHAIN GAP (see NOT IN CHAIN above)" : "chain covers it; null has another cause"}`);
  }
  await new Promise((r) => setTimeout(r, 200));
}
