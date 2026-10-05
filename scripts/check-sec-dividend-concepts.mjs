// THE PER-SHARE DIVIDEND UNDER EITHER FILED CONCEPT (#552 COWORK #162 §1, A1).
//
// dividendsDeclaredPerShare reads CommonStockDividendsPerShareDeclared, then
// CommonStockDividendsPerShareCashPaid, ONE CONCEPT PER FILER. What must hold,
// each run on the SHIPPED extraction (extractCompanyFacts) and each with a mutant:
//   1. KO's shape: only …CashPaid filed (2.04 for FY2025, its companyfacts value
//      as read by the CODE-A #169 relay) → the column reads it;
//   2. PEP's shape: only …Declared filed (5.6225 for FY to 27 Dec 2025) → read;
//   3. BOTH filed on the newest year → Declared wins, and the whole column
//      follows it: an older year with only …CashPaid is NOT read (a paid figure
//      never sits in a declared column);
//   4. the copy: the profile row reads "Dividends per share (as filed)";
//   5. the 71 payers whose cell this fills are first in the rewindow queue.
// The fixture SHAPES are synthetic (one concept or both); the values are the
// filers' own, and nothing here asserts a value it computed.
//
//   node scripts/check-sec-dividend-concepts.mjs
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

const FIELDS_RAW = fs.readFileSync("lib/server/secFields.ts", "utf8");
const EXTRACT_RAW = fs.readFileSync("lib/server/secExtract.ts", "utf8");

/** The shipped extraction, or one whose secFields is mutated (sibling temp files, so relative imports resolve). */
async function loadExtract(mutateFields = null) {
  if (!mutateFields) return import("../lib/server/secExtract.ts");
  const tag = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const f = `lib/server/.check-div-fields-${tag}.ts`, e = `lib/server/.check-div-extract-${tag}.ts`;
  fs.writeFileSync(f, mutateFields(FIELDS_RAW));
  fs.writeFileSync(e, EXTRACT_RAW.replaceAll('from "./secFields"', `from "./.check-div-fields-${tag}"`));
  try { return await import(`../${e}`); } finally { fs.rmSync(f, { force: true }); fs.rmSync(e, { force: true }); }
}

const DECL = "CommonStockDividendsPerShareDeclared";
const PAID = "CommonStockDividendsPerShareCashPaid";
const fy = (start, end, val, accn, filed) => ({ start, end, val, accn, filed, form: "10-K", fy: Number(end.slice(0, 4)), fp: "FY" });
const doc = (concepts) => ({ cik: 1, facts: { "us-gaap": Object.fromEntries(Object.entries(concepts).map(([c, rows]) => [c, { units: { "USD/shares": rows } }])) } });

const KO = doc({ [PAID]: [fy("2025-01-01", "2025-12-31", 2.04, "ko-25", "2026-02-20")] });
const PEP = doc({ [DECL]: [fy("2024-12-29", "2025-12-27", 5.6225, "pep-25", "2026-02-03")] });
// BOTH on the newest year (paid filed LATER, so "newest filing" would take it);
// the older year has only the paid figure.
const BOTH = doc({
  [DECL]: [fy("2025-01-01", "2025-12-31", 1.0, "b-25d", "2026-02-10")],
  [PAID]: [fy("2025-01-01", "2025-12-31", 0.98, "b-25p", "2026-03-01"), fy("2024-01-01", "2024-12-31", 0.9, "b-24p", "2025-02-10")],
});

