// The DueInput producer, RUN rather than reasoned about.
//
// ── WHAT IS ACTUALLY AT RISK HERE ─────────────────────────────────────────
// Every defect this file hunts produces a strip that RENDERS. None of them
// throw, none of them empty the page, and all of them are invisible to a reader:
//
//   a lag read off the wrong union arm      -> a symbol silently vanishes
//   `annual` defaulted the tightening way   -> a punctual filer aged out early
//   `category` coerced to ""                -> reads as a category we had
//   coverage counted over the manifest      -> a ratio over the wrong population
//   skip reasons collapsed to one           -> "23 skipped", owner unknown
//
// ── WHAT THIS FILE DOES **NOT** CLAIM ─────────────────────────────────────
// It asserts the PURE half against constructed records. The `listed` branch was
// verified against real production data separately, by relay 35714403198
// (claude/due-input-census-2026-09-22.md, section 5). The `none-outstanding`
// and `unavailable` branches CANNOT be produced from production as it stands —
// something is always outstanding and coverage is 75.1%, well above the floor —
// so they are exercised here from FORCED INPUTS and that is stated rather than
// glossed. Section 5 below is labelled accordingly.
//
//   node scripts/check-due-inputs.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "lib/server/dueInputs.ts");
const CUT_FILE = path.join(ROOT, "data/due-strip.json");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const raw = fs.readFileSync(SRC, "utf8");

// The pure half, with its Redis-bound imports and the JSON import removed. The
// cut is re-declared from the committed file so the module under test reads the
// same 50 the shipped one does.
const cutDoc = JSON.parse(fs.readFileSync(CUT_FILE, "utf8"));
const pure = raw
  .replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
  .replace(/^const DUE_STRIP_CUT: readonly string\[\] = cut\.symbols;$/m, "")
  .replace(
    /export const DUE_STRIP_CUT: readonly string\[\] = cut\.symbols;/,
    `export const DUE_STRIP_CUT = ${JSON.stringify(cutDoc.symbols)};`
  )
  .replace(
    /export const DUE_STRIP_CUT_GENERATED_AT: string = cut\.generatedAt;/,
    `export const DUE_STRIP_CUT_GENERATED_AT = ${JSON.stringify(cutDoc.generatedAt)};`
  )
  // getDueStripState closes over the stripped imports and is not exercised
  // here; dropping it keeps the lift closed rather than loading a module with
  // dangling names that would throw only if something called it.
  .replace(/export async function getDueStripState[\s\S]*?\n\}\n?$/m, "");

const js = ts.transpileModule(pure, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

// The real deadline table, for the direction assertion in section 3.
const rdJs = ts.transpileModule(
  fs.readFileSync(path.join(ROOT, "lib/server/secReportDates.ts"), "utf8")
    .replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, ""),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }
).outputText;
const rd = await import(`data:text/javascript;base64,${Buffer.from(rdJs).toString("base64")}`);

const dated = (over = {}) => ({
  symbol: "X", cik: "1", at: "2026-09-22T00:00:00.000Z", events: [{}],
  nextPeriodEnd: "2026-06-30",
  next: { kind: "date", date: "2026-08-01", medianLagDays: 32, spreadDays: 2, fromEvents: 4, clamped: false, timing: null, estimator: "A" },
  ...over,
});

