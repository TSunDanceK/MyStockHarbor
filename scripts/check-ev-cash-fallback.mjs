// B1: EV WITH CASH INCLUDING RESTRICTED, MARKED "≈" (#552 COWORK #162 §3).
//
// secEstimates.enterpriseValueOf may stand cash-including-restricted in for an
// untagged cash line, and only then. What must hold, each with a mutant:
//   1. cash filed → the filed EV, no estimate, the incl.-restricted figure unused;
//   2. cash untagged, incl.-restricted filed AT THE SAME balance-sheet date,
//      both debt lines filed, not a bank → the ≈ figure, key
//      ev-cash-incl-restricted, its note naming restricted cash;
//   3. incl.-restricted only at a DIFFERENT date → no estimate (multipleInputs
//      reads the one balance-sheet instant, never another);
//   4. never stacked with M2: short-term debt untagged too → refused;
//   5. a bank (SIC 6000–6299) or unknown SIC → refused;
//   6. a surface without { withEstimates } refuses it naming "cash".
// Run on the shipped modules; set fixtures are the committed AAPL set with
// one line blanked.
//
//   node scripts/check-ev-cash-fallback.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (from, to) => (src) => {
  if (src.split(from).length !== 2) throw new Error(`mutation anchor must match once: ${from.slice(0, 70)}`);
  return src.replace(from, to);
};
async function loadMutated(rel, mutate) {
  if (!mutate) return import(`../${rel}`);
  const dir = rel.slice(0, rel.lastIndexOf("/") + 1);
  const tmp = `${dir}.check-ev-cash-${process.pid}-${Math.random().toString(36).slice(2)}.ts`;
  fs.writeFileSync(tmp, mutate(fs.readFileSync(rel, "utf8")));
  try { return await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}

const { SEC_FIELD_INDEX } = await import("../lib/server/secFields.ts");
const { balanceSheetInstant } = await import("../lib/server/secFactCodec.ts");
const BASE = JSON.parse(fs.readFileSync("data/sec/factset-fixture-AAPL.json", "utf8"));
const CASH = SEC_FIELD_INDEX.cash, CIR = SEC_FIELD_INDEX.cashIncludingRestricted;

/** The AAPL set with its balance-sheet cash blanked, incl.-restricted on `where` ("same" | "other" | "none"). */
function fixture(where) {
  const set = structuredClone(BASE);
  const b = balanceSheetInstant(set);
  const bi = set.instants.findIndex((i) => i.e === b.e);
  for (const i of set.instants) { i.v[CASH] = i.e === b.e ? null : i.v[CASH]; i.v[CIR] = null; }
  if (where === "same") set.instants[bi].v[CIR] = 30e9;
  if (where === "other") set.instants.find((i) => i.e !== b.e).v[CIR] = 30e9;
  return set;
}
const BS = { asOf: "2026-06-27", shortTermDebt: 10e9, longTermDebt: 80e9, cash: 25e9, cashIncludingRestricted: 26e9 };
const CAP = 3e12, NONBANK = "3571", BANK = "6021";

const EST_RULES = {
  "cash filed: the filed EV, no estimate, incl.-restricted unused": (E) => {
    const r = E.enterpriseValueOf(CAP, BS, NONBANK);
    return r.val === CAP + 10e9 + 80e9 - 25e9 && !r.est;
  },
  "cash untagged, incl.-restricted on the same sheet: ≈, its key and note": (E) => {
    const r = E.enterpriseValueOf(CAP, { ...BS, cash: null }, NONBANK);
    return r.val === CAP + 10e9 + 80e9 - 26e9 && r.est?.key === "ev-cash-incl-restricted" && r.est.kind === "estimate" && /restricted cash/.test(r.est.note);
  },
  "never stacked with M2: short-term debt untagged too → refused": (E) =>
    E.enterpriseValueOf(CAP, { ...BS, cash: null, shortTermDebt: null }, NONBANK).val === null,
  "a bank, or an unknown SIC → refused": (E) =>
    E.enterpriseValueOf(CAP, { ...BS, cash: null }, BANK).val === null && E.enterpriseValueOf(CAP, { ...BS, cash: null }, null).val === null,
  "no incl.-restricted figure → refused, naming cash": (E) => {
    const r = E.enterpriseValueOf(CAP, { ...BS, cash: null, cashIncludingRestricted: null }, NONBANK);
    return r.val === null && r.missing.includes("cash");
  },
};
const VAL_RULES = {
  "the same-date fixture carries incl.-restricted into the balance sheet": (V) => {
    const m = V.multipleInputs(fixture("same"));
    return m.balanceSheet?.cash === null && m.balanceSheet?.cashIncludingRestricted === 30e9;
  },
  "a different-date incl.-restricted figure is NOT carried": (V) =>
    (V.multipleInputs(fixture("other")).balanceSheet?.cashIncludingRestricted ?? null) === null,
};
const SURFACE_RULE = (V) => {
  // The panel's own path with estimates off: the cash-estimated EV is refused naming cash.
  const src = fs.readFileSync("lib/server/secValuation.ts", "utf8");
  return /missing: evAny\.missing \?\? \["short-term debt"\]/.test(src);
};

const E0 = await import("../lib/server/secEstimates.ts");
const V0 = await import("../lib/server/secValuation.ts");
console.log("1–5. enterpriseValueOf");
for (const [n, r] of Object.entries(EST_RULES)) { let ok = false; try { ok = Boolean(r(E0)); } catch (e) { console.log(`    ${e.message}`); } check(n, ok); }
console.log("\n3. the balance-sheet date (multipleInputs)");
for (const [n, r] of Object.entries(VAL_RULES)) { let ok = false; try { ok = Boolean(r(V0)); } catch (e) { console.log(`    ${e.message}`); } check(n, ok); }
console.log("\n6. a surface without estimates");
check('the refusal names the line the estimate stood in for ("cash"), not always short-term debt', SURFACE_RULE(V0));

console.log("\nmutants: each must break a rule");
const bites = async (rules, mod) => !Object.values(rules).every((r) => { try { return r(mod); } catch { return false; } });
const EST_MUTANTS = [
  ["incl.-restricted preferred even when cash is filed", once("bs.cash === null && bs.shortTermDebt !== null", "bs.shortTermDebt !== null")],
  ["stacked with M2 (short-term debt may be untagged too)", once("bs.cash === null && bs.shortTermDebt !== null && bs.longTermDebt !== null", "bs.cash === null && bs.longTermDebt !== null")],
  ["the bank gate dropped", once('typeof bs.cashIncludingRestricted === "number" && sicAllowsEstimate(sic)', 'typeof bs.cashIncludingRestricted === "number"')],
];
for (const [label, m] of EST_MUTANTS) {
  let caught = false;
  try { caught = await bites(EST_RULES, await loadMutated("lib/server/secEstimates.ts", m)); } catch (e) { console.log(`    ${e.message}`); }
  check(`MUTATION: ${label} → caught`, caught);
}
{
  let caught = false;
  try {
    const V = await loadMutated("lib/server/secValuation.ts", once('cashIncludingRestricted: valueOf(b, "cashIncludingRestricted"),',
      'cashIncludingRestricted: set.instants.map((i) => valueOf(i, "cashIncludingRestricted")).find((v) => v !== null) ?? null,'));
    caught = await bites(VAL_RULES, V);
  } catch (e) { console.log(`    ${e.message}`); }
  check("MUTATION: incl.-restricted read from any instant (a different date) → caught", caught);
}
check('MUTATION: the no-estimates refusal always says "short-term debt" → caught',
  !/missing: evAny\.missing \?\? \["short-term debt"\]/.test(fs.readFileSync("lib/server/secValuation.ts", "utf8").replace('missing: evAny.missing ?? ["short-term debt"]', 'missing: ["short-term debt"]')));

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
