// Guards the daily series against duplicate dates.
//
// WHY THIS MATTERS MORE THAN IT LOOKS. Every indicator in this codebase reads
// the series POSITIONALLY -- movingAverage(closes, 200) takes 200 array slots,
// not 200 trading days. So one duplicated date shifts every window by one and
// moves MA, RSI, MACD, Bollinger, ATR and the support/resistance detector at
// once. Nothing throws, the chart still renders, and the numbers are wrong by an
// amount nobody can see.
//
// parseFmpHistoricalRows sorted by date and never collapsed on it, so nothing
// stopped FMP returning two rows for one day. That is a live risk today,
// independent of any intraday-synthesis work.
//
// The REAL function is extracted and run, not a copy of it.
//
//   node scripts/check-history-bars.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const SRC = "lib/server/historyCache.ts";
const raw = fs.readFileSync(path.join(ROOT, SRC), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const sf = ts.createSourceFile(SRC, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const grab = (name) => {
  let out = null;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) out = node.getText(sf).replace(/^export\s+/, "");
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
};

const wanted = ["parseFmpHistoricalRows", "collapseDuplicateDates", "toFiniteNumber", "readHistoryDropCounts"];
const fns = Object.fromEntries(wanted.map((n) => [n, grab(n)]));
const missing = wanted.filter((n) => !fns[n]);
if (missing.length) {
  console.error(`FAIL: could not extract ${missing.join(", ")} from ${SRC} — measuring nothing.`);
  process.exit(1);
}

// The module-level counters the drop tracker closes over, lifted verbatim from
// the source rather than restated.
const counterDecls = raw
  .split("\n")
  .filter((l) => /^(let historyRows|const historyDropSymbols|const MAX_DROP_SYMBOLS)/.test(l))
  .join("\n");

const js = ts.transpileModule(
  `${counterDecls}\n${fns.toFiniteNumber}\n${fns.collapseDuplicateDates}\n${fns.parseFmpHistoricalRows}\n${fns.readHistoryDropCounts}\n` +
    `export { parseFmpHistoricalRows, collapseDuplicateDates, toFiniteNumber, readHistoryDropCounts };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const bar = (date, close, extra = {}) => ({ date, open: close - 1, high: close + 1, low: close - 2, close, volume: 1000, ...extra });

console.log("\n=== 1. Duplicates collapse, and the survivor is the intended one ===\n");
// FMP returns newest-first; the parser sorts ascending. Two rows for 08-20, the
// second of which is the one that must survive.
const withDupe = [
  bar("2026-08-21", 110),
  bar("2026-08-20", 100, { volume: 111 }),
  bar("2026-08-20", 105, { volume: 222 }),
  bar("2026-08-19", 90),
];
const parsed = m.parseFmpHistoricalRows(withDupe);
check("length drops by exactly the number of duplicates", parsed.length === 3, `${parsed.length} of 4 rows kept`);
check("one Point per date", new Set(parsed.map((p) => p.date)).size === parsed.length);
// LAST AFTER THE SORT WINS. Array.prototype.sort is stable, so among equal
// dates the input order is preserved and the survivor is the later of the two
// in FMP's own response.
const survivor = parsed.find((p) => p.date === "2026-08-20");
check("the survivor is the LAST occurrence, not the first", survivor.close === 105, `close=${survivor.close} (first was 100)`);
check("...and it is the whole row, not a merge of both", survivor.volume === 222, `volume=${survivor.volume}`);
check("ordering is still ascending by date", parsed.map((p) => p.date).join(",") === "2026-08-19,2026-08-20,2026-08-21");

console.log("\n=== 2. It leaves clean series alone ===\n");
const clean = [bar("2026-08-21", 110), bar("2026-08-20", 100), bar("2026-08-19", 90)];
const cleanParsed = m.parseFmpHistoricalRows(clean);
check("no duplicates -> nothing dropped", cleanParsed.length === 3);
check("closes untouched", cleanParsed.map((p) => p.close).join(",") === "90,100,110");
check("empty input -> empty output", m.parseFmpHistoricalRows([]).length === 0);
check("undefined input -> empty output", m.parseFmpHistoricalRows(undefined).length === 0);

console.log("\n=== 3. Harder shapes ===\n");
// Three rows for one date, and duplicates on two different dates.
check(
  "three rows on one date collapse to one",
  m.parseFmpHistoricalRows([bar("2026-08-20", 1), bar("2026-08-20", 2), bar("2026-08-20", 3)]).length === 1
);
check(
  "...keeping the last",
  m.parseFmpHistoricalRows([bar("2026-08-20", 1), bar("2026-08-20", 2), bar("2026-08-20", 3)])[0].close === 3
);
const twoDupes = m.parseFmpHistoricalRows([
  bar("2026-08-21", 10), bar("2026-08-21", 11),
  bar("2026-08-20", 20), bar("2026-08-20", 21),
]);
check("duplicates on two different dates both collapse", twoDupes.length === 2, `${twoDupes.length}`);
check("...each keeping its own last", twoDupes.map((p) => p.close).join(",") === "21,11");
// Rows the parser already rejects must not be resurrected by the collapse.
// FOUND BY THIS CHECK, and fixed in the same commit. toFiniteNumber ran
// Number() first, and Number(null) is 0 -- not NaN -- so a row carrying
// `"close": null` became a Point priced at zero rather than being dropped.
// Latent on its own; fatal next to "last occurrence wins", because the fake
// zero bar would REPLACE the real one for that date.
const withNullClose = [bar("2026-08-20", 100), { date: "2026-08-20", close: null }];
check(
  "a row with close null is DROPPED, not coerced to a zero-priced bar",
  m.parseFmpHistoricalRows(withNullClose).length === 1,
  "Number(null) is 0, so the isFinite guard alone let it through"
);
check(
  "...so it cannot win its date under last-wins",
  m.parseFmpHistoricalRows(withNullClose)[0].close === 100
);
check(
  'empty string is rejected too, for the same reason',
  m.parseFmpHistoricalRows([bar("2026-08-20", 100), { date: "2026-08-20", close: "" }]).length === 1
);
check(
  "an absent optional field stays undefined rather than becoming 0",
  m.parseFmpHistoricalRows([{ date: "2026-08-20", close: 100, high: null }])[0].high === undefined,
  "a high of 0 would make ATR and the S/R detector read a real level"
);

console.log("\n=== 4. toFiniteNumber is an allowlist, not a denylist ===\n");
// EVERY shape Number() turns into a finite number from something that is not a
// price. Rejecting null/undefined/"" closed two of eight; the typeof allowlist
// closes all of them, including the two that are not "empty" at all.
const COERCION_TRAPS = [
  ["null", null],
  ['""', ""],
  ['" "', " "],
  ['"\\n"', "\n"],
  ["[]", []],
  ["false", false],
  ["true", true],
  ["[7]", [7]],
  ["{}", {}],
  ["NaN", NaN],
  ["Infinity", Infinity],
];
for (const [label, value] of COERCION_TRAPS) {
  check(`${label} -> null, not a number`, m.toFiniteNumber(value) === null, `got ${JSON.stringify(m.toFiniteNumber(value))}`);
}
// The two that must still work, or the allowlist has gone too far.
check("a real number passes", m.toFiniteNumber(123.45) === 123.45);
check("a numeric string passes", m.toFiniteNumber("123.45") === 123.45);
check("zero itself still passes — it is a legal price for volume", m.toFiniteNumber(0) === 0);

// End to end: a row whose close is one of these must be DROPPED, not priced.
for (const [label, value] of [['" "', " "], ["[]", []], ["false", false], ["[7]", [7]], ["true", true]]) {
  const parsed = m.parseFmpHistoricalRows([bar("2026-08-20", 100), { date: "2026-08-19", close: value }]);
  check(
    `a close of ${label} produces no bar at all`,
    parsed.length === 1 && parsed[0].close === 100,
    `${parsed.length} bars, closes ${parsed.map((p) => p.close).join(",")}`
  );
}
// Asserted on the FUNCTION'S FIRST STATEMENT, not on whether Number() appears
// anywhere. Number(value) legitimately survives inside the string branch, so a
// bare "no Number() first" regex over the whole file fails on correct code --
// which is exactly what it did on first run. The shape that matters is that a
// typeof gate comes before any coercion.
const firstStatement = (fns.toFiniteNumber.match(/\{\s*(?:\/\/[^\n]*\n\s*)*([^\n]+)/) ?? [])[1] ?? "";
check(
  "toFiniteNumber gates on typeof BEFORE coercing, like its five siblings",
  /^if \(typeof value === "number"\)/.test(firstStatement.trim()),
  `first statement: ${firstStatement.trim().slice(0, 60)}`
);
check(
  "...and the string branch is gated on a non-blank string",
  /if \(typeof value === "string" && value\.trim\(\) !== ""\)/.test(fns.toFiniteNumber)
);
check(
  "...with a catch-all null, so unlisted types cannot fall through",
  /\n\s*return null;\n\}$/.test(fns.toFiniteNumber.trim()),
  "the closed form is the whole point — it is right about shapes nobody listed"
);

console.log("\n=== 5. The drop counter, so 'latent' stops being an assumption ===\n");
m.readHistoryDropCounts(); // reset
m.parseFmpHistoricalRows([bar("2026-08-20", 100), { date: "2026-08-19", close: null }], "MU");
m.parseFmpHistoricalRows([{ date: "2026-08-18", close: "" }], "NVDA");
const counted = m.readHistoryDropCounts();
check("dropped rows are counted", counted.rowsDroppedNoClose === 2, `${counted.rowsDroppedNoClose}`);
check("rows parsed is counted too", counted.rowsParsed === 3, `${counted.rowsParsed}`);
check(
  "...which is what makes a zero reading mean anything",
  counted.rowsParsed > 0,
  "0 drops out of 0 rows says nothing; 0 out of ~900k says the bug was latent"
);
check("the affected symbols are named", counted.symbols.join(",") === "MU,NVDA", counted.symbols.join(","));
check("reading resets, so each run reports its own figures", m.readHistoryDropCounts().rowsDroppedNoClose === 0);
// A row with no DATE is malformed rather than an instance of this bug, and
// counting it here would inflate the signal the flush decision rests on.
m.readHistoryDropCounts();
m.parseFmpHistoricalRows([{ close: 100 }], "AMD");
check(
  "a row missing its DATE is not counted as a null-close drop",
  m.readHistoryDropCounts().rowsDroppedNoClose === 0,
  "different defect; counting it would inflate the signal the flush decision rests on"
);
check(
  "the counter is reported on the warm-picker-universe run record",
  /historyRowsDroppedNoClose: drops\.rowsDroppedNoClose/.test(
    fs.readFileSync(path.join(ROOT, "app/api/jobs/warm-picker-universe/route.ts"), "utf8")
  ),
  "a counter nothing reads is a counter that never ran"
);

console.log("\n=== 6. The collapse is wired into the parser, not just present ===\n");
// Comments stripped with the real tokeniser, and guarded -- see scripts/lib/source-code.mjs.
const code = stripComments(raw, { file: SRC, dropLines: true });
check(
  "parseFmpHistoricalRows returns through collapseDuplicateDates",
  /return collapseDuplicateDates\(daily\);/.test(code),
  "a guard the parser does not call is a guard that never runs"
);
check("the raw sorted array is not returned directly", !/daily\.sort\([^)]*\);\s*return daily;/.test(code));

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
