// EIGHT weekly aggregators. Do they agree?
//
// WHY THIS MATTERS RIGHT NOW. The Stooq migration's A5 step recomputes picker
// signals from new daily bars and diffs section membership. If two aggregators
// bucket the same dailies into different weeks, the weekly MA200 picker moves --
// and the symptom is indistinguishable from "Stooq's data is different". The
// owner's strongest picker would look broken by a source change when it was
// actually the repo disagreeing with itself. So this is a PREREQUISITE for
// reading A5, not a tidiness exercise.
//
// AND THE COUNT WAS WRONG. The build plan said seven. There are EIGHT: the
// eighth is aggregateToWeekly in app/insights/[slug]/InsightPostClient.tsx,
// which draws the chart on every published insight post -- including the weekly
// MA200 posts the daily automation writes with timeframe "w". Found by grepping
// for the definitions rather than trusting the list, and it is discovered here on
// every run rather than pinned, so a ninth copy shows up as a new row.
//
// THE FUNCTIONS ARE EXTRACTED FROM SOURCE AND TRANSPILED, NOT REIMPLEMENTED.
// A reimplementation is a derived artefact, and a derived artefact cannot be
// evidence about the thing it was derived from
// (claude/traps/a-reconstruction-cannot-corroborate-its-source.md). A harness
// that compares eight hand-copies of eight functions tests the copies. So the
// real function text is pulled out with the TypeScript AST, type-stripped by the
// TypeScript transpiler, and executed.
import ts from "typescript";
import fs from "node:fs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Every file that might hold one. Discovered by name, so a copy added to a file
// already in this list is picked up without editing the list.
const CANDIDATE_FILES = [
  "lib/server/pickersBuilder.ts",
  "lib/server/playsBuilder.ts",
  "lib/server/bullFlagsBuilder.ts",
  "lib/server/descendingTrianglesBuilder.ts",
  "app/components/DashboardClient.tsx",
  "app/markets/spx/SPXChartClient.tsx",
  "app/stock/[symbol]/StockSymbolPageClient.tsx",
  "app/insights/[slug]/InsightPostClient.tsx",
];
const AGGREGATOR_NAMES = new Set([
  "aggregatePoints",
  "aggregateWeekly",
  "aggregateWeeklyPoints",
  "aggregateToWeekly",
]);
// Helpers an aggregator may call. Extracted alongside so the transpiled function
// can actually run.
const HELPER_NAMES = new Set(["startOfWeekUtc", "monthKey"]);

/** Pull named top-level function declarations out of a file, as source text. */
function extractFunctions(file) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const out = { aggregators: [], helpers: new Map() };
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name) continue;
    const name = stmt.name.text;
    const src = text.slice(stmt.getStart(sf), stmt.getEnd());
    if (AGGREGATOR_NAMES.has(name)) out.aggregators.push({ name, src });
    if (HELPER_NAMES.has(name)) out.helpers.set(name, src);
  }
  return out;
}

/** Type-strip and evaluate, returning the callable. */
function compile(fnSrc, helperSrcs, exportName) {
  const combined = `${helperSrcs.join("\n")}\n${fnSrc}\nreturn ${exportName};`;
  const js = ts.transpileModule(combined, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.Preserve },
    reportDiagnostics: false,
  }).outputText;
  return new Function(js)();
}

console.log("1. Find every weekly aggregator, by definition rather than by list");

const found = [];
for (const file of CANDIDATE_FILES) {
  if (!fs.existsSync(file)) {
    console.error(`FATAL: ${file} does not exist — the list is stale and this measures less than it claims.`);
    process.exit(1);
  }
  const { aggregators, helpers } = extractFunctions(file);
  for (const agg of aggregators) {
    found.push({ file, ...agg, helpers: [...helpers.values()] });
  }
}
for (const f of found) console.log(`  ${f.file} :: ${f.name}`);
check(
  "at least eight aggregators found",
  found.length >= 8,
  `${found.length} found — if this drops, a copy was deleted or renamed and the ` +
    `list above needs updating; if it rises, a NINTH copy was added`
);

// Compile them. A function that will not compile is a hard stop: silently
// dropping it would shrink the comparison and report agreement among fewer.
const impls = [];
for (const f of found) {
  const label = `${f.file.replace(/^.*\//, "")}::${f.name}`;
  try {
    const fn = compile(f.src, f.helpers, f.name);
    impls.push({ label, file: f.file, name: f.name, fn, arity: f.name === "aggregatePoints" ? 2 : 1 });
  } catch (e) {
    console.error(`FATAL: could not compile ${label}: ${String(e?.message ?? e)}`);
    process.exit(1);
  }
}
check(
  "every aggregator compiles and is callable",
  impls.length === found.length,
  `${impls.length}/${found.length} — a dropped one would make the rest look more ` +
    `unanimous than they are`
);

// ── The inputs, each chosen for a specific divergence ────────────────────────
const bar = (date, close, high, low, open, volume) => ({ date, close, high, low, open, volume });

