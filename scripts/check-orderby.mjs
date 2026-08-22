// Proves config.orderBy actually reorders, and proves WHERE it runs is why.
//
// The first attempt at this feature (64547c5d) added `orderBy` to three page
// configs and nothing else -- no type, no consumer. It did not typecheck and
// would have done nothing if it had. The subtler failure is the one this script
// exists for: putting the sort in the obvious place, inside buildEntries
// alongside the existing score sorts, ALSO does nothing, because the
// fundamentals it sorts on (peRatio, divYield, divGrowth) are attached to the
// entries later in getPickerData. A comparator over undefined returns 0 for
// every pair, Array#sort is stable, and the array comes back untouched with a
// green build and no log line.
//
//   node scripts/check-orderby.mjs
//
// It does NOT test a copy of the sort. It reads app/components/PickerResultPage.tsx,
// extracts the real `applyOrderBy` and `valueForPredicateField` declarations by
// AST, transpiles them, and runs those. If the source drifts, this drifts with
// it -- the point of claude/traps/two-validators-for-one-value.md.
//
// What it cannot do: reach real picker data. The payload is Redis-backed and
// the sandbox has no credentials, so the fixtures below are hand-built to the
// shape getPickerData produces. This proves the ORDERING LOGIC and its
// placement. Confirming the deployed page ships rows in that order is
// owner-side, like every other rendered-output check in this repo.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "app/components/PickerResultPage.tsx");

