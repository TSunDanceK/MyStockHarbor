// THE BOUNDED BAR RANGE — and the one failure direction that matters.
//
// A range filter has two ways to be wrong and they are not symmetric:
//
//   TOO NARROW  drops bars. computeEarningsReactionDetail then finds no
//               points[reactIdx + 19] and drift20 goes null — the card shows
//               fewer numbers and nothing errors. Bad, but visible to anyone
//               comparing two symbols.
//   TOO WIDE    returns everything. A "no match, so return the input" fallback
//               turns the narrowest possible question into the widest possible
//               answer while looking like it worked, and the caller cannot
//               tell: a full series IS a valid answer shape.
//
// The second is what this checks hardest, because it is the one that passes
// review.
//
// getDailyBars is LIFTED rather than imported: historyCache imports
// @upstash/redis, which cannot resolve here. getDailyHistory is stubbed, so
// what is under test is the slicing and the bounds, which is the half that can
// be wrong in a way a check would catch.
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const SRC = readCodeOnly("lib/server/historyCache.ts");
const FN = grabFunction(SRC, "getDailyBars");
if (!FN) {
  console.error("FATAL: could not lift getDailyBars from historyCache.ts");
  process.exit(2);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// One bar per calendar day across three months, so a range's expected size is
// arithmetic rather than a second implementation of the thing under test.
const BARS = [];
for (let t = Date.parse("2026-01-01"); t <= Date.parse("2026-03-31"); t += 86400000) {
  BARS.push({ date: new Date(t).toISOString().slice(0, 10), close: 1, volume: 1 });
}

const build = async (fnSrc = FN) =>
  lift(
    [
      `const getDailyHistory = async () => (${JSON.stringify(BARS)});`,
      fnSrc.replace("export async function", "async function"),
      "export { getDailyBars };",
    ].join("\n")
  );
const mod = await build();

const underMutation = async (name, from, to, probe) => {
  if (!FN.includes(from)) {
    check(`mutation "${name}" could not be applied`, false, `source no longer contains: ${from.slice(0, 60)}`);
    return;
  }
  let stillHolds;
  try {
    stillHolds = await probe(await build(FN.replace(from, to)));
  } catch {
    stillHolds = false;
  }
  check(`MUTATION "${name}" breaks the assertion`, !stillHolds,
    stillHolds ? "the property still held with the rule removed — the assertion above proves nothing" : "");
};

console.log("\nBOUNDS ARE INCLUSIVE, AND NARROWER THAN THE SERIES");
{
  const got = await mod.getDailyBars("T", "2026-02-01", "2026-02-28");
  check("a range returns exactly the days inside it, both ends included",
    got.length === 28 && got[0].date === "2026-02-01" && got[27].date === "2026-02-28",
    `got ${got.length} bars, ${got[0]?.date} .. ${got[got.length - 1]?.date}`);
  check("...and that is fewer than the whole series",
    got.length < BARS.length,
    `${got.length} of ${BARS.length} — the point of the adapter`);

  const one = await mod.getDailyBars("T", "2026-02-10", "2026-02-10");
  check("a single-day range returns that one day",
    one.length === 1 && one[0].date === "2026-02-10",
    `got ${one.length}`);
}

console.log("\nAN EMPTY RANGE IS EMPTY — NEVER THE WHOLE SERIES");
{
  const after = await mod.getDailyBars("T", "2027-01-01", "2027-12-31");
  check("a window past the end of the series returns nothing",
    Array.isArray(after) && after.length === 0,
    `got ${after.length} bars — a fallback to 'everything' here is the failure that passes review`);

  const before = await mod.getDailyBars("T", "2020-01-01", "2020-12-31");
  check("a window before the start returns nothing",
    before.length === 0, `got ${before.length}`);

  const inverted = await mod.getDailyBars("T", "2026-03-01", "2026-01-01");
  check("an inverted range (from after to) returns nothing, not everything",
    inverted.length === 0,
    `got ${inverted.length} — 'from > to' is a caller bug and must not widen the answer`);

  // ── WHAT THE GUARD ACTUALLY BUYS, MEASURED RATHER THAN ASSUMED ───────────
  //
  // The first mutation here removed the guard and probed the INVERTED range,
  // and the property still held — because no date is both >= March and <=
  // January, so the filter already returns nothing. The guard is redundant for
  // that case and the assertion proved nothing.
  //
  // It is NOT redundant for a HALF-EMPTY range. `p.date >= ""` is true of
  // every date, so a missing `from` with a real `to` degrades to "everything
  // up to `to`" — the too-wide failure, silently, from what is almost
  // certainly a caller bug. That is the case worth a guard and worth a
  // mutation.
  const halfEmpty = await mod.getDailyBars("T", "", "2026-02-01");
  check("a half-empty range returns nothing rather than everything up to the end",
    halfEmpty.length === 0,
    `got ${halfEmpty.length} — an empty string compares below every date`);
  // THE ANCHOR IS THE ERASED TEXT, NOT THE SOURCE TEXT. grabFunction strips
  // types and reformats — 4-space indent, `return []` on its own line — so an
  // anchor copied from historyCache.ts never matches and the mutation reports
  // "could not be applied" rather than testing anything.
  await underMutation(
    "empty-bound guard removed",
    "    if (!from || !to || from > to)\n        return [];",
    "",
    async (m) => (await m.getDailyBars("T", "", "2026-02-01")).length === 0
  );

  const blank = await mod.getDailyBars("T", "", "");
  check("a fully missing range returns nothing too",
    blank.length === 0, `got ${blank.length}`);
}

console.log("\nTHE SLICE IS STILL A USABLE SERIES");
{
  const got = await mod.getDailyBars("T", "2026-02-01", "2026-02-28");
  check("bars stay in ascending date order",
    got.every((p, i) => i === 0 || p.date > got[i - 1].date),
    "computeEarningsReactionDetail indexes forward and backward from a found date");
  check("bar objects are untouched, not reshaped",
    got[0].close === 1 && got[0].volume === 1,
    "volume is what the volume-multiple lookback reads; a slice that dropped it would null that silently");
}

console.log("\nIT IS A VIEW OVER getDailyHistory, NOT A SECOND FETCH PATH");
{
  // THE SOURCE, not the behaviour: a parallel fetcher would double the FMP
  // budget and could disagree about whether a symbol qualifies. That cannot be
  // observed from a stub, so it is asserted against the code.
  check("getDailyBars calls getDailyHistory rather than fetching itself",
    /getDailyHistory\(symbol, opts\)/.test(FN) && !/fetch\(/.test(FN),
    "one cache, one in-flight dedupe, one qualification decision");
  check("...and it is attributed, so check-history-readers can see it",
    /opts/.test(FN),
    "an unattributed read reports as 'unattributed' instead of vanishing");
}

console.log("\nTHE PAGE'S WINDOW AND ITS CHART READ THE SAME LIST");
{
  // A SOURCE ASSERTION, because the failure is a DIVERGENCE between two
  // expressions and no single render can show it: the window and the chart
  // would each be internally consistent while covering different reports. The
  // symptom would be the two oldest cards quietly missing drift figures.
  const PAGE = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
  const slices = PAGE.match(/secEvents\.slice\(/g) ?? [];
  // EXACTLY ONE, and it is the definition of barEvents itself. Zero would mean
  // the shared list had been removed; two or more means a reader has gone back
  // to slicing for itself, which is the divergence this exists to stop.
  check("secEvents is sliced exactly once, to define the shared list",
    slices.length === 1 && /const barEvents = secEvents\.slice\(0, REACTION_REPORTS\)/.test(PAGE),
    `${slices.length} secEvents.slice( call(s); barEvents defined: ${/const barEvents = secEvents\.slice\(/.test(PAGE)}`);
  check("the bar window is derived from barEvents",
    /const dates = barEvents\.map\(/.test(PAGE),
    "so widening the chart widens the fetch with it");
  // Through the annual-only filter since #535 COWORK #15: reactionEvents is
  // barEvents itself unless the filer is annual-only.
  check("the chart is derived from barEvents",
    /const reactionEvents = [^;]*annualReactionEvents\(barEvents, cold\.set\) : barEvents;/.test(PAGE) &&
      /reactionEvents\.slice\(\)\.reverse\(\)/.test(PAGE),
    "and copies before reversing — an in-place reverse on a shared array is a latent corruption");
}

console.log("\nA REPORT THE SERIES DOES NOT COVER GETS NO ANSWER");
{
  // THE CNI SHAPE, MEASURED (relay 35498747512): bars begin 2021-09-21 while
  // four reports sit at 2009-07-20, 2009-10-20, 2020-01-28 and 2021-01-26.
  // Unbounded, every one fell through to index 0 and all four rendered the
  // IDENTICAL figures — four different reports, one real bar, four plausible
  // wrong numbers. The repetition was the only tell, and the labels differ.
  const PAGE_SRC = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
  const GAP = Number((PAGE_SRC.match(/REACTION_SESSION_GAP_DAYS = (\d+)/) ?? [])[1]);
  check("the session-gap bound is read from the source", GAP > 0, `got ${GAP}`);

  const react = await lift(
    [
      `const REACTION_SESSION_GAP_DAYS = ${GAP};`,
      grabFunction(PAGE_SRC, "computeEarningsReactionDetail"),
      "export { computeEarningsReactionDetail };",
    ].join("\n")
  );
  const detail = (date, time) =>
    react.computeEarningsReactionDetail({ symbol: "T", date, time }, BARS);
  const allNull = (r) =>
    r.reactionPct === null && r.volumeMultiple === null &&
    r.drift5Pct === null && r.drift20Pct === null;

  // BARS run 2026-01-01..2026-03-31 in this file's fixture.
  const ancient = detail("2009-07-20", "amc");
  check("a report years before the first bar returns nothing",
    allNull(ancient),
    `got ${JSON.stringify(ancient)} — 'amc' is the dangerous timing: baseIdx = idx = 0 exists, so it PRODUCES numbers`);

  const ancient2 = detail("2020-01-28", "amc");
  check("...and a second such report does not return the SAME numbers as the first",
    allNull(ancient2),
    "identical figures on different reports is what the defect looked like in production");

  // THE CASE THE FALLBACK EXISTS FOR still works: a report on a Sunday resolves
  // to the Monday session.
  const weekend = detail("2026-02-14", "bmo"); // 2026-02-14 is a Saturday
  check("a report on a non-trading day still resolves to the next session",
    !allNull(weekend),
    `got react ${weekend.reactionPct?.toFixed?.(2) ?? "—"} — the bound must not break the legitimate case`);

  // THE EDGE OF THE SERIES: the very first bar has no prior close.
  const firstBar = detail(BARS[0].date, "bmo");
  check("a report on the first bar returns nothing — there is no prior close",
    allNull(firstBar),
    "baseIdx would be -1; this is now stated rather than falling out of an undefined lookup");
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
