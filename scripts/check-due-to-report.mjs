// The due strip's selection rule, RUN rather than pattern-matched.
//
// Every constant in it is a measurement, and every one of them has a plausible
// wrong value that changes the page without breaking it. k=7 instead of 5 is a
// different list, not an error message. So the assertions are about the DAY a
// symbol enters and the day it leaves, against dates computed by hand from the
// rule -- not against the module's own arithmetic.
//
//   node scripts/check-due-to-report.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "lib/server/dueToReport.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const transpile = (file) => ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const dataUrl = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;

// ── THE DEADLINE TABLE IS IMPORTED NOW, SO IT HAS TO BE LOADED TOO ────────
// dueToReport no longer owns its deadlines; it calls secReportDates.deadlineDays.
// A data: module cannot resolve a relative specifier, so the dependency is
// transpiled to its own data URL and the specifier rewritten to it.
//
// secReportDates is a LEAF -- it imports nothing -- which is what makes a
// one-level rewrite sufficient rather than a bundler. Asserted, not assumed:
// if it grows an import this check fails loudly here instead of silently
// testing a module that never loaded.
const depSrc = fs.readFileSync(path.join(ROOT, "lib/server/secReportDates.ts"), "utf8");
if (/^\s*import\s/m.test(depSrc)) {
  console.error("FATAL: secReportDates.ts has grown an import. The one-level rewrite below");
  console.error("is no longer sufficient and this check would test a module that cannot load.");
  process.exit(2);
}
const depUrl = dataUrl(transpile(path.join(ROOT, "lib/server/secReportDates.ts")));
const js = transpile(SRC).replace(/from\s+["']\.\/secReportDates["']/g, `from "${depUrl}"`);
const m = await import(dataUrl(js));

const DAY = 86_400_000;
const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const P = "2026-03-31";
const sym = (o) => ({ symbol: o.symbol ?? "AAA", periodEnd: o.periodEnd ?? P, medianLagDays: o.medianLagDays ?? 30, filerCategory: "filerCategory" in o ? o.filerCategory : "Large Accelerated Filer", annual: o.annual ?? false });
const has = (rows, s) => rows.some((r) => r.symbol === s);

// ── 1. k is 7, and the entry day is exactly where 7 puts it ────────────────
console.log("\n1. The entry day — k=7, measured, not preferred");
{
  check("DUE_LEAD_DAYS is 7 and is exported", m.DUE_LEAD_DAYS === 7, String(m.DUE_LEAD_DAYS));

  const one = [sym({ medianLagDays: 30 })];
  // Hand-computed: median lag 30, k 7, so the strip opens on P+23.
  check("not due on P+22", !has(m.selectDue(one, shift(P, 22)), "AAA"), shift(P, 22));
  check("due on P+23 — medianLag 30 minus k 7", has(m.selectDue(one, shift(P, 23)), "AAA"), shift(P, 23));
  check("still due on P+30, its own median", has(m.selectDue(one, shift(P, 30)), "AAA"));

  // THE PAIR ABOVE IS WHAT PINS k, and it is worth being explicit about how:
  // with medianLag 30, k=5 opens on P+25 and would fail "due on P+23", while
  // k=10 opens on P+20 and would fail "not due on P+22". Both neighbours the
  // sweep considered are excluded by those two lines together -- neither one
  // alone does it. (A third assertion here originally tested for a symbol that
  // was never in the input, so it passed against every possible k. Removed.)
  const lag12 = [sym({ medianLagDays: 12 })];
  check("a short-lag filer opens on P+5, not P+7 or P+2", has(m.selectDue(lag12, shift(P, 5)), "AAA") && !has(m.selectDue(lag12, shift(P, 4)), "AAA"));
}

// ── 2. The period must have ENDED ──────────────────────────────────────────
console.log("\n2. A period that has not ended is never due");
{
  const future = [sym({ periodEnd: shift(P, 10), medianLagDays: 2 })];
  // medianLag 2 minus k 7 is NEGATIVE, so the lead rule alone would admit it
  // five days before its own period end. Only the period-end guard stops it.
  check("a lead longer than the lag does not reach back past the period end", !has(m.selectDue(future, P), "AAA"));
  check("and it becomes due the day the period ends", has(m.selectDue([sym({ medianLagDays: 2 })], P), "AAA"));
}

// ── 3. The overdue cap — the safeguard that has never fired ────────────────
console.log("\n3. The overdue cap — inert in the shipped cut, and still bounded");
{
  check("OVERDUE_GRACE_DAYS is 30", m.OVERDUE_GRACE_DAYS === 30, String(m.OVERDUE_GRACE_DAYS));
  check(
    "this module no longer owns a deadline table",
    m.DEADLINE_LARGE_ACCELERATED_DAYS === undefined && m.DEADLINE_OTHER_DAYS === undefined,
    "consolidated onto secReportDates.deadlineDays -- two validators for one value"
  );

  // ── THE SIX CELLS, AGAINST 17 CFR 240.13a-1 / 13a-13 ────────────────────
  // Driven through selectDue rather than asserted on the table, because the
  // bug that mattered was the CALL SITE picking the wrong cell, not the table.
  // Two of these six were wrong before the consolidation and are marked.
  const cells = [
    ["Large Accelerated Filer", false, 40],
    ["Accelerated Filer",       false, 40],  // was 45 here -- WRONG, too lenient
    ["Non-accelerated Filer",   false, 45],
    ["Large Accelerated Filer", true,  60],  // no annual concept existed -- WRONG
    ["Accelerated Filer",       true,  75],  // "
    ["Non-accelerated Filer",   true,  90],  // "
  ];
  for (const [filerCategory, annual, deadline] of cells) {
    const last = deadline + m.OVERDUE_GRACE_DAYS;
    const s1 = [sym({ filerCategory, annual, medianLagDays: 30 })];
    const label = `${filerCategory}${annual ? " (annual)" : " (quarterly)"}`;
    check(`${label}: listed on P+${last}`, has(m.selectDue(s1, shift(P, last)), "AAA"));
    check(`${label}: dropped on P+${last + 1}`, !has(m.selectDue(s1, shift(P, last + 1)), "AAA"));
  }

  // THE REGRESSION THIS CONSOLIDATION FIXES, stated as its own case: an
  // accelerated filer used to be given 45 days because it was not "large
  // accelerated", so it sat in the strip for 5 days it was already overdue for.
  const accel = [sym({ filerCategory: "Accelerated Filer", annual: false, medianLagDays: 30 })];
  check(
    "an accelerated filer is dropped on P+71, not P+76",
    !has(m.selectDue(accel, shift(P, 71)), "AAA"),
    "40 + 30, not 45 + 30 -- the cell the boolean split got wrong"
  );

  // An unknown category must not TIGHTEN the clamp -- it falls back to the
  // slowest tier, so an unrecognised filer is never dropped early.
  const unknown = [sym({ filerCategory: null, annual: false, medianLagDays: 30 })];
  check("an unknown category falls back to the slowest tier (45+30)",
    has(m.selectDue(unknown, shift(P, 75)), "AAA") && !has(m.selectDue(unknown, shift(P, 76)), "AAA"));
}

// ── 4. The invariant that replaces an attribution-horizon clause ───────────
//
// selectDue deliberately has NO check against the 120-day attribution horizon,
// because the overdue cap kept every entry inside it and the clause would have
// been an unreachable branch.
//
// THE MARGIN IS NOW ZERO, WHICH IS WHY THIS IS AN EQUALITY. Before the deadline
// consolidation the widest cap was 45 + 30 = 75 against a 120-day horizon. The
// real table's widest cell is the non-accelerated ANNUAL deadline, 90, so the
// widest cap is 90 + 30 = 120 and the two now meet exactly. There is still no
// gap, but there is nothing spare: widening either number in either module
// opens one immediately, and the symptom would be a symbol stuck in the strip
// that nothing can ever clear.
console.log("\n4. The strip can never outlast the window attribution works in");
{
  const deadlines = fs.readFileSync(path.join(ROOT, "lib/server/secReportDates.ts"), "utf8");
  // ONE horizon constant now. secResultsDate.ts carried a second copy named
  // MAX_ATTRIBUTION_DAYS; it was deleted with the module, so this reads the
  // survivor. Read from source, never pinned, so the assertion cannot agree
  // with itself against a value that has moved.
  const attribution = /MAX_PERIOD_TO_ANNOUNCEMENT_DAYS = (\d+)/.exec(deadlines);
  check("MAX_PERIOD_TO_ANNOUNCEMENT_DAYS is readable from the module that owns it", attribution != null);
  const horizon = Number(attribution?.[1]);

  const table = /FILING_DEADLINE_DAYS[\s\S]*?\{([\s\S]*?)\n\};/.exec(deadlines);
  check("the deadline table is readable from the module that owns it", table != null);
  const widestCell = Math.max(...[...(table?.[1] ?? "").matchAll(/annual:\s*(\d+)/g)].map((x) => Number(x[1])));
  check("the widest statutory cell is the non-accelerated annual deadline", widestCell === 90, String(widestCell));

  const widest = widestCell + m.OVERDUE_GRACE_DAYS;
  check(
    "the widest the cap allows does not exceed the attribution horizon",
    widest <= horizon,
    `widest ${widest}d vs horizon ${horizon}d — they are now EQUAL; any widening opens a gap`
  );
  check(
    "and the margin is exactly zero, recorded so a future widening is deliberate",
    widest === horizon,
    `${widest} === ${horizon}`
  );
}

// ── 5. Ordering, and the slice the strip renders ──────────────────────────
console.log("\n5. Ordered by the symbol's own expected date, earliest first");
{
  const rows = m.selectDue(
    [
      sym({ symbol: "LATE", medianLagDays: 40 }),
      sym({ symbol: "EARLY", medianLagDays: 20 }),
      sym({ symbol: "MID", medianLagDays: 30 }),
    ],
    shift(P, 50)
  );
  check("all three are listed", rows.length === 3, JSON.stringify(rows.map((r) => r.symbol)));
  check("ordered EARLY, MID, LATE", rows.map((r) => r.symbol).join(",") === "EARLY,MID,LATE", rows.map((r) => r.symbol).join(","));
  check("expectedOn is periodEnd + the symbol's own median lag", rows[1]?.expectedOn === shift(P, 30), String(rows[1]?.expectedOn));
  check("dueFrom is that minus k", rows[1]?.dueFrom === shift(P, 23), String(rows[1]?.dueFrom));
  check("daysOutstanding counts from the period end", rows[0]?.daysOutstanding === 50, String(rows[0]?.daysOutstanding));

  // Ties break on symbol, so the strip's order does not wobble between renders.
  const tied = m.selectDue([sym({ symbol: "BBB" }), sym({ symbol: "AAA" })], shift(P, 40));
  check("a tie breaks on the symbol, so the order is stable", tied.map((r) => r.symbol).join(",") === "AAA,BBB");
}

// ── 6. Rubbish in is dropped, not rendered ────────────────────────────────
console.log("\n6. Unusable input is dropped rather than guessed at");
{
  check("an unparseable period end is dropped", m.selectDue([sym({ periodEnd: "not-a-date" })], shift(P, 40)).length === 0);
  check("a NaN median lag is dropped", m.selectDue([sym({ medianLagDays: Number.NaN })], shift(P, 40)).length === 0);
  check("a negative median lag is dropped", m.selectDue([sym({ medianLagDays: -5 })], shift(P, 40)).length === 0);
  check("an unparseable `today` yields nothing", m.selectDue([sym({})], "nonsense").length === 0);
  check("no inputs yields nothing", m.selectDue([], shift(P, 40)).length === 0);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