const source = fs.readFileSync(SRC, "utf8");
const sf = ts.createSourceFile(SRC, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const WANTED = ["valueForPredicateField", "applyOrderBy"];
const found = new Map();
for (const st of sf.statements) {
  if (ts.isFunctionDeclaration(st) && st.name && WANTED.includes(st.name.text)) {
    found.set(st.name.text, st.getText(sf));
  }
}

for (const name of WANTED) {
  if (!found.has(name)) {
    console.error(`FAIL: could not find function ${name} in ${path.relative(ROOT, SRC)}`);
    console.error("The sort may have been renamed or moved. This script is now measuring nothing.");
    process.exit(1);
  }
}

// Transpile the two real declarations, then hand them the fixtures.
const js = ts.transpileModule(
  `${found.get("valueForPredicateField")}\n${found.get("applyOrderBy")}\n` +
    `export { valueForPredicateField, applyOrderBy };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
).outputText;

const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const { applyOrderBy } = mod;

// Shaped like getPickerData's entries AFTER the extended-data block has run.
// Deliberately awkward: an unsorted input, a duplicate value to force a tie, a
// negative, a zero, and two rows with no P/E at all.
const withFundamentals = () => [
  { symbol: "AAPL", peRatio: 31.2 },
  { symbol: "F", peRatio: 6.8 },
  { symbol: "VZ", peRatio: 8.9 },
  { symbol: "GM", peRatio: 5.1 },
  { symbol: "PFE", peRatio: 11.4 },
  { symbol: "INTC", peRatio: undefined },
  { symbol: "T", peRatio: 8.9 },
  { symbol: "C", peRatio: 9.6 },
  { symbol: "BAC", peRatio: 12.0 },
  { symbol: "RIVN", peRatio: -4.2 },
  { symbol: "NVDA", peRatio: 54.7 },
  { symbol: "XYZ", peRatio: 0 },
  { symbol: "ZZZZ", peRatio: undefined },
].map((e) => ({ ...e, chartPoints: [] }));

// The SAME universe as it exists at buildEntries time: the fundamentals have
// not been attached yet. This is the control.
const withoutFundamentals = () => withFundamentals().map(({ symbol, chartPoints }) => ({ symbol, chartPoints }));

const CONFIG = { href: "/low-pe-stocks", orderBy: { field: "peRatio", dir: "asc", label: "P/E Ratio" } };

const show = (entries, n = 10) =>
  entries
    .slice(0, n)
    .map((e, i) => `    ${String(i + 1).padStart(2)}. ${e.symbol.padEnd(6)} ${e.peRatio === undefined ? "—" : e.peRatio}`)
    .join("\n");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- correct
console.log("\n=== A. Sorted where it actually runs (end of getPickerData) ===");
const good = withFundamentals();
const beforeGood = good.map((e) => e.symbol).join(",");
const statsGood = applyOrderBy(good, CONFIG);
console.log(`\n  input order:  ${beforeGood}`);
console.log(`\n  first 10 by ${CONFIG.orderBy.label} (${CONFIG.orderBy.dir}):\n${show(good)}\n`);

const values = good.map((e) => e.peRatio).filter((v) => typeof v === "number" && Number.isFinite(v));
const monotone = values.every((v, i) => i === 0 || values[i - 1] <= v);
check("order changed", good.map((e) => e.symbol).join(",") !== beforeGood);
check("ascending / monotone across every valued row", monotone, `[${values.join(", ")}]`);
check("missing values sank to the bottom", good.slice(-2).every((e) => e.peRatio === undefined), good.slice(-2).map((e) => e.symbol).join(","));
check("negative P/E is a value, not a missing", good[0].symbol === "RIVN", `first row ${good[0].symbol}`);
check(
  "tie broken alphabetically (T vs VZ, both 8.9)",
  good.findIndex((e) => e.symbol === "T") < good.findIndex((e) => e.symbol === "VZ")
);
check("reported 11 of 13 rows carrying the key", statsGood.withValue === 11 && statsGood.total === 13, JSON.stringify(statsGood));

// ---------------------------------------------------------------- control
console.log("\n=== B. CONTROL: same sort at buildEntries time (fields not yet attached) ===");
const bad = withoutFundamentals();
const beforeBad = bad.map((e) => e.symbol).join(",");
const statsBad = applyOrderBy(bad, CONFIG);
const afterBad = bad.map((e) => e.symbol).join(",");
console.log(`\n  before: ${beforeBad}`);
console.log(`  after:  ${afterBad}\n`);
check("sort is INERT — nothing carries the key", statsBad.withValue === 0, JSON.stringify(statsBad));
check(
  "this is the failure mode: it does not throw, it just quietly does nothing useful",
  statsBad.withValue === 0 && statsBad.total === 13
);
// Regression guard. Before the withValue===0 early return, this case fell
// through to the alphabetical tiebreak on every comparison and reordered the
// fixture to AAPL,BAC,C,F,GM,... -- destroying the incoming score order and
// shipping a page confidently sorted by ticker. The same thing would happen in
// production any time the extended-data fetch fails, since that block swallows.
check("input order PRESERVED, not alphabetised", afterBad === beforeBad, afterBad);

// ---------------------------------------------------------------- descending
console.log("\n=== C. Descending (the divYield / divGrowth direction) ===");
const desc = [
  { symbol: "AAPL", divYield: 0.5 },
  { symbol: "MO", divYield: 8.2 },
  { symbol: "T", divYield: 6.1 },
  { symbol: "KO", divYield: 3.0 },
  { symbol: "NVDA", divYield: undefined },
  { symbol: "VZ", divYield: 6.7 },
].map((e) => ({ ...e, chartPoints: [] }));
applyOrderBy(desc, { href: "/high-dividend-yield-stocks", orderBy: { field: "divYield", dir: "desc", label: "Dividend Yield" } });
console.log(`\n${desc.map((e, i) => `    ${i + 1}. ${e.symbol.padEnd(6)} ${e.divYield === undefined ? "—" : e.divYield}`).join("\n")}\n`);
const dv = desc.map((e) => e.divYield).filter((v) => typeof v === "number");
check("descending / monotone", dv.every((v, i) => i === 0 || dv[i - 1] >= v), `[${dv.join(", ")}]`);
check("missing still sinks to the bottom in desc", desc[desc.length - 1].symbol === "NVDA");

// ---------------------------------------------------------------- no orderBy
console.log("\n=== D. Pages with no orderBy are untouched ===");
const untouched = withFundamentals();
const beforeU = untouched.map((e) => e.symbol).join(",");
const statsU = applyOrderBy(untouched, { href: "/oversold-stocks-today" });
check("returns null and leaves order alone", statsU === null && untouched.map((e) => e.symbol).join(",") === beforeU);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