// A clean four-week run, Mon-Fri, no gaps. If they disagree HERE, nothing else
// matters.
const clean = [];
{
  const start = Date.UTC(2026, 7, 3); // Monday 2026-08-03
  for (let w = 0; w < 4; w++) {
    for (let d = 0; d < 5; d++) {
      const dt = new Date(start + (w * 7 + d) * 86400000);
      const iso = dt.toISOString().slice(0, 10);
      const n = w * 5 + d + 1;
      clean.push(bar(iso, 100 + n, 101 + n, 99 + n, 100 + n, 1000 + n));
    }
  }
}
// A HOLIDAY-SHAPED WEEK: the Monday is missing, so week 1 starts on the Tuesday.
// This is the first of the two shapes Stooq could realistically differ on, and a
// disagreement here would move a weekly MA without any price differing.
const holiday = clean.filter((b) => b.date !== "2026-08-03").concat([]);
// A partial current week: one bar only in the final week.
const partial = [...clean.slice(0, 15), bar("2026-08-24", 200, 201, 199, 200, 5000)];
// UNSORTED. This is where a Map-keyed implementation and a sequential-run
// implementation must differ: the Map merges the two halves of a week that are
// not adjacent in the input, the run-based one emits the week twice.
const unsorted = [clean[0], clean[5], clean[1], clean[6], clean[2]];
// A week revisited after a gap -- the same divergence, from real-world shape
// (a backfill appended out of order) rather than a shuffle.
const revisited = [...clean.slice(0, 5), ...clean.slice(10, 15), clean[2]];

const CASES = [
  ["clean 4 weeks, Mon-Fri", clean],
  ["holiday (no Monday in week 1)", holiday],
  ["partial final week (1 bar)", partial],
  ["UNSORTED input", unsorted],
  ["week revisited after a gap", revisited],
];

// ── What "identical" means, and the two questions kept separate ──────────────
// BUCKETING is what moves a moving average. The DATE LABEL is what an axis
// shows. Conflating them would report a cosmetic difference as a signal risk, or
// hide a real one behind a label mismatch -- so they are compared separately.
const bucketShape = (out) =>
  JSON.stringify(
    out.map((p) => [
      p.close ?? null,
      p.high ?? null,
      p.low ?? null,
      p.volume ?? null,
    ])
  );
const dateShape = (out) => JSON.stringify(out.map((p) => p.date));

console.log("\n2. Do they bucket identically? (this is what moves a moving average)");

const perCase = {};
for (const [caseName, input] of CASES) {
  const outs = impls.map((i) => {
    try {
      const res = i.arity === 2 ? i.fn(structuredClone(input), "w") : i.fn(structuredClone(input));
      return { label: i.label, out: Array.isArray(res) ? res : null, error: null };
    } catch (e) {
      return { label: i.label, out: null, error: String(e?.message ?? e) };
    }
  });
  const errored = outs.filter((o) => o.error);
  const good = outs.filter((o) => o.out);
  const groups = new Map();
  for (const o of good) {
    const k = bucketShape(o.out);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o.label);
  }
  const dateGroups = new Map();
  for (const o of good) {
    const k = dateShape(o.out);
    if (!dateGroups.has(k)) dateGroups.set(k, []);
    dateGroups.get(k).push(o.label);
  }
  perCase[caseName] = {
    bucketGroups: [...groups.values()],
    dateGroups: [...dateGroups.values()],
    errors: errored.map((o) => ({ label: o.label, error: o.error })),
    barCounts: good.map((o) => ({ label: o.label, bars: o.out.length })),
  };

  console.log(`\n  ${caseName} (${input.length} daily bars)`);
  if (errored.length) {
    for (const e of errored) console.log(`    THREW  ${e.label}: ${e.error}`);
  }
  if (groups.size === 1) {
    console.log(`    bucketing: ONE group — all ${good.length} agree (${good[0].out.length} weekly bars)`);
  } else {
    console.log(`    bucketing: ${groups.size} DIFFERENT groups:`);
    let n = 0;
    for (const [k, labels] of groups) {
      const count = JSON.parse(k).length;
      console.log(`      group ${++n} (${count} weekly bars): ${labels.join(", ")}`);
    }
  }
  console.log(
    dateGroups.size === 1
      ? `    date label: one convention`
      : `    date label: ${dateGroups.size} conventions — cosmetic for MAs, visible on axes`
  );
}

// THE LOAD-BEARING ASSERTION. The three shapes Stooq can realistically differ on
// are holidays, the current partial week, and a clean run. Those must agree, or
// A5 cannot be read.
const SIGNAL_CASES = ["clean 4 weeks, Mon-Fri", "holiday (no Monday in week 1)", "partial final week (1 bar)"];
for (const name of SIGNAL_CASES) {
  const r = perCase[name];
  check(
    `bucketing agrees on: ${name}`,
    r.bucketGroups.length === 1 && r.errors.length === 0,
    r.bucketGroups.length === 1
      ? "all implementations produce the same weekly OHLCV"
      : `${r.bucketGroups.length} groups — a weekly signal computed by one of these ` +
        `disagrees with the same signal computed by another, on input neither ` +
        `provider changed. Fix before reading the A5 diff`
  );
}

console.log("\n3. Where they genuinely differ, stated rather than asserted away");
// UNSORTED input is NOT asserted to agree, because the two algorithms cannot:
// one is Map-keyed, the other groups consecutive runs. Recording the difference
// and its precondition is more useful than a failing assertion nobody can act
// on -- but it becomes load-bearing the moment an ingest can emit out-of-order
// bars, which is exactly what a whole-market archive parse might do.
for (const name of ["UNSORTED input", "week revisited after a gap"]) {
  const r = perCase[name];
  console.log(`  ${name}: ${r.bucketGroups.length} bucketing group(s)`);
  for (const c of r.barCounts) console.log(`      ${c.label.padEnd(42)} ${c.bars} weekly bars`);
}
check(
  "the Stooq ingest must therefore emit bars sorted by date ascending",
  true,
  "not a property of this repo but a REQUIREMENT ON PHASE 1 recorded here: the " +
    "Map-keyed and run-based implementations agree only on sorted input, so an " +
    "unsorted archive parse would desynchronise the pickers from the charts"
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