console.log("\n1. A RECORD BECOMES AN INPUT, OR SAYS WHY NOT — BY NAME");
{
  const ok = m.dueInputFrom("AAPL", dated());
  check("a dated estimate produces an input", "input" in ok, JSON.stringify(ok));
  check("carrying the stored period end", ok.input?.periodEnd === "2026-06-30");
  check("and the estimate's own median lag", ok.input?.medianLagDays === 32);

  check("no record at all is 'no-record'",
    m.dueInputFrom("X", null).skip === "no-record");
  check("a record with no nextPeriodEnd is 'no-period-end'",
    m.dueInputFrom("X", dated({ nextPeriodEnd: null })).skip === "no-period-end");

  // THE THREE NON-DATE SHAPES, SEPARATELY. A gate written as `!rec.next` would
  // pass "month" and "none" straight through with an undefined lag.
  for (const [label, next] of [
    ["month", { kind: "month", month: "2026-08", spreadDays: 12, fromEvents: 4, timing: null }],
    ["none", { kind: "none", reason: "only 0 prior 8-K item 2.02 announcement(s)" }],
    ["absent", undefined],
  ]) {
    const got = m.dueInputFrom("X", dated({ next }));
    check(`an estimate of kind "${label}" is 'no-median-lag', not an input`,
      got.skip === "no-median-lag", JSON.stringify(got));
  }

  // ── THE DANGEROUS SHAPE, AND WHY THE KIND GATE IS NOT REDUNDANT ───────
  // The `kind !== "date"` gate and the Number.isFinite guard below it produce
  // the SAME answer for every record the type permits, because only the "date"
  // arm declares medianLagDays. A mutant that removes the gate would therefore
  // pass against every fixture above while proving nothing -- the failure this
  // build has already hit three times.
  //
  // They differ on exactly one shape: a non-date estimate that nonetheless
  // carries a numeric lag. The stored record is JSON from a previous
  // deployment, not a typed value, so this is reachable in production the day
  // the estimator's shape changes. THE DISCRIMINANT IS THE CONTRACT, not the
  // presence of a field, and this is the assertion that says so.
  const strayLag = m.dueInputFrom("X", dated({
    next: { kind: "month", month: "2026-08", spreadDays: 12, fromEvents: 4, timing: null, medianLagDays: 32 },
  }));
  check("a NON-date estimate carrying a stray numeric lag is still refused",
    strayLag.skip === "no-median-lag", JSON.stringify(strayLag));

  // THE FPI CASE, SPELLED OUT, because it is the one a reader will meet.
  const fpi = m.dueInputFrom("ASML", dated({
    next: { kind: "none", reason: "only 0 prior 8-K item 2.02 announcement(s)" },
  }));
  check("a 6-K filer with no 8-K 2.02 history yields no input",
    fpi.skip === "no-median-lag");
}

console.log("\n2. `category` IS PASSED THROUGH, NEVER INVENTED");
{
  const withCat = m.dueInputFrom("X", dated({ category: "Large accelerated filer" }));
  check("a stored category reaches filerCategory verbatim",
    withCat.input?.filerCategory === "Large accelerated filer");

  const noCat = m.dueInputFrom("X", dated());
  check("an ABSENT category becomes null, not \"\"",
    noCat.input?.filerCategory === null, JSON.stringify(noCat.input?.filerCategory));

  // The distinction is not cosmetic: deadlineDays lowercases and keys into the
  // table, so "" and null both miss -- but "" reads at every call site as a
  // category that was read and was empty.
  check("and null takes DEADLINE_FALLBACK, the slowest column",
    rd.deadlineDays(null, false) === rd.DEADLINE_FALLBACK.quarter &&
    rd.deadlineDays(null, true) === rd.DEADLINE_FALLBACK.annual);
}

console.log("\n3. THE UNKNOWN-`annual` DEFAULT, AND ITS DIRECTION");
{
  check("a stored annual=true is passed through",
    m.dueInputFrom("X", dated({ annual: true })).input?.annual === true);
  // THE ONE THAT MATTERS: `false` is falsy, so `rec.annual || DEFAULT` would
  // silently rewrite it to true. The typeof test is what stops that.
  check("a stored annual=FALSE survives (not swallowed by the default)",
    m.dueInputFrom("X", dated({ annual: false })).input?.annual === false);
  check("an absent annual takes ANNUAL_WHEN_UNKNOWN",
    m.dueInputFrom("X", dated()).input?.annual === m.ANNUAL_WHEN_UNKNOWN);

  // ── THE ASSERTION THAT WAS TOO WEAK, AND THE MUTANT THAT SAID SO ──────
  // This read `defaultCap >= quarterCap`. Flipping ANNUAL_WHEN_UNKNOWN to
  // false makes both sides 45 and `45 >= 45` holds, so mutant D2 SURVIVED --
  // an assertion phrased loosely enough to be satisfied by the exact answer it
  // exists to reject.
  //
  // The rule is not "does not tighten". It is "takes the SLOW column": every
  // row of FILING_DEADLINE_DAYS has annual strictly greater than quarter
  // (40/60, 40/75, 45/90), so an unknown that lands on the quarterly cell
  // drops a genuinely annual filer 15 to 45 days early. Strict, and asserted
  // across the whole table rather than one cell, so it cannot be satisfied by
  // a coincidence in the fallback row.
  const rows = [...Object.keys(rd.FILING_DEADLINE_DAYS), null];
  const tighten = rows.filter((c) =>
    !(rd.deadlineDays(c, m.ANNUAL_WHEN_UNKNOWN) > rd.deadlineDays(c, false)));
  check("the unknown-annual default takes the SLOW column, for every filer tier",
    tighten.length === 0,
    tighten.length
      ? `tightens for: ${tighten.map((c) => c ?? "(fallback)").join(", ")}`
      : rows.map((c) => `${c ?? "fallback"} ${rd.deadlineDays(c, false)}->${rd.deadlineDays(c, m.ANNUAL_WHEN_UNKNOWN)}d`).join(" · "));
}

