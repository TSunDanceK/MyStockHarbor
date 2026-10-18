// #552 COWORK #241 PR 2: (d) derived Q4 EPS on the earnings view, and the bank
// revenue rule in the extractor.
//   (d) a Q4 the filing left blank takes the injected derivation (the page
//       passes secValuation.derivedQ4Eps, tested in check-sec-valuation),
//       labelled "Derived: fiscal year less Q1–Q3", in the recent-periods
//       list; no derivation injected = blank as before; a non-Q4 is never
//       touched; no EPS YoY moves.
//   BANK  COLB-shaped (no total of any kind): quarters = net interest income +
//       noninterest income, marked computed, same frame only; JPM-shaped
//       (RevenuesNetOfInterestExpense) keeps the filed total; a filer with a
//       contract line is untouched; one half missing = no cell.
//   NOTE  a computed revenue reads its own sentence, not the EPS ratio's.
// plus a mutation per rule.
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";
import { loadSnapshot, once } from "./lib/render-snapshot.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── (d) ──
console.log("(d) derived Q4 EPS");
const AAPL = JSON.parse(fs.readFileSync("data/sec/factset-fixture-AAPL.json", "utf8"));
const S = await loadSnapshot();
const NOTE = "Derived: fiscal year less Q1–Q3";
const q4 = AAPL.quarters.find((p) => p.fp === "Q4");
const stub = (_set, p) => (p.fp === "Q4" ? 1.23 : 99);
const runD = (M) => {
  const plain = M.buildSecEarningsView(AAPL), withD = M.buildSecEarningsView(AAPL, { deriveQ4Eps: stub });
  const row = (v, end) => v?.recentPeriods?.find((r) => r.end === end)?.epsDiluted ?? null;
  return { plain, withD, before: row(plain, q4?.e), after: row(withD, q4?.e) };
};
{
  check("fixture has a Q4 quarter", Boolean(q4));
  const r = runD(S);
  check("no derivation injected: the Q4 EPS stays blank", r.before?.val == null, JSON.stringify(r.before));
  check("injected: the Q4 EPS is the derivation, marked computed", r.after?.val === 1.23 && r.after?.derived === "computed", JSON.stringify(r.after));
  check(`...labelled "${NOTE}"`, r.after?.derivedNote === NOTE && S.Q4_EPS_DERIVED_NOTE === NOTE);
  const nonQ4 = r.withD.recentPeriods.filter((x) => !x.label.startsWith("Q4")).every((x) => x.epsDiluted.val !== 99);
  check("a non-Q4 period is never touched", nonQ4);
  const yoys = (v) => JSON.stringify([...v.growth.map((x) => x.epsYoY), v.snapshot.epsYoY]);
  check("no EPS YoY moves (growth rows and the snapshot)", r.plain.growth.length > 0 && yoys(r.plain) === yoys(r.withD), yoys(r.withD).slice(0, 80));
  const filed = S.withDerivedQ4Eps({ val: 2.5, derived: "as-filed", derivedNote: null, key: "epsDiluted", label: "x" }, { fp: "Q4" }, () => 1);
  check("a filed Q4 EPS is never replaced", filed.val === 2.5);
  const M2 = await loadSnapshot(once("  if (cellIn.val !== null || !p || p.fp !== \"Q4\" || !derive) return cellIn;", "  return cellIn;"));
  check("mutant (helper disabled) is caught", runD(M2).after?.val == null);
  check("computed revenue has its own note", /^Computed: the sum of the revenue lines/.test(S.derivationNote("computed", { key: "revenue" }) ?? ""));
  check("...and computed EPS keeps the ratio sentence", /net income divided by/.test(S.derivationNote("computed", { key: "epsDiluted" }) ?? ""));
}

// ── BANK ──
console.log("bank revenue: net interest income + noninterest income");
const fieldsSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
const fxSrc = fs.readFileSync("lib/server/fxRates.ts", "utf8");
const currencySrc = fs.readFileSync("lib/server/secCurrency.ts", "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const extractRaw = fs.readFileSync("lib/server/secExtract.ts", "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
const load = (src) => lift(`${fieldsSrc}\n${fxSrc}\n${currencySrc}\n${src}`);
const X = await load(extractRaw);
const REV = X.SEC_FIELD_KEYS.indexOf("revenue");
const M = 1e6;
const row = (start, end, val, fp) => ({ start, end, val, accn: `0000000000-26-0000${fp === "FY" ? "09" : "01"}`, fy: 2025, fp, form: fp === "FY" ? "10-K" : "10-Q", filed: "2026-02-01" });
const payload = (tags) => ({ cik: 1, entityName: "Fixture", facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([t, rows]) => [t, { units: { USD: rows } }])) } });
const quarters = (vals) => [row("2025-01-01", "2025-03-31", vals[0] * M, "Q1"), row("2025-04-01", "2025-06-30", vals[1] * M, "Q2")];
const ni = quarters([192, 208]);
const colb = payload({ InterestIncomeExpenseNet: quarters([425, 446]), NoninterestIncome: quarters([66, 64]), NetIncomeLoss: ni });
const jpm = payload({ RevenuesNetOfInterestExpense: quarters([45310, 44912]), InterestIncomeExpenseNet: quarters([23273, 23209]), NoninterestIncome: quarters([22037, 21703]), NetIncomeLoss: ni });
const withLine = payload({ RevenueFromContractWithCustomerExcludingAssessedTax: [row("2025-01-01", "2025-03-31", 300 * M, "Q1")], InterestIncomeExpenseNet: quarters([425, 446]), NoninterestIncome: quarters([66, 64]), NetIncomeLoss: ni });
const half = payload({ InterestIncomeExpenseNet: quarters([425, 446]), NetIncomeLoss: ni });
const q2 = (Xm, f) => Xm.extractCompanyFacts("FIX", f).quarters.find((p) => p.end === "2025-06-30")?.values?.[REV] ?? null;
{
  const c = q2(X, colb);
  check("COLB-shaped: Q2 revenue = 446 + 64, computed", c?.val === 510 * M && c?.derived === "computed" && c?.tag === null, JSON.stringify(c));
  const j = q2(X, jpm);
  check("JPM-shaped: the filed RevenuesNetOfInterestExpense wins", j?.val === 44912 * M && j?.tag === "RevenuesNetOfInterestExpense", JSON.stringify(j));
  // The no-total fill still leaves a filer with a contract line alone; since
  // earnings audit r2 that 300M fee line is more than 2% off NII + noninterest
  // income (491M), so the bank net-basis rule moves the series to net revenue
  // and fills the newest quarter (scripts/check-bank-revenue.mjs pins it).
  const wl = X.extractCompanyFacts("FIX", withLine);
  check("a filer with a contract line is not filled by the no-total rule",
    !(wl.notes ?? []).some((n) => /no revenue total tagged/.test(n)), (wl.notes ?? []).filter((n) => /^revenue/.test(n)).join(" | "));
  check("...its fee line is replaced on the bank net basis (Q1 425 + 66, Q2 446 + 64)",
    wl.quarters.find((p) => p.end === "2025-03-31")?.values?.[REV]?.val === 491 * M && q2(X, withLine)?.val === 510 * M);
  check("one half missing: no cell", q2(X, half)?.val == null);
  const XM = await load(once('          m.set("revenue", {\n            val: sum,', '          if (false) m.set("revenue", {\n            val: sum,')(extractRaw));
  check("mutant (sum removed) is caught", q2(XM, colb)?.val == null);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
