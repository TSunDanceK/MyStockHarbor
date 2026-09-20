// COLOUR, BARS AND THE TREND SUMMARY — the decisions, each run under a
// mutation that breaks it.
//
// Every assertion here is about a claim the page makes VISUALLY. A green chip
// says "this is good"; a bar of length zero says "no change"; a median across
// eight periods says "this is what a typical one looks like". Each of those can
// be wrong while looking entirely normal, which is the only reason a
// presentation module is worth checking at all.
//
// THE ADDENDUM RULES ARE THE POINT OF THIS FILE:
//   - n/m colours grey and draws NO BAR — not a zero bar
//   - chart wording is keyed to the basis noun, never the literal "quarter"
//   - the trend summary NEVER averages across an n/m
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const SRC = strip("lib/server/secPresentation.ts");
const PRELUDE = [
  readCodeOnly("lib/server/secFields.ts"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  strip("lib/server/secFactCodec.ts"),
  strip("lib/server/secEarningsView.ts"),
].join("\n");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const build = (src = SRC) => lift([PRELUDE, src].join("\n"), "", "secPresentation");
const mod = await build();

const underMutation = async (name, from, to, probe) => {
  if (!SRC.includes(from)) {
    check(`mutation "${name}" could not be applied`, false, `source no longer contains: ${from.slice(0, 70)}`);
    return;
  }
  let stillHolds;
  try {
    stillHolds = await probe(await build(SRC.replace(from, to)));
  } catch {
    stillHolds = false;
  }
  check(`MUTATION "${name}" breaks the assertion`, !stillHolds,
    stillHolds ? "the property still held with the rule removed — the assertion above proves nothing" : "");
};

const CROSSINGS = ["turned-profitable", "swung-to-loss", "loss-both"];

console.log("\n1. THE BANDS ARE READ FROM THE SOURCE, NOT RESTATED HERE");
{
  check("growth band is the briefed ±3%", mod.GROWTH_BAND_PCT === 3, `got ${mod.GROWTH_BAND_PCT}`);
  check("margin band is the briefed ±0.5 POINTS", mod.MARGIN_BAND_PP === 0.5, `got ${mod.MARGIN_BAND_PP}`);
  check("a growth figure inside the band is neutral, not green",
    mod.toneForGrowth(2.9) === "neutral" && mod.toneForGrowth(-2.9) === "neutral",
    "below the band the direction is inside a filer's own comparability noise");
  check("...and at the band it is called",
    mod.toneForGrowth(3) === "good" && mod.toneForGrowth(-3) === "weak");
  check("a margin move is judged in POINTS, not percent of a percent",
    mod.toneForMarginDelta(0.5) === "good" && mod.toneForMarginDelta(0.4) === "neutral",
    "10% -> 10.4% is 0.4 points and 4 percent; the second is four times more dramatic for no reason");
}

console.log("\n2. n/m IS GREY AND HAS NO BAR — NOT A ZERO BAR");
{
  for (const c of CROSSINGS) {
    check(`"${c}" makes no colour claim`, mod.toneForGrowth(c) === null);
    check(`"${c}" draws no bar at all`, mod.barValue(c) === null,
      "a zero-height bar sits on the axis and reads as 'no change', which is a claim, and the wrong one");
  }
  check("an absent figure is treated the same way",
    mod.toneForGrowth(null) === null && mod.barValue(null) === null);
  check("a real zero DOES draw a bar",
    mod.barValue(0) === 0 && mod.toneForGrowth(0) === "neutral",
    "0% growth is a measurement; n/m is the absence of one — they must not render alike");
  await underMutation(
    "n/m coerced to a number for the bar",
    "export function barValue(v: Pct): number | null {\n  return isPct(v) ? v : null;\n}",
    "export function barValue(v: Pct): number | null {\n  return isPct(v) ? v : 0;\n}",
    (m) => CROSSINGS.every((c) => m.barValue(c) === null)
  );
  await underMutation(
    "n/m given a tone",
    "  if (!isPct(v)) return null;",
    "  if (!isPct(v)) return \"neutral\";",
    (m) => CROSSINGS.every((c) => m.toneForGrowth(c) === null)
  );
}

// ── a view fixture, shaped like the real one ──────────────────────────────
const growthRow = (r, e) => ({ revenueYoY: r, epsYoY: e });
const marginRow = (op) => ({ label: "x", gapAfter: false, gross: null, operating: op, net: null });
const viewOf = (growth, margins, over = {}) => ({
  tableBasis: "quarter", basis: "quarter",
  growth, margins,
  incomeStatement: [], incomeStatementComplete: false,
  ...over,
});

console.log("\n3. THE TREND SUMMARY NEVER AVERAGES ACROSS AN n/m");
{
  // Eight periods: six real, two crossings. A mean over all eight is impossible
  // without inventing values for the crossings; the median must use six.
  const growth = [
    growthRow(10, 10), growthRow(12, 12), growthRow(8, 8),
    growthRow("turned-profitable", "turned-profitable"),
    growthRow(11, 11), growthRow(9, 9),
    growthRow("swung-to-loss", "swung-to-loss"),
    growthRow(10, 10),
  ];
  const t = mod.trendSummary(viewOf(growth, [marginRow(20), marginRow(21), marginRow(19)]));
  const rev = t.lines.find((l) => l.label.startsWith("Revenue"));
  check("the two crossings are excluded and COUNTED, not folded in",
    rev.counted === 6 && rev.skipped === 2,
    `counted ${rev.counted}, skipped ${rev.skipped} of ${growth.length}`);
  check("the figure is the median of the six that are figures",
    rev.value === 10, `got ${rev.value} — median of 8,9,10,10,11,12`);
  check("the card is told what was left out, in words",
    typeof t.exclusionNote === "string" && /crosses between profit and/.test(t.exclusionNote),
    "'5 of 8' with no reason invites the reader to assume a data gap");
  await underMutation(
    "crossings folded into the aggregate",
    "    const nums = values.filter(isPct) as number[];",
    "    const nums = values.map((v) => (isPct(v) ? v : 0)) as number[];",
    (m) => {
      const r = m.trendSummary(viewOf(growth, [])).lines.find((l) => l.label.startsWith("Revenue"));
      return r.counted === 6 && r.value === 10;
    }
  );

  // A RUN THAT IS MOSTLY n/m IS NOT A TREND.
  const thin = [growthRow(10, 10), growthRow("loss-both", "loss-both"), growthRow("loss-both", "loss-both")];
  const tThin = mod.trendSummary(viewOf(thin, []));
  const revThin = tThin.lines.find((l) => l.label.startsWith("Revenue"));
  check("fewer than the minimum real periods REFUSES rather than summarising two",
    revThin.value === null && revThin.tone === null,
    `${revThin.counted} real of ${thin.length}; minimum is ${mod.TREND_MIN_PERIODS}`);
  await underMutation(
    "minimum-periods floor removed",
    "    if (nums.length < TREND_MIN_PERIODS) {",
    "    if (false) {",
    (m) => m.trendSummary(viewOf(thin, [])).lines.find((l) => l.label.startsWith("Revenue")).value === null
  );

  // THE MEDIAN, NOT THE MEAN — one outlier must not become the trend.
  const skewed = [growthRow(2, 2), growthRow(3, 3), growthRow(4, 4), growthRow(400, 400)];
  const tS = mod.trendSummary(viewOf(skewed, []));
  const revS = tS.lines.find((l) => l.label.startsWith("Revenue"));
  check("one COVID-shaped period does not become the trend",
    revS.value === 3.5,
    `median 3.5 vs mean ${(409 / 4).toFixed(1)} — a mean would report the outlier as typical`);
  await underMutation(
    "median replaced by the mean",
    "  const s = [...xs].sort((a, b) => a - b);\n  const mid = s.length >> 1;\n  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;",
    "  return xs.reduce((a, b) => a + b, 0) / xs.length;",
    (m) => m.trendSummary(viewOf(skewed, [])).lines.find((l) => l.label.startsWith("Revenue")).value === 3.5
  );
}

console.log("\n4. WORDING IS KEYED TO THE BASIS NOUN, NEVER THE LITERAL 'quarter'");
{
  const annual = mod.trendSummary(viewOf(
    [growthRow(10, 10), growthRow(12, 12), growthRow(8, 8)],
    [], { tableBasis: "year", basis: "year" }
  ));
  check("an annual filer's summary says year, not quarter",
    annual.lines.every((l) => /year/.test(l.label) && !/quarter/.test(l.label)),
    annual.lines.map((l) => l.label).join(" · "));
  const quarterly = mod.trendSummary(viewOf(
    [growthRow(10, 10), growthRow(12, 12), growthRow(8, 8)], []
  ));
  check("...and a quarterly filer's says quarter",
    quarterly.lines.every((l) => /quarter/.test(l.label)),
    quarterly.lines.map((l) => l.label).join(" · "));
  check("the summary reports the basis it used",
    annual.basis === "year" && quarterly.basis === "quarter",
    "the chart heading reads this rather than assuming");
  await underMutation(
    "basis noun replaced by a literal",
    "  const w = periodWords(view.tableBasis);",
    '  const w = { one: "quarter", many: "quarters", labelled: "", adjective: "quarterly" };',
    (m) => m.trendSummary(viewOf([growthRow(10, 10), growthRow(12, 12), growthRow(8, 8)], [],
      { tableBasis: "year", basis: "year" })).lines.every((l) => /year/.test(l.label))
  );
}

console.log("\n5. THE WATERFALL IS DRAWN ONLY WHERE IT ADDS UP");
{
  const cell = (key, label, val) => ({ key, label, val, derived: null, derivedNote: null, perShare: false, tag: null, ns: null });
  const lines = [
    cell("revenue", "Revenue", 1000),
    cell("costOfRevenue", "Cost of revenue", 600),
    cell("researchAndDevelopment", "R&D", 100),
    cell("sellingGeneralAndAdministrative", "SG&A", 150),
    cell("otherOperatingExpense", "Other operating", 50),
    cell("operatingIncome", "Operating income (EBIT)", 100),
  ];
  const ok = mod.waterfallGate(viewOf([], [], { incomeStatement: lines, incomeStatementComplete: true }));
  check("a reconciling period yields steps that sum to the filed total",
    ok.ok === true && Math.abs(ok.steps.reduce((a, s) => a + s.delta, 0) - ok.total) < 1e-9,
    ok.ok ? `steps sum ${ok.steps.reduce((a, s) => a + s.delta, 0)} === filed ${ok.total}` : `refused: ${ok.why}`);
  check("...and revenue is the only positive step",
    ok.ok && ok.steps.filter((s) => s.delta > 0).length === 1 && ok.steps[0].key === "revenue");

  // THE ARM / MU CASE.
  const partial = mod.waterfallGate(viewOf([], [], { incomeStatement: lines, incomeStatementComplete: false }));
  check("a NON-reconciling period refuses the chart entirely",
    partial.ok === false && partial.why === "incomplete-breakdown",
    "measured to miss by 1–7% on 5 of 32 probe quarters; the table says 'partial' instead");
  await underMutation(
    "reconciliation gate removed (draw the waterfall anyway)",
    "  if (!view.incomeStatementComplete) return { ok: false, why: \"incomplete-breakdown\" };",
    "",
    (m) => m.waterfallGate(viewOf([], [], { incomeStatement: lines, incomeStatementComplete: false })).ok === false
  );

  // A NULL LINE IS NOT A ZERO EXPENSE.
  const holed = lines.map((c) => (c.key === "researchAndDevelopment" ? { ...c, val: null } : c));
  const gap = mod.waterfallGate(viewOf([], [], { incomeStatement: holed, incomeStatementComplete: true }));
  check("a missing expense line refuses rather than drawing a zero-length step",
    gap.ok === false && gap.why === "missing-lines",
    "a zero R&D step reads as 'this company spends nothing on R&D'");
  check("the gate reads the SAME flag the card's wording turns on",
    /view\.incomeStatementComplete/.test(SRC),
    "a second reconciliation test here would disagree with the card the first time either tolerance moved");
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
