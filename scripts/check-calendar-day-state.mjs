// The calendar day's four states, RUN rather than reasoned about.
//
// THE ASSERTION THAT MATTERS is not that an empty day renders. It is that the
// FOUR empties do not render the same sentence, and in particular that a
// FAILED read never reaches the words a quiet market gets. That is the bug
// #483 fixed one layer down and the page then reintroduced by testing
// `usListedCount > 0` and never consulting what #483 shipped.
//
//   node scripts/check-calendar-day-state.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "lib/server/calendarDayState.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const build = async (src) => {
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};

const SOURCE = fs.readFileSync(SRC, "utf8");
const m = await build(SOURCE);

const underMutation = async (name, from, to, probe) => {
  if (!SOURCE.includes(from)) {
    check(`mutation "${name}" could not be applied`, false, `source no longer contains: ${from.slice(0, 70)}`);
    return;
  }
  let stillHolds;
  try {
    stillHolds = await probe(await build(SOURCE.replace(from, to)));
  } catch {
    stillHolds = false;
  }
  check(`MUTATION "${name}" breaks the assertion`, !stillHolds,
    stillHolds ? "the property still held with the rule removed — the assertion above proves nothing" : "");
};

const item = (symbol) => ({ symbol, date: "2026-09-21", price: 1, marketCap: null });
const day = (over = {}) => ({
  items: [], totalCandidates: 0, complete: false, monthVisibility: "known", ...over,
});

console.log("\n1. THE FOUR EMPTIES ARE FOUR DIFFERENT CLAIMS");
{
  const failed = m.resolveCalendarDay(day({ monthVisibility: "unknown", totalCandidates: 0 }));
  const quiet = m.resolveCalendarDay(day({ monthVisibility: "known", totalCandidates: 0 }));
  const unseen = m.resolveCalendarDay(day({ monthVisibility: "unseen", totalCandidates: 0 }));
  const foreign = m.resolveCalendarDay(day({ totalCandidates: 40, complete: true }));
  const partial = m.resolveCalendarDay(day({ totalCandidates: 40, complete: false }));

  check("a FAILED month read is unavailable, never a quiet day",
    failed.kind === "unavailable" && failed.reason === "month-unread",
    `got ${JSON.stringify(failed)} — this is the branch whose absence was the bug`);
  // THE DANGEROUS SHAPE, asserted on its own: a failed read that still yielded
  // candidates. Nothing about the counts looks wrong, so only the visibility
  // flag can catch it.
  const failedButPopulated = m.resolveCalendarDay(
    day({ monthVisibility: "unknown", totalCandidates: 40, complete: true })
  );
  check("...including when the failed read still produced a plausible candidate count",
    failedButPopulated.kind === "unavailable" && failedButPopulated.reason === "month-unread",
    `got ${JSON.stringify(failedButPopulated)} — 40 candidates and 'complete' would otherwise read as a measured market fact`);
  check("a month read that found nothing IS a quiet day",
    quiet.kind === "none-scheduled");
  check("a month never looked at is unavailable, not quiet",
    unseen.kind === "unavailable" && unseen.reason === "month-unseen",
    "'we have not asked' is not 'nobody reports'");
  check("40 candidates fully quoted with no US listings is a claim about the MARKET",
    foreign.kind === "none-us-listed" && foreign.totalCandidates === 40);
  check("...but 40 candidates NOT fully quoted is a claim about US",
    partial.kind === "unavailable" && partial.reason === "day-incomplete",
    "an unfinished sweep cannot report that nobody qualified");

  // THE HEADLINE. All five above have usListedCount === 0.
  const kinds = new Set([failed, quiet, unseen, foreign, partial].map((s) => `${s.kind}:${s.reason ?? ""}`));
  check("five empty days produce FIVE distinct states, though all have zero rows",
    kinds.size === 5,
    `got ${kinds.size}: ${[...kinds].join(", ")} — a bare emptiness test collapses all five`);

  const words = new Set([failed, quiet, unseen, foreign, partial].map((s) => m.dayStateMessage(s)));
  check("...and a failed day never reads as a quiet one",
    m.dayStateMessage(failed) !== m.dayStateMessage(quiet) &&
      m.dayStateMessage(unseen) !== m.dayStateMessage(quiet) &&
      m.dayStateMessage(partial) !== m.dayStateMessage(quiet),
    `${words.size} distinct sentences across the five`);
}

console.log("\n2. ROWS WIN OVER EVERYTHING, BECAUSE THE CLAIM IS EXISTENTIAL");
{
  const listed = m.resolveCalendarDay(day({ items: [item("AAPL")], totalCandidates: 40, complete: false }));
  check("rows render even on an INCOMPLETE day — 'these filed' needs no completeness",
    listed.kind === "listed" && listed.items.length === 1);
  // ...but not over a failed read, because the rows themselves may be a
  // partial slice of a month we could not finish reading.
  const listedButFailed = m.resolveCalendarDay(
    day({ items: [item("AAPL")], totalCandidates: 40, monthVisibility: "unknown" })
  );
  check("...but a FAILED month read still wins, because the rows may be a partial slice",
    listedButFailed.kind === "unavailable",
    "a count-shaped test cannot rule out a failure that produced a plausible count");
}