console.log("\n4. THE CUT IS PARTITIONED — EVERY SYMBOL IS AN INPUT OR A NAMED SKIP");
{
  const recs = new Map([
    ["AAPL", dated()],
    ["MSFT", dated({ next: { kind: "month", month: "2026-08", spreadDays: 12, fromEvents: 4, timing: null } })],
    ["GOOGL", dated({ nextPeriodEnd: null })],
    ["ASML", null],
  ]);
  const cut = ["AAPL", "MSFT", "GOOGL", "ASML"];
  const built = m.buildDueInputs(cut, recs);

  check("inputs carry only the constructible ones",
    built.inputs.length === 1 && built.inputs[0].symbol === "AAPL");
  check("no-median-lag names MSFT", built.skipped["no-median-lag"].join() === "MSFT");
  check("no-period-end names GOOGL", built.skipped["no-period-end"].join() === "GOOGL");
  check("no-record names ASML", built.skipped["no-record"].join() === "ASML");

  // A DENOMINATOR ASSERTION, not a spot check. Inputs plus every skip bucket
  // must equal the cut exactly -- a symbol cannot be dropped without appearing
  // somewhere, which is what turns "23 skipped" into an answerable number.
  const accounted = built.inputs.length +
    Object.values(built.skipped).reduce((n, xs) => n + xs.length, 0);
  check("inputs + every skip bucket == the cut, exactly",
    accounted === cut.length, `${accounted} of ${cut.length}`);

  const missing = recs.size ? cut.filter((s) =>
    !built.inputs.some((i) => i.symbol === s) &&
    !Object.values(built.skipped).some((xs) => xs.includes(s))) : [];
  check("and no symbol is unaccounted for", missing.length === 0, missing.join(" "));
}

console.log("\n5. COVERAGE IS OVER THE CUT, AND COUNTS EVENTS NOT RECORDS");
{
  // ── WHY THE CUT AND NOT THE 700 ────────────────────────────────────────
  // Counting the analysis universe needs the manifest's per-symbol
  // reportDatesAt stamp, and check-sec-daily-index forbids any render path
  // reading the 417 KB manifest value BY NAME. The first draft of dueInputs.ts
  // called readManifest() and that check failed it. See coverageOfCut's
  // docblock for the full argument; these assertions pin the properties.
  const rec = (events) => ({ symbol: "X", cik: "1", at: "", events, nextPeriodEnd: null, next: { kind: "none", reason: "" } });
  const cut = ["AAPL", "MSFT", "GOOGL", "ASML"];
  const records = new Map([
    ["AAPL", rec([{ announcedOn: "2026-07-31", periodEnd: "2026-06-27" }])],
    ["MSFT", rec([{ announcedOn: "2026-07-29", periodEnd: "2026-06-30" }])],
    // A RECORD THE CRON WROTE AND FOUND NOTHING IN. sec-facts writes one even
    // for a filer with no Item 2.02 history, so "a record exists" is the weaker
    // fact and counting it inflates the ratio in the direction that makes the
    // floor easier to clear.
    ["GOOGL", rec([])],
    ["ASML", null],
  ]);
  const cov = m.coverageOfCut(cut, records);
  check("universeSize is the cut's own size", cov.universeSize === 4, `${cov.universeSize}`);
  check("an EMPTY-events record is not counted as able to answer",
    cov.withResultsDate === 2, `${cov.withResultsDate}`);
  check("and a missing record is not counted either",
    m.coverageOfCut(["NOPE"], records).withResultsDate === 0);
  check("a cut of nothing yields a zero denominator, not a division",
    m.coverageOfCut([], records).universeSize === 0);

  // THE DRIFT CHECK: the cut was ranked out of the analysis universe, so a
  // symbol that has left it is being ranked by a list the site no longer covers.
  check("cutDrift names cut symbols absent from the universe",
    m.cutDrift(m.DUE_STRIP_CUT.filter((s) => s !== "NVDA")).join() === "NVDA");
  check("and names nothing when the cut is fully covered",
    m.cutDrift(m.DUE_STRIP_CUT).length === 0);
}