const RULES = {
  "KO's shape (only …CashPaid): the column reads it": (X) => {
    const r = X.extractCompanyFacts("KO", KO);
    const i = X.SEC_FIELD_INDEX.dividendsDeclaredPerShare;
    return r.years.find((y) => y.end === "2025-12-31")?.values[i]?.val === 2.04;
  },
  "PEP's shape (only …Declared): the column reads it": (X) => {
    const r = X.extractCompanyFacts("PEP", PEP);
    const i = X.SEC_FIELD_INDEX.dividendsDeclaredPerShare;
    return r.years.find((y) => y.end === "2025-12-27")?.values[i]?.val === 5.6225;
  },
  "both on the newest year: Declared wins (rank beats the later filing)": (X) => {
    const r = X.extractCompanyFacts("BOTH", BOTH);
    const i = X.SEC_FIELD_INDEX.dividendsDeclaredPerShare;
    return r.years.find((y) => y.end === "2025-12-31")?.values[i]?.val === 1.0 && r.conceptChoice?.dividendsDeclaredPerShare === `us-gaap|${DECL}`;
  },
  "...and the column follows it: the older paid-only year is not read": (X) => {
    const r = X.extractCompanyFacts("BOTH", BOTH);
    const i = X.SEC_FIELD_INDEX.dividendsDeclaredPerShare;
    return (r.years.find((y) => y.end === "2024-12-31")?.values[i]?.val ?? null) === null;
  },
};

// The field ORDER is the same under every mutant (they touch a chain, not the list).
const { SEC_FIELD_INDEX } = await import("../lib/server/secFields.ts");
const withIndex = async (mutate) => ({ ...(await loadExtract(mutate)), SEC_FIELD_INDEX });

console.log("1–3. the extraction");
const X0 = await withIndex(null);
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(rule(X0)); } catch (e) { console.log(`    ${e.message}`); }
  check(name, ok);
}

console.log("\n4–5. the copy and the re-read order");
const PROFILE = fs.readFileSync("app/components/CompanyProfile.tsx", "utf8");
const copyRule = (src) => /\{ label: "Dividends per share \(as filed\)", value: dividendValue \}/.test(src) && !/label: "Dividend", value/.test(src);
check('the profile row reads "Dividends per share (as filed)"', copyRule(PROFILE));
const PAYERS71 = "AVGO UNH HD ORCL KO ACN IBM HON SO PH TEL UHS WAB VLO UPS SHW WY TER ADM MET IP GWW ESS ALLE PEG CMI FANG OKE HUM LH NEM BDX BALL AEE PNR LNT NEE DOV EXPD FAST CAH ATO OTIS BNY ZTS WCN UI ZION TRU SCCO WRB UMBF ULS VST LPLA KVUE FERG BF-B O ALSN OWL ENB CF AA IX GLPI EXR TPL PAG MGA LFUS".split(" ");
const prioRule = (json) => { const s = new Set(JSON.parse(json).symbols); return PAYERS71.length === 71 && PAYERS71.every((p) => s.has(p)); };
const PRIO = fs.readFileSync("data/sec/rewindow-priority.json", "utf8");
check("all 71 CashPaid-only payers are in the rewindow priority list", prioRule(PRIO));

console.log("\nmutants: each must break a rule");
const FIELD_MUTANTS = [
  ["…CashPaid dropped from the chain (KO reads nothing again)", once(`chain: ["${DECL}", "${PAID}"]`, `chain: ["${DECL}"]`)],
  ["the chain order swapped (paid wins where both are filed)", once(`chain: ["${DECL}", "${PAID}"]`, `chain: ["${PAID}", "${DECL}"]`)],
  ["one concept per filer removed (a paid year inside a declared column)", once(`"${PAID}"], unit: "USD/shares", oneConceptPerFiler: true }`, `"${PAID}"], unit: "USD/shares" }`)],
];
for (const [label, mutate] of FIELD_MUTANTS) {
  let caught = false;
  try {
    const Xi = await withIndex(mutate);
    caught = !Object.values(RULES).every((r) => { try { return r(Xi); } catch { return false; } });
  } catch (e) { console.log(`    ${e.message}`); }
  check(`MUTATION: ${label} → caught`, caught);
}
check('MUTATION: the row label back to "Dividend" → caught', !copyRule(PROFILE.replace('label: "Dividends per share (as filed)"', 'label: "Dividend"')));
check("MUTATION: KO dropped from the priority list → caught",
  !prioRule(JSON.stringify({ symbols: JSON.parse(PRIO).symbols.filter((s) => s !== "KO") })));

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
