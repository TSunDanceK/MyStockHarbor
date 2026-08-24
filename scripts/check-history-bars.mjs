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

console.log("\n=== 7. Stale-bar diagnostics: a symbol name alone cannot say WHY ===\n");
// The first live forced warm returned 12 stale symbols and 20 forced-refetch
// failures, and neither list could answer the question it raised. A stale symbol
// is either a DELISTED ticker whose series correctly stops at its last trading
// day, or a LIVE symbol that genuinely missed its refreshes -- a universe
// problem or a fetch problem, wanting opposite fixes. The date separates them at
// zero API cost, so it is recorded.
const barFns = ["getEasternParts", "weekdaysBehindEastern", "recordNewestBarAge", "readHistoryBarAgeCounts"];
const barGrabbed = Object.fromEntries(barFns.map((n) => [n, grab(n)]));
const barMissing = barFns.filter((n) => !barGrabbed[n]);
check("the bar-age functions were extracted", barMissing.length === 0, barMissing.join(", ") || "all present");

if (!barMissing.length) {
  const decls = raw
    .split("\n")
    .filter((l) =>
      /^(let historyStaleNewestCount|let historyFreshNewestCount|const historyStaleNewest |let historyNewestBarSeen|const MAX_DIAGNOSTIC_SYMBOLS|let historyForcedRefetchFailures|const historyForcedRefetchFailureSymbols|export const HISTORY_MAX_BAR_AGE_WEEKDAYS)/.test(l)
    )
    .map((l) => l.replace(/^export\s+/, ""))
    .join("\n");
  const barJs = ts.transpileModule(
    `${decls}\n${barFns.map((n) => barGrabbed[n]).join("\n")}\n` +
      `export { recordNewestBarAge, readHistoryBarAgeCounts, weekdaysBehindEastern };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
  ).outputText;
  const b = await import(`data:text/javascript;base64,${Buffer.from(barJs).toString("base64")}`);

  const series = (date) => [{ date, close: 10 }];
  // Monday 2026-08-24, Eastern. Friday's bar is current; anything older than
  // Wednesday is stale (two weekdays of holiday slack).
  const MON = new Date("2026-08-24T11:00:00Z");
  check("Friday's bar is 0 weekdays behind a Monday", b.weekdaysBehindEastern("2026-08-21", MON) === 0, String(b.weekdaysBehindEastern("2026-08-21", MON)));
  check("Wednesday's bar is 2 weekdays behind", b.weekdaysBehindEastern("2026-08-19", MON) === 2);
  check("a 2024 bar is far behind", b.weekdaysBehindEastern("2024-05-03", MON) > 500);

  b.readHistoryBarAgeCounts(); // reset
  b.recordNewestBarAge("LIVE", series("2026-08-21"));
  b.recordNewestBarAge("DEAD", series("2024-05-03"));
  b.recordNewestBarAge("MISSED", series("2026-08-14"));
  const got = b.readHistoryBarAgeCounts();

  check("a current symbol counts fresh", got.fresh === 1, String(got.fresh));
  check("both stale shapes count stale", got.stale === 2, String(got.stale));
  check(
    "each stale symbol carries its newest bar DATE",
    got.symbols.includes("DEAD@2024-05-03") && got.symbols.includes("MISSED@2026-08-14"),
    got.symbols.join(" ")
  );
  // GUARDED, because this assertion is precisely about the date being present:
  // without it `find` returns undefined and the harness CRASHES, reporting how
  // far it got instead of what is broken. Calibration caught it -- removing the
  // date read as a crash rather than as two failures.
  const dead = got.symbols.find((x) => x.startsWith("DEAD@"));
  const missed = got.symbols.find((x) => x.startsWith("MISSED@"));
  check(
    "so delisted and merely-missed are distinguishable from the record alone",
    Boolean(dead && missed) && dead.slice(5) < missed.slice(7),
    dead && missed ? "no quote call needed" : "the date is missing from the record"
  );
  check("newestBarSeen is the max across the run", got.newestBarSeen === "2026-08-21", String(got.newestBarSeen));

  // THE THRESHOLD ITSELF, at its boundary. Two weekdays of slack, not one, so a
  // market holiday does not flag every live symbol the morning after -- a warn
  // that cries wolf on every public holiday is a warn people learn to ignore.
  // Calibration found this unasserted: changing the constant from 2 to 1 failed
  // nothing, because every fixture above sits far from the edge.
  b.readHistoryBarAgeCounts();
  b.recordNewestBarAge("HOLIDAY_SLACK", series("2026-08-19")); // Wed, 2 weekdays behind
  b.recordNewestBarAge("BEYOND_SLACK", series("2026-08-18")); // Tue, 3 weekdays behind
  const edge = b.readHistoryBarAgeCounts();
  check(
    "exactly 2 weekdays behind is FRESH (one holiday absorbed)",
    edge.fresh === 1,
    `${edge.fresh} fresh, ${edge.stale} stale`
  );
  check(
    "3 weekdays behind is STALE",
    edge.stale === 1 && edge.symbols.some((x) => x.startsWith("BEYOND_SLACK@")),
    edge.symbols.join(" ")
  );
  check("read-and-reset really resets", b.readHistoryBarAgeCounts().stale === 0);

  // A SAMPLE THAT SATURATES IS NOT A SAMPLE. The live run returned exactly 12
  // stale against a cap of 12, and 20 failures against the same cap -- so the
  // list could not be compared morning to morning, which is the only use it has.
  for (let i = 0; i < 60; i++) b.recordNewestBarAge(`S${i}`, series("2024-01-02"));
  const many = b.readHistoryBarAgeCounts();
  check("the stale COUNT is uncapped", many.stale === 60, String(many.stale));
  check("the stale SAMPLE caps above the drop cap of 12", many.symbols.length > 12, `${many.symbols.length} sampled`);
}

console.log("\n=== 8. The run record carries what the diagnosis needs ===\n");
const warmRoute = stripComments(
  fs.readFileSync(path.join(ROOT, "app/api/jobs/warm-picker-universe/route.ts"), "utf8"),
  { file: "app/api/jobs/warm-picker-universe/route.ts" }
);
check(
  "refreshMode is recorded",
  /refreshMode,/.test(warmRoute) && /const refreshMode = historyForced \? "forced" : "miss-only";/.test(warmRoute),
  '"forced" | "miss-only" — historyForced read as "a human forced this"'
);
check(
  "the deprecated key is still written alongside for one cycle",
  /\n\s+historyForced,/.test(warmRoute),
  "nothing in this repo reads it, but a run record is the kind of thing someone greps for"
);
check(
  "the forced-refetch FAILURE SYMBOLS are recorded, not only counted",
  /historyForcedRefetchFailureSymbols: barAge\.forcedRefetchFailureSymbols/.test(warmRoute),
  "a count cannot answer 'is it the same twenty every morning'"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