console.log("\n6. THE THREE BRANCHES — ONE FROM REAL DATA, TWO FROM FORCED INPUTS");
{
  // SAID PLAINLY, because the difference is the honest part. `listed` was
  // verified against the live store by relay 35714403198 and rendered one real
  // row (MU, period 2026-08-27, 26 days outstanding, coverage 75.1%). The other
  // two cannot be produced from production as it stands, so what follows
  // exercises the shipped resolver against CONSTRUCTED inputs and claims
  // nothing more.
  const dsJs = ts.transpileModule(
    fs.readFileSync(path.join(ROOT, "lib/server/dueStripState.ts"), "utf8")
      .replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, ""),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }
  ).outputText;
  const ds = await import(`data:text/javascript;base64,${Buffer.from(dsJs).toString("base64")}`);

  const entries = [{ symbol: "MU", periodEnd: "2026-08-27", dueFrom: "2026-09-15", expectedOn: "2026-09-22", daysOutstanding: 26 }];
  const listed = ds.resolveDueStrip({ universeSize: 700, withResultsDate: 526, manifestRead: true, entries });
  check("[shape of the REAL case] a real entry at real coverage is 'listed'",
    listed.kind === "listed" && listed.entries.length === 1);

  const none = ds.resolveDueStrip({ universeSize: 700, withResultsDate: 526, manifestRead: true, entries: [] });
  check("[FORCED INPUT] an empty list above the floor is 'none-outstanding'",
    none.kind === "none-outstanding");

  const unavail = ds.resolveDueStrip({ universeSize: 0, withResultsDate: 0, manifestRead: false, entries: [] });
  check("[FORCED INPUT] a failed read is 'unavailable', never an empty market",
    unavail.kind === "unavailable" && unavail.reason === "manifest-unread");

  check("and the three are three distinct kinds",
    new Set([listed.kind, none.kind, unavail.kind]).size === 3);
}

console.log("\n7. THE COMMITTED CUT, AND THE RECORD THAT EXPLAINS ITS SHORTFALL");
{
  check("data/due-strip.json is committed", fs.existsSync(CUT_FILE));
  check("it holds exactly 50 symbols", cutDoc.symbols.length === 50, `${cutDoc.symbols.length}`);
  check("with no duplicates", new Set(cutDoc.symbols).size === 50);
  check("it carries a generation date, so staleness is visible",
    /^\d{4}-\d{2}-\d{2}$/.test(cutDoc.generatedAt ?? ""), cutDoc.generatedAt);
  check("and it stores NO market-cap figure (a frozen reading on a live page)",
    !JSON.stringify(cutDoc).match(/"(marketCap|cap)":\s*\d/));
  check("the module's cut IS the committed file", m.DUE_STRIP_CUT.length === 50);

  // ── THE CENSUS MUST SURVIVE IN THE SOURCE ───────────────────────────────
  // The eight are structurally excluded by the ESTIMATOR, not by this module,
  // so a later reader finding the strip short has every reason to "fix" it
  // here. The comment naming them is the only thing standing between them and
  // widening a filter that also feeds the live stock page. If it is deleted,
  // this fails.
  const FPI = ["ASML", "BABA", "HSBC", "RY", "MUFG", "NVS", "AZN", "SHEL"];
  const absent = FPI.filter((s) => !raw.includes(s));
  check("the FPI/6-K exclusion is recorded in the source, naming all eight",
    absent.length === 0, absent.length ? `missing: ${absent.join(" ")}` : "");
  check("and it says WHY they cannot appear (the 8-K item 2.02 basis filter)",
    raw.includes("8-K item 2.02") && /6-K/.test(raw));
  check("and every one of the eight is really in the cut it describes",
    FPI.every((s) => cutDoc.symbols.includes(s)),
    FPI.filter((s) => !cutDoc.symbols.includes(s)).join(" "));
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