console.log("\n3. THE COPY RULE");
{
  const all = [m.DAY_NONE_SCHEDULED, m.DAY_NONE_US_LISTED, m.DAY_UNAVAILABLE];
  check("no string forecasts a filing",
    all.every((s) => !/will report|expected to report|reports on/i.test(s)),
    "the page states the public record, it does not predict it");
  check("the unavailable string says the gap is OURS",
    /our side|not a quiet day/i.test(m.DAY_UNAVAILABLE),
    "a reader cannot otherwise tell a broken day from a silent one");
  check("the two market claims do NOT blame us",
    !/our side/i.test(m.DAY_NONE_SCHEDULED) && !/our side/i.test(m.DAY_NONE_US_LISTED));
}

console.log("\n4. THE MUTANTS — each removes one guard and must break something");
{
  // PROBED WITH A POPULATED, COMPLETE DAY, and the first attempt at this
  // mutant was probed with an empty one and did not break -- worth recording,
  // because it says something true about the module. At totalCandidates 0 the
  // month-unseen branch ALSO returns unavailable, so removing the failed-read
  // guard changes nothing there and the mutant passed while proving nothing.
  //
  // The dangerous case is the opposite one: a failed read that still produced
  // candidates. Without the guard that becomes `none-us-listed` -- a positive
  // claim about the market, made off a read that failed. That is the exact
  // shape of the bug, so that is what the mutant must probe.
  await underMutation(
    "calendar day: the failed-read guard removed (a failed month reads as a quiet day)",
    'if (inputs.monthVisibility === "unknown") {\n    return { kind: "unavailable", reason: "month-unread" };\n  }',
    "",
    (mm) => mm.resolveCalendarDay(
      day({ monthVisibility: "unknown", totalCandidates: 40, complete: true })
    ).kind === "unavailable"
  );
  await underMutation(
    "calendar day: the failed-read guard moved BELOW the rows test (ordering)",
    'if (inputs.monthVisibility === "unknown") {\n    return { kind: "unavailable", reason: "month-unread" };\n  }\n\n  // Rows we have are rows we can show',
    "// Rows we have are rows we can show",
    (mm) => mm.resolveCalendarDay(
      day({ items: [item("AAPL")], totalCandidates: 40, monthVisibility: "unknown" })
    ).kind === "unavailable"
  );
  await underMutation(
    "calendar day: 'unseen' admitted as a measured empty",
    'return inputs.monthVisibility === "known"\n      ? { kind: "none-scheduled" }\n      : { kind: "unavailable", reason: "month-unseen" };',
    'return { kind: "none-scheduled" };',
    (mm) => mm.resolveCalendarDay(day({ monthVisibility: "unseen" })).kind === "unavailable"
  );
  await underMutation(
    "calendar day: completeness ignored (a partial sweep claims nobody qualified)",
    'return inputs.complete\n    ? { kind: "none-us-listed", totalCandidates: inputs.totalCandidates }\n    : { kind: "unavailable", reason: "day-incomplete" };',
    'return { kind: "none-us-listed", totalCandidates: inputs.totalCandidates };',
    (mm) => mm.resolveCalendarDay(day({ totalCandidates: 40, complete: false })).kind === "unavailable"
  );
  await underMutation(
    "calendar day: replaced wholesale by the emptiness test this file exists to kill",
    "export function resolveCalendarDay(inputs: CalendarDayInputs): CalendarDayState {",
    'export function resolveCalendarDay(inputs: CalendarDayInputs): CalendarDayState {\n  if (inputs.items.length === 0) return { kind: "none-scheduled" };',
    (mm) => mm.resolveCalendarDay(day({ monthVisibility: "unknown" })).kind === "unavailable"
  );
}

// ── 5. THE PART THAT ACTUALLY REGRESSED ───────────────────────────────────
// Sections 1-4 test a module. The module was never the problem: #483's signals
// were correct, exported, and READ BY NOTHING. So this section asserts the
// CALL SITE, because a resolver nobody calls fails exactly the way a missing
// resolver does and passes every test above while doing it.
console.log("\n5. THE PAGE CONSUMES IT — the assertion the last two fixes lacked");
{
  const PAGE = path.join(process.cwd(), "app/earnings-calendar/page.tsx");
  const src = fs.readFileSync(PAGE, "utf8");

  check("the page imports the resolver",
    /from "@\/lib\/server\/calendarDayState"/.test(src),
    "a resolver nobody calls is indistinguishable from no resolver");
  check("...and calls it",
    /resolveCalendarDay\(/.test(src));
  check("...feeding it the month visibility #483 shipped and nothing read",
    /monthVisibility:\s*getMonthVisibility\(/.test(src),
    "this is the signal whose absence from the page WAS the bug");
  check("...and the completeness flag",
    /complete:\s*dateComplete/.test(src));

  // THE REGRESSION ITSELF, spelled as the thing to stay absent. Any resurrection
  // of a count-shaped branch on usListedCount is the bug returning.
  const bareEmptiness = /dayData\.usListedCount\s*>\s*0\s*\?/.test(src);
  check("the bare emptiness test is GONE and must not come back",
    !bareEmptiness,
    "`dayData.usListedCount > 0 ? quiet : quiet` is the exact line that undid #483");

  // A renderable branch per state, so a new state cannot be added and silently
  // fall through to whichever branch happens to be last.
  check("every non-listed state reaches a message rather than a blank",
    ["none-scheduled", "none-us-listed", "unavailable"].every((k) =>
      typeof m.dayStateMessage(
        k === "unavailable" ? { kind: k, reason: "month-unread" }
        : k === "none-us-listed" ? { kind: k, totalCandidates: 1 }
        : { kind: k }
      ) === "string"
    ));
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
