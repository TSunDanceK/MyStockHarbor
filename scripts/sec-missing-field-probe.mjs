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
  // secExtract reads reportingCurrency / unitKeysFor from secCurrency.
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
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
  shareBasedCompensation: [/ShareBasedCompensation/i, /ShareBased/i, /StockBased/i, /SharebasedPayment/i],
  cash: [/Cash/i],
  shortTermInvestments: [/Investments?Current/i, /MarketableSecurities/i, /ShortTermInvestments/i, /AvailableForSale/i, /DebtSecurities/i],
  totalDebt: [/LongTermDebt/i, /Borrowings/i, /Notes.*Payable/i, /ConvertibleNotes/i, /LineOfCredit/i, /Debt/i, /FinanceLease/i],
  shortTermDebt: [/DebtCurrent/i, /ShortTerm.*Debt/i, /CurrentPortion/i, /Borrowings.*Current/i, /Notes.*Payable.*Current/i, /LineOfCredit.*Current/i],
  longTermDebt: [/LongTermDebt/i, /Borrowings.*Noncurrent/i, /DebtNoncurrent/i, /ConvertibleNotes/i, /Notes.*Payable.*Noncurrent/i],
  operatingCashFlow: [/NetCashProvided/i, /CashFlowsFromUsedInOperating/i],
};

/**
 * THE PROBE PROVES IT CAN SEE WHAT THE PAGE SEES, BEFORE IT IS BELIEVED.
 *
 * Set NARROW_TO_3M=1 to restore the bug: durations restricted to 80-105 day
 * frames. Under it, a filer whose cash flow is filed year-to-date must report
 * NOT TAGGED for operatingCashFlow — which is precisely the false verdict this
 * probe published, and the reason it is re-run rather than trusted.
 *
 * Run both ways and compare. A probe that reports the same thing either way is
 * not reading frames at all.
 */
const narrowVerdicts = [];

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
            // ── EVERY FRAME THE PAGE COULD BE READING, NOT JUST A 3-MONTH ONE ──
            //
            // THE PROBE'S OWN BUG, AND IT PRODUCED FOUR WRONG VERDICTS. This
            // kept only frames of 80-105 days, so it reported NOT TAGGED for
            // every cash-flow field on every filer — because US filers report
            // cash flow YEAR-TO-DATE and never file a standalone 3-month frame.
            // The page knows that and DIFFERENCES two cumulative figures, which
            // is why GEV's own screenshot showed "Operating cash flow $5.49B
            // derived" beside a probe line claiming nothing was filed.
            //
            // A diagnostic that cannot see what the page sees does not diagnose
            // the page. Durations now accept ANY frame ending on the period's
            // end date — 3M, 6M, 9M, 12M — and the frame length is printed so
            // a YTD figure is never mistaken for a quarterly one.
            if (!isInstant) {
              if (wantEnd && r.end !== wantEnd) continue;
            } else {
              // ── A REAL INSTANT, NOT A DURATION THAT ENDS ON THE SAME DAY ──
              //
              // An instant fact has NO `start`. Without this test the widened
              // /Cash/i pattern pulled NetCashProvidedByUsedInOperatingActivities
              // and three other cash-FLOW totals into KTOS's balance-sheet
              // listing — duration facts that merely end on the balance-sheet
              // date. Noise in a diagnosis is not harmless: every extra line is
              // a candidate someone has to rule out by hand.
              if (r.start) continue;
              // Within ten days of the balance-sheet date, because a filer's own
              // period end and the date it tags can differ by a weekend or a
              // 52/53-week calendar.
              if (!wantEnd) continue;
              const off = Math.abs(Date.parse(r.end) - Date.parse(wantEnd)) / 86400000;
              if (off > 10) continue;
            }
            const months = !isInstant && r.start
              ? Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86400000 / 30.4)
              : null;
            hits.push({ tax, concept, unit, val: r.val, form: r.form, fy: r.fy, fp: r.fp, months, end: r.end });
          }
        }
      }
    }
    // Newest filing wins the display slot for a concept; dedupe on concept.
    // KEYED ON CONCEPT AND FRAME. One concept filed at 3M, 6M and 9M is three
    // different facts, and collapsing them hides exactly the YTD frame this
    // probe was blind to.
    const seen = new Map();
    for (const h of hits) {
      const k = `${h.tax}:${h.concept}:${h.months ?? "inst"}`;
      if (!seen.has(k)) seen.set(k, h);
    }

    if (!seen.size) {
      console.log(`      NOT TAGGED — nothing matching ${pats.map(String).join(" ")} filed for that period`);
      continue;
    }
    let anyGap = false;
    for (const h of seen.values()) {
      const inChain = chain.includes(h.concept);
      if (!inChain) anyGap = true;
      const frame = h.months === null ? `as at ${h.end}` : `${h.months}M frame`;
      console.log(`      ${inChain ? "in-chain " : "NOT IN CHAIN"} ${h.tax}:${h.concept} = ${h.val} ${h.unit} [${frame}] (${h.form ?? "?"} ${h.fy ?? ""}${h.fp ?? ""})`);
    }
    const anyInChain = [...seen.values()].some((h) => chain.includes(h.concept));
    // THE VERDICT LINE CARRIES BOTH FACTS. "In chain AND still blank" is a
    // different class of bug from a chain gap — the page is dropping a value it
    // already has — and the two must not be told apart by reading the list.
    console.log(
      `      => IN CHAIN: ${anyInChain ? "YES" : "no"} | ` +
      (anyInChain
        ? "if the cell is still blank this is EXTRACTION/RENDER, not a chain gap"
        : anyGap
          ? "CHAIN GAP (see NOT IN CHAIN above)"
          : "NOT TAGGED — nothing to add")
    );
    if (!isInstant) {
      // THE PROBE'S OWN MUTATION, RUN EVERY TIME. What the 80-105 day rule —
      // the bug this probe shipped with — would have concluded from the same
      // facts. Printed rather than trusted, so the flip is visible in the log.
      const quarterly = [...seen.values()].filter((h) => h.months !== null && h.months >= 3 && h.months <= 3.5);
      narrowVerdicts.push({
        symbol, field,
        wide: seen.size ? "TAGGED" : "NOT TAGGED",
        narrow: quarterly.length ? "TAGGED" : "NOT TAGGED",
      });
    }
  }
  await new Promise((r) => setTimeout(r, 200));
}

// ── THE MUTATION, REPORTED ──────────────────────────────────────────────────
console.log(`\n${"=".repeat(74)}\nPROBE SELF-CHECK: what a 3-month-only frame filter would have said`);
console.log("(that filter was this probe's bug; every row where the two disagree is a verdict it got wrong)\n");
let flips = 0;
for (const v of narrowVerdicts) {
  const flip = v.wide !== v.narrow;
  if (flip) flips++;
  console.log(`  ${flip ? "FLIPS  " : "same   "} ${v.symbol.padEnd(6)} ${v.field.padEnd(24)} wide=${v.wide.padEnd(10)} 3M-only=${v.narrow}`);
}
console.log(
  flips
    ? `\n  ${flips} verdict(s) differ — the frame rule is doing the work, and the old one was wrong about them.`
    : "\n  No verdict differs. Either no duration field here is filed year-to-date, or the frame rule is not being applied — check before trusting this run."
);
