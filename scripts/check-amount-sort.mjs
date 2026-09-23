// Amounts sort on the RAW number, and "Not reported" sorts last both ways.
//
// WHY THIS EXISTS. The earnings page writes every large amount through one
// rule (scaledAmount: B from $1B, otherwise M at one decimal), so the text a
// reader sees mixes units: "$1.98B" above "$480.5M". Sorted as strings that
// order is wrong — "$4…" beats "$1…", and "-$0.4M" lands wherever "-" falls —
// and nothing throws. The owner asked for the guarantee before any column on
// the page becomes sortable, not after.
//
// TODAY NOTHING ON /stock/[symbol]/earnings SORTS: no table has a sortable
// header, and the only .sort() calls there order dates for the data path. So
// this pins the shared comparator (compareAmounts in secPresentation) that a
// sortable amount column must use, and fails if any .sort() in the earnings
// directory is handed formatted money.
//
// The functions are RUN from the shipped source (loadCards), not
// pattern-matched, and the rows are rendered through the real CellValue so
// the order is checked against what a reader reads.
//
//   node scripts/check-amount-sort.mjs
import fs from "node:fs";
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const M = await loadCards();

// The owner's mixed rows: B, M, a small negative, a filed zero, and no figure.
const ROWS = [
  { id: "neg", val: -397_000 },
  { id: "none", val: null },
  { id: "big", val: 1_980_000_000 },
  { id: "zero", val: 0 },
  { id: "mid", val: 480_500_000 },
];
const shown = (r) =>
  visibleText(html(React.createElement(M.CellValue, { cell: { val: r.val }, compact: true })));

console.log("1. what each row reads as");
const EXPECT_TEXT = { big: "$1.98B", mid: "$480.5M", zero: "$0.0M", neg: "-$0.4M", none: "Not reported" };
for (const r of ROWS) check(`${r.id} reads "${EXPECT_TEXT[r.id]}"`, shown(r) === EXPECT_TEXT[r.id], shown(r));
check('no "$0.01B"-style small B anywhere in the rule',
  M.scaledAmount(10_000_000) === "$10.0M" && M.scaledAmount(999_949_999) === "$999.9M",
  `${M.scaledAmount(10_000_000)}, ${M.scaledAmount(999_949_999)}`);
check("a share count takes the scale without the $",
  M.scaledAmount(49_822_595, false) === "49.8M", M.scaledAmount(49_822_595, false));

console.log("\n2. compareAmounts orders the raw number");
const order = (dir) => [...ROWS].sort((a, b) => M.compareAmounts(a.val, b.val, dir)).map((r) => r.id).join(",");
check("descending: 1.98B, 480.5M, 0, -0.4M, Not reported", order("desc") === "big,mid,zero,neg,none", order("desc"));
check("ascending: -0.4M, 0, 480.5M, 1.98B, Not reported", order("asc") === "neg,zero,mid,big,none", order("asc"));

// THE CONTROL: the same rows sorted on their text come out wrong, so the check
// above is measuring something a string sort would get wrong.
const byText = [...ROWS].sort((a, b) => shown(b).localeCompare(shown(a))).map((r) => r.id).join(",");
check("control: sorting the formatted text gets it wrong", byText !== "big,mid,zero,neg,none", byText);

console.log("\n3. nothing in the earnings directory sorts formatted money");
const DIR = "app/stock/[symbol]/earnings";
for (const f of fs.readdirSync(DIR).filter((n) => /\.tsx?$/.test(n))) {
  const src = fs.readFileSync(`${DIR}/${f}`, "utf8");
  const sorts = [...src.matchAll(/\.sort\(([^)]*\)?[^\n]*)/g)].map((m) => m[1]);
  const bad = sorts.filter((s) => /money|scaledAmount|shortMoney|CellValue|toLocaleString/.test(s));
  check(`${f}: ${sorts.length} sort call(s), none on formatted money`, bad.length === 0, bad.join(" | "));
}

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}`);
process.exit(failures ? 1 : 0);
