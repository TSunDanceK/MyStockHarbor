// NON-OPERATING TAG COVERAGE ACROSS THE UNIVERSE (#552 COWORK #47). Reads only.
//
// One SEC frames request per tag (every filer's value for one calendar
// quarter, CY2026Q2 by default), intersected with data/sec/registrants.json's
// CIKs. For every registrant that files BOTH ends — operating income and
// pre-tax income — counts how many had the "Other income / expense" and
// "Interest expense" rows filled by the OLD chains, by the NEW chains
// (lib/server/secFields.ts), and how many are left to the derived
// "Other income (net)" = pre-tax − operating income. Counts only; no values.
//   relay task: nonop-tag-coverage   (read-only, uncredentialled)
import fs from "node:fs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; tag coverage)";
const FRAME = process.env.FRAME || "CY2026Q2";
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const universe = new Set(Object.values(REG).map((r) => Number(r.cik)).filter(Boolean));

const OLD = {
  nonOp: ["NonoperatingIncomeExpense"],
  interest: ["InterestExpense", "InterestExpenseDebt", "InterestIncomeExpenseNet"],
};
const NEW = {
  nonOp: ["NonoperatingIncomeExpense", "OtherNonoperatingIncomeExpense"],
  interest: ["InterestExpense", "InterestExpenseDebt", "InterestExpenseNonoperating", "InterestIncomeExpenseNet"],
};
// Candidates Cowork listed that are NOT mapped (interest income, net interest):
// counted so the choice not to map them is measured, not assumed.
const WATCH = ["InterestIncomeExpenseNonoperatingNet", "InvestmentIncomeInterest", "InterestIncomeOther"];
const ENDS = {
  op: ["OperatingIncomeLoss"],
  pre: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
};

let lastAt = 0;
async function frame(tag) {
  const wait = Math.max(0, lastAt + 150 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(`https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/USD/${FRAME}.json`, { headers: { "User-Agent": UA } });
  if (res.status === 404) return new Set();
  if (!res.ok) throw new Error(`${tag}: HTTP ${res.status}`);
  const j = await res.json();
  return new Set((j.data ?? []).map((d) => Number(d.cik)).filter((c) => universe.has(c)));
}
const tags = [...new Set([...OLD.nonOp, ...OLD.interest, ...NEW.nonOp, ...NEW.interest, ...WATCH, ...ENDS.op, ...ENDS.pre])];
const has = {};
for (const t of tags) { has[t] = await frame(t); console.log(`${t.padEnd(96)} ${has[t].size}`); }
const any = (list) => { const s = new Set(); for (const t of list) for (const c of has[t]) s.add(c); return s; };
const op = any(ENDS.op), pre = any(ENDS.pre);
const both = [...op].filter((c) => pre.has(c));
const count = (list) => both.filter((c) => any(list).has(c)).length;
const oldNon = count(OLD.nonOp), newNon = count(NEW.nonOp), oldInt = count(OLD.interest), newInt = count(NEW.interest);
console.log(`\nframe ${FRAME}: universe ${universe.size} CIKs; ${both.length} file both operating and pre-tax income`);
console.log(`Other income / expense row: old chain ${oldNon}, new chain ${newNon} (+${newNon - oldNon}); left to the derived line: ${both.length - newNon} (was "Not captured": ${both.length - oldNon})`);
console.log(`Interest expense row: old chain ${oldInt}, new chain ${newInt} (+${newInt - oldInt})`);
const neither = both.filter((c) => !any(NEW.nonOp).has(c) && !any(NEW.interest).has(c)).length;
console.log(`Neither row tagged (interest row reads "Included in other income (net) below"): ${neither}`);
for (const t of WATCH) console.log(`unmapped ${t}: ${both.filter((c) => has[t].has(c)).length} of the ${both.length}`);
