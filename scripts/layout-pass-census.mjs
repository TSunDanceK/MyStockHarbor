// HOW MANY PAGES THE LAYOUT PASS'S RULES TOUCH (#552 COWORK #40 / #49). Reads only.
// Every registrant's stored set, run through the SHIPPED functions on this branch:
//   - largeNonOperating on the latest period (the Other income / Net income marker)
//   - valuationInputs → trailing EPS in (0, PE_MIN_EPS): P/E "Not meaningful"
//   - balanceSheetInstant vs instants[0]: pages whose balance-sheet date moves
// SEC values only; no price is read, so the P/E count is by EPS alone.
//   relay task: write-layout-pass-census   Redis cost: 1 MGET per 50 symbols (~51).
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const VIEW = await import("../lib/server/secEarningsView.ts");
const VAL = await import("../lib/server/secValuation.ts");
const C = await import("../lib/server/secFactCodec.ts");
const FACTS = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_FACTS_PREFIX = "([^"]+)"/) ?? [])[1];
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const syms = Object.keys(REG);
const TODAY = new Date().toISOString().slice(0, 10);
let commands = 0, stored = 0;
const nonOp = [], nearZero = [], bsMoved = [];
let pbBefore = 0, pbAfter = 0, avav = "no set";
const inclNci = [], nciBlocked = [], liabDerived = [], liabHeld = [];
const ROW_KEYS = ["revenue", "operatingIncome", "nonOperatingIncomeExpense", "preTaxIncome", "netIncome"];
for (let i = 0; i < syms.length; i += 50) {
  const chunk = syms.slice(i, i + 50);
  const got = await redis.mget(...chunk.map((s) => `${FACTS}:${s}`));
  commands++;
  chunk.forEach((sym, j) => {
    const set = got[j];
    if (!set || !Array.isArray(set.quarters)) return;
    stored++;
    const latest = set.quarters[0] ?? set.years[0] ?? null;
    if (latest) {
      const rows = ROW_KEYS.map((k) => ({ key: k, label: k, val: C.valueOf(latest, k), derived: null, derivedNote: null }));
      const big = VIEW.largeNonOperating(rows);
      if (big) nonOp.push(`${sym}(${latest.e})`);
    }
    try {
      const inp = VAL.valuationInputs(set, TODAY, { annualForm: REG[sym]?.annualForm ?? null });
      if (inp.eps && inp.eps.val > 0 && inp.eps.val < VAL.PE_MIN_EPS) nearZero.push(`${sym}(${inp.eps.val.toFixed(3)})`);
    } catch { /* a set the valuation cannot read is not counted */ }
    const bs = C.balanceSheetInstant(set), first = set.instants?.[0] ?? null;
    // COWORK #54: P/B equity before (parent only) and after (bookEquityAt), and derived liabilities.
    if (bs) {
      const parent = C.valueOf(bs, "stockholdersEquity"), total = C.valueOf(bs, "totalEquity");
      const after = VAL.bookEquityAt(set, bs);
      if (parent === null) pbBefore++;
      if (after.equity === null) pbAfter++;
      if (parent === null && after.equityIncludesNci) inclNci.push(sym);
      if (after.equityOnlyInclNci) nciBlocked.push(sym);
      const nci = [...set.quarters, ...set.years].some((p) => p.e === bs.e && (C.valueOf(p, "netIncomeToNoncontrollingInterest") ?? 0) !== 0);
      const lc = VIEW.withDerivedLiabilities({ key: "totalLiabilities", label: "", val: C.valueOf(bs, "totalLiabilities"), derived: null, derivedNote: null }, bs, nci);
      if (lc.derived === "computed") liabDerived.push(sym);
      else if (C.valueOf(bs, "totalLiabilities") === null && C.valueOf(bs, "totalAssets") !== null && total !== null) liabHeld.push(sym);
    }
    if (sym === "AVAV") {
      const m = VAL.multipleInputs(set);
      avav = `ebitda ${m.ebitda ? `op ${m.ebitda.vals.operatingIncome} + D&A ${m.ebitda.vals.depreciationAndAmortization}` : `missing: ${(m.ebitdaMissing ?? []).join(", ")}`}; ` +
        `debt ST ${m.balanceSheet?.shortTermDebt ?? "none"}, LT ${m.balanceSheet?.longTermDebt ?? "none"}, cash ${m.balanceSheet?.cash ?? "none"}`;
    }
    if ((bs?.e ?? null) !== (first?.e ?? null)) bsMoved.push(`${sym}(${first?.e ?? "-"}→${bs?.e ?? "none"})`);
  });
}
console.log(`registrants ${syms.length}; stored sets ${stored}`);
console.log(`\nlarge non-operating marker on the latest period: ${nonOp.length}`);
console.log(`  ${nonOp.join(" ")}`);
console.log(`\nP/E "Not meaningful" (trailing EPS > 0 and < $${VAL.PE_MIN_EPS}): ${nearZero.length}`);
console.log(`  ${nearZero.join(" ")}`);
console.log(`\nbalance-sheet date moves (newest instant was not a period end): ${bsMoved.length}`);
console.log(`  ${bsMoved.slice(0, 80).join(" ")}${bsMoved.length > 80 ? " …" : ""}`);
console.log(`\nP/B "—" for want of equity: before ${pbBefore}, after ${pbAfter}`);
console.log(`case 1, P/B on NCI-inclusive equity (no NCI tagged): ${inclNci.length}  ${inclNci.join(" ")}`);
console.log(`...still refused, NCI tagged: ${nciBlocked.length}  ${nciBlocked.join(" ")}`);
console.log(`case 3, total liabilities derived (assets - total equity): ${liabDerived.length}`);
console.log(`  ${liabDerived.slice(0, 80).join(" ")}${liabDerived.length > 80 ? " …" : ""}`);
console.log(`...not derived (equity may be the parent-only fallback and an NCI is tagged): ${liabHeld.length}  ${liabHeld.join(" ")}`);
console.log(`AVAV EV/EBITDA inputs: ${avav}`);
console.log(`Redis commands: ${commands}`);
