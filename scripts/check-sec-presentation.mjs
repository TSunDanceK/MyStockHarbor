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

console.log("\n3a. A TYPICAL FIGURE FAR ABOVE THE LATEST ONE IS EXPLAINED, ONCE");
{
  // AVAV's shape: acquisition-year quarters lift the median (+133.3%) while the
  // newest quarter is +5.7%. Oldest first, so the latest is the last row.
  const avav = [
    growthRow(140, 140), growthRow(150, 150), growthRow(133.3, 133.3),
    growthRow(120, 120), growthRow(5.7, 5.7),
  ];
  const tA = mod.trendSummary(viewOf(avav, []));
  check("typical more than 50 points above latest gets the hedged line",
    tA.skewNote === "The typical figure is lifted by a run of unusually large quarters; " +
      "the latest may be the better guide to the current pace.",
    tA.skewNote ?? "null");
  check("...and it gives the reader no instruction",
    !/\b(you|should|consider|buy|sell)\b/i.test(tA.skewNote ?? ""));
  check("the threshold is the briefed 50 points", mod.TREND_SKEW_PP === 50, `got ${mod.TREND_SKEW_PP}`);
  const near = [growthRow(55, 55), growthRow(60, 60), growthRow(65, 65), growthRow(70, 70), growthRow(10, 10)];
  const tN = mod.trendSummary(viewOf(near, []));
  check("a gap of exactly 50 points says nothing", tN.skewNote === null,
    `typical ${tN.lines[0].value}, latest ${tN.lines[0].latest}`);
  const below = [growthRow(2, 2), growthRow(3, 3), growthRow(4, 4), growthRow(200, 200)];
  check("a latest figure far ABOVE typical is not 'lifted by large quarters'",
    mod.trendSummary(viewOf(below, [])).skewNote === null);
  const margins = [marginRow(90), marginRow(91), marginRow(92), marginRow(10)];
  check("a margin (a level) never triggers it",
    mod.trendSummary(viewOf([growthRow(1, 1), growthRow(1, 1), growthRow(1, 1)], margins)).skewNote === null);
  const annual = mod.trendSummary(viewOf(avav, [], { tableBasis: "year", basis: "year" }));
  check("an annual filer's line says years", /unusually large years;/.test(annual.skewNote ?? ""), annual.skewNote ?? "null");
  await underMutation(
    "skew threshold removed",
    "l.value - l.latest > TREND_SKEW_PP",
    "true",
    (m) => m.trendSummary(viewOf(near, [])).skewNote === null
  );
}

console.log("\n3b. A LEGEND FOR A MARKER THAT NEVER APPEARS IS NOT SHOWN");
{
  // ── THE RULE THIS SHARES WITH THE n/m LEGEND ─────────────────────────────
  // check-earnings-render already holds it for the crossing legend: "a
  // standing legend for a marker that never appears is noise on every other
  // page". AAPL has never crossed between profit and loss, so a sentence
  // explaining what the page does when it does is a sentence about nothing —
  // and a reader who takes it as a description goes looking for a grey bar
  // that is not there. The band wording obeys the same rule.
  const CLAUSE = /crosses between profit and loss/;
  check("with no crossing, the note states the bands and stops",
    !CLAUSE.test(mod.toneBandNote(0)) && /±3%/.test(mod.toneBandNote(0)),
    mod.toneBandNote(0));
  check("with a crossing, it explains the grey", CLAUSE.test(mod.toneBandNote(1)));
  await underMutation(
    "crossing clause made unconditional",
    "  if (crossings <= 0) return bands;",
    "",
    (m) => !CLAUSE.test(m.toneBandNote(0))
  );

  // THE COUNT IS THE CALLER'S ONLY WAY IN, and it has to be the count of
  // CROSSINGS rather than of everything excluded — a filer with one missing
  // margin and no crossing must not be told its figures crossed zero.
  // THE SKIP IS IN THE GROWTH ROWS, NOT THE MARGINS. `crossings` is only ever
  // touched inside the growth `line()`, so a fixture whose only hole is a
  // margin leaves nothing for the mutation below to get wrong — it passed
  // either way and proved nothing. A null revenue/EPS row is an ABSENCE: it is
  // skipped, and it is not a crossing.
  const clean = [growthRow(10, 10), growthRow(12, 12), growthRow(8, 8), growthRow(null, null)];
  const cleanMargins = [marginRow(20), marginRow(21), marginRow(19)];
  const tClean = mod.trendSummary(viewOf(clean, cleanMargins));
  check("a skipped period that is NOT a crossing does not count as one",
    tClean.crossings === 0 && !CLAUSE.test(mod.toneBandNote(tClean.crossings)),
    `crossings ${tClean.crossings}; note: ${tClean.exclusionNote}`);
  check("...and the reason it gives is the reason that happened",
    typeof tClean.exclusionNote === "string" && !CLAUSE.test(tClean.exclusionNote) &&
      /not on file/.test(tClean.exclusionNote),
    tClean.exclusionNote ?? "no note");

  const crossed = [
    growthRow(10, 10), growthRow(12, 12), growthRow(8, 8),
    growthRow("swung-to-loss", "swung-to-loss"),
  ];
  const tCrossed = mod.trendSummary(viewOf(crossed, []));
  check("a real crossing IS counted, once per line that saw it",
    tCrossed.crossings === 2,
    `got ${tCrossed.crossings} — revenue and EPS each carry the same crossing`);
  await underMutation(
    "crossings counted as everything skipped",
    "    crossings += values.filter(isCrossing).length;",
    "    crossings += skipped;",
    (m) => m.trendSummary(viewOf(clean, cleanMargins)).crossings === 0
  );
}

console.log("\n4. WORDING IS KEYED TO THE BASIS NOUN, NEVER THE LITERAL 'quarter'");
{
  // THE LABELS CARRY NO PERIOD NOUN since the tiles print "Typical · Latest"
  // (owner review, #522): "Revenue growth", with the noun in the card heading,
  // which reads t.basis. What the summary still words itself — the exclusion
  // note — must follow the basis, so that is what is asserted. A skipped row
  // is included so the note exists.
  const rows = [growthRow(10, 10), growthRow(12, 12), growthRow(8, 8), growthRow(null, null)];
  const annual = mod.trendSummary(viewOf(rows, [], { tableBasis: "year", basis: "year" }));
  check("an annual filer's summary says year, not quarter",
    /year/.test(annual.exclusionNote ?? "") && !/quarter/.test(annual.exclusionNote ?? "") &&
      annual.lines.every((l) => !/quarter|year/.test(l.label)),
    `${annual.exclusionNote} | ${annual.lines.map((l) => l.label).join(" · ")}`);
  const quarterly = mod.trendSummary(viewOf(rows, []));
  check("...and a quarterly filer's says quarter",
    /quarter/.test(quarterly.exclusionNote ?? ""),
    quarterly.exclusionNote);
  check("the summary reports the basis it used",
    annual.basis === "year" && quarterly.basis === "quarter",
    "the chart heading reads this rather than assuming");
  await underMutation(
    "basis noun replaced by a literal",
    "  const w = periodWords(view.tableBasis);",
    '  const w = { one: "quarter", many: "quarters", labelled: "", adjective: "quarterly" };',
    (m) => /year/.test(m.trendSummary(viewOf(rows, [], { tableBasis: "year", basis: "year" })).exclusionNote ?? "")
  );
}

console.log("\n4b. A MARKET CAP IS A CLAIM ABOUT TODAY, SO THE PRICE MUST BE");
{
  // ── THE DEFECT THIS EXISTS FOR, MEASURED ON THE PREVIEW ──────────────────
  // RYAAY's card valued the company at 50.40 as of 2025-05-15 against a live
  // 53.51, and CNI at 106.22 as of 2026-03-16 against 118.95 — sixteen and six
  // months stale. The price was the last bar of the REACTION CHART'S window,
  // which is sized around report dates and so stops months short of today for
  // any filer that has not reported recently. ABEV passed only because its
  // report cycle happens to be current, which is why one symbol looking right
  // proved nothing about the others.
  //
  // TWO SEPARATE THINGS ARE HELD HERE: the page reads the WHOLE SERIES for
  // this figure (asserted against the source, because no fixture can show
  // which of two fetches a value came from), and a close past the bound is
  // refused rather than used (asserted against the rule).
  const TODAY = "2026-09-21";
  check("a close from today is current", mod.priceIsCurrent(TODAY, TODAY));
  check("a long weekend either side of a holiday is still current",
    mod.priceIsCurrent("2026-09-13", TODAY),
    `8 days, inside the ${mod.VALUATION_PRICE_MAX_AGE_DAYS}-day bound`);
  check("RYAAY's sixteen-month-old close is NOT current",
    !mod.priceIsCurrent("2025-05-15", TODAY),
    "the exact value the preview priced the company with");
  check("CNI's six-month-old close is NOT current",
    !mod.priceIsCurrent("2026-03-16", TODAY));
  check("a missing date is not current either",
    !mod.priceIsCurrent(null, TODAY),
    "no date is not the same as no staleness");
  check("a close dated AFTER today is refused, not treated as fresh",
    !mod.priceIsCurrent("2026-09-22", TODAY),
    "the series and the clock disagreeing is not a reason to be generous");
  await underMutation(
    "staleness bound removed",
    "  return (t - a) / 86400000 <= VALUATION_PRICE_MAX_AGE_DAYS;",
    "  return true;",
    (m) => !m.priceIsCurrent("2025-05-15", TODAY)
  );
  await underMutation(
    "future dates allowed through",
    "  if (a > t) return false;",
    "",
    (m) => !m.priceIsCurrent("2026-09-22", TODAY)
  );

  // THE SOURCE OF THE PRICE, ASSERTED AGAINST THE PAGE. The bound above cannot
  // catch a regression here: a price taken from the bounded window is a real
  // close on a real date, and on a filer that reported last week it is even
  // the RIGHT one. The defect only appears on filers that have not reported
  // recently, so what has to hold is which list the value is read from.
  const PAGE = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
  check("the valuation price is the last bar of the WHOLE series",
    /const lastBar = \(latestBars as Point\[\]\)\.at\(-1\)/.test(PAGE),
    "not dailyHistory, which is the reaction chart's bounded window");
  check("...and that series is fetched alongside the bounded one, not instead of it",
    /caller: "stock-earnings-valuation"/.test(PAGE) && /getDailyBars\(symbol, barWindow\.from/.test(PAGE),
    "the reaction chart still wants the bound; only this figure does not");
  check("the render date is read once on the server, not inside a card",
    /renderedOn: new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(PAGE) &&
      /today=\{data\.renderedOn\}/.test(PAGE),
    "a card calling the clock itself is untestable and can differ from its own server render");
}

console.log("\n4c. A SCORE THAT COULD NOT HAVE SAID ANYTHING ELSE SAYS SO");
{
  // ── THE ABVX SHAPE, MEASURED ─────────────────────────────────────────────
  // 48/100 with a MIXED pill and a needle, laid out exactly like AAPL's, while
  // revenue growth, EPS growth and margin direction never ran. Those three
  // carry 52 of the 58 points the score can move by, so the arithmetic could
  // only land between 34 and 66 — and the MIXED band is 40 to 65. ABVX could
  // not have read Weak or Good FOR ANY COMPANY. That is a fact about the
  // page's blindness and the card presented it as a reading.
  const MAXIMA = { revenueGrowth: 22, epsGrowth: 20, profitability: 8, marginTrend: 10, cashConversion: 10 };
  const BAND_LOW = 40, BAND_HIGH = 65;

  const abvx = mod.pinCoverage(
    mod.scoreCoverage(50, MAXIMA, 3, ["profitability", "cashConversion"]),
    BAND_LOW, BAND_HIGH
  );
  check("2 of 5 measured is reported as partial",
    abvx.partial && abvx.measured === 2 && abvx.total === 5,
    `measured ${abvx.measured} of ${abvx.total}`);
  check("...and the reachable range is the sum of what ran, either side of the seed",
    abvx.low === 32 && abvx.high === 68,
    `${abvx.low}..${abvx.high} — profitability 8 + cash 10 = 18 around a seed of 50`);
  // THE CORRECTION THAT MATTERS, and it is against my own earlier reading.
  // "ABVX could not have read Weak or Good" was WRONG: 32 is below the Weak
  // boundary and 68 is above the Good one, so both verdicts were reachable in
  // principle. What is true is narrower and still worth saying — 2 of 5 inputs
  // and a reachable span of 36 points on a 100-point scale, compressed hard
  // toward the seed. `pinned` is reserved for the case where the range really
  // cannot leave one band, and it must NOT fire merely because coverage is
  // thin, or it would be the same overclaim in the opposite direction.
  check("a partial score whose range still straddles a boundary is NOT pinned",
    abvx.pinned === false,
    `32..68 crosses both ${BAND_LOW} and ${BAND_HIGH} — thin coverage alone is not a pinned verdict`);

  // THE PINNED CASE, which is the one worth a sentence on the card.
  const pinned = mod.pinCoverage(
    mod.scoreCoverage(50, MAXIMA, 4, ["profitability"]), BAND_LOW, BAND_HIGH
  );
  check("a score whose whole range sits in one band is pinned",
    pinned.pinned && pinned.low === 42 && pinned.high === 58,
    `${pinned.low}..${pinned.high} inside ${BAND_LOW}..${BAND_HIGH}`);
  // THE PINNED CONSEQUENCE, IN ONE LINE. The note names each missing input
  // with its cause and, when pinned, the band it could not leave.
  const pinnedNote = mod.partialScoreNote(pinned, [{ name: "Revenue growth", reason: "no year-earlier quarter on file" }], "Mixed");
  check("...and its note says the score could not leave that band",
    /between 42 and 58, inside Mixed either way/.test(pinnedNote) &&
      /Revenue growth — no year-earlier quarter on file/.test(pinnedNote),
    pinnedNote);

  // A FULLY MEASURED SCORE IS UNTOUCHED — the whole point is that this changes
  // nothing for AAPL.
  const full = mod.pinCoverage(
    mod.scoreCoverage(50, MAXIMA, 0, Object.keys(MAXIMA)), BAND_LOW, BAND_HIGH
  );
  check("a fully measured score is not partial and not pinned",
    !full.partial && !full.pinned && full.measured === 5,
    `measured ${full.measured}, reach ${full.low}..${full.high}`);
  check("...and its reachable range is clamped to the scale, not 50 +/- 70",
    full.low === 0 && full.high === 100,
    `${full.low}..${full.high} — 50 +/- 70 would render off the bar`);

  await underMutation(
    "partial flag ignores the unmeasured count",
    "  return { measured, total, low, high, partial: unavailableCount > 0, pinned: false };",
    "  return { measured, total, low, high, partial: false, pinned: false };",
    (m) => m.pinCoverage(m.scoreCoverage(50, MAXIMA, 3, ["profitability", "cashConversion"]), BAND_LOW, BAND_HIGH).partial
  );
  await underMutation(
    "reach computed from ALL components rather than the ones that ran",
    "  const reach = ranKeys.reduce((a, k) => a + (maxima[k] ?? 0), 0);",
    "  const reach = Object.values(maxima).reduce((a, b) => a + b, 0);",
    (m) => {
      const c = m.scoreCoverage(50, MAXIMA, 3, ["profitability", "cashConversion"]);
      return c.low === 32 && c.high === 68;
    }
  );
  await underMutation(
    "pinned decided without the band bounds",
    "  return { ...c, pinned: c.partial && c.low >= bandLow && c.high <= bandHigh };",
    "  return { ...c, pinned: c.partial };",
    (m) => !m.pinCoverage(m.scoreCoverage(50, MAXIMA, 3, ["profitability", "cashConversion"]), BAND_LOW, BAND_HIGH).pinned
  );

  // THE PILL NEVER SHOWS A BARE VERDICT ON A PARTIAL SCORE.
  check("the partial pill counts what was measured instead of naming a band",
    mod.partialScoreLabel(abvx) === "Partial · 2 of 5 measured" &&
      !/Mixed|Good|Weak/.test(mod.partialScoreLabel(abvx)),
    mod.partialScoreLabel(abvx));
  check("the note states a narrowed range and the non-comparability",
    /between 32 and 68\./.test(mod.partialScoreNote(abvx, [])) &&
      /Not directly comparable with a full score/.test(mod.partialScoreNote(abvx, [])),
    mod.partialScoreNote(abvx, []));
  // ── A RANGE AS WIDE AS THE SCALE IS NOT PRINTED (brief A1) ──────────────
  // AVAV ran four inputs reaching ±50 around the seed, and the card said the
  // score "could only have landed between 0 and 100" — true of every score.
  const avav = mod.pinCoverage(
    mod.scoreCoverage(50, MAXIMA, 1, ["revenueGrowth", "profitability", "marginTrend", "cashConversion"]), BAND_LOW, BAND_HIGH
  );
  const avavNote = mod.partialScoreNote(avav, [{ name: "EPS growth", reason: "loss in both quarters" }]);
  check("a reach spanning the whole scale prints no range, and draws none",
    avav.low === 0 && avav.high === 100 && !/between/.test(avavNote) && !mod.coverageIsInformative(avav) &&
      mod.coverageIsInformative(abvx),
    avavNote);
  await underMutation(
    "the range sentence printed whatever its width",
    "  const informative = c.low > 0 || c.high < 100;",
    "  const informative = true;",
    (m) => !/between/.test(m.partialScoreNote(m.pinCoverage(m.scoreCoverage(50, MAXIMA, 1, ["revenueGrowth", "profitability", "marginTrend", "cashConversion"]), BAND_LOW, BAND_HIGH), []))
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

  // ── A NULL LINE IS OMITTED, NOT DRAWN AT ZERO ────────────────────────────
  //
  // This check used to require a REFUSAL here, and that requirement was
  // measured to be wrong: all six committed fixtures failed the gate, every
  // one of them on a missing line rather than a failed subtraction, so the
  // waterfall drew for nobody. AAPL files no OtherOperatingExpense and its
  // remaining lines reach filed operating income to within 0.03%.
  //
  // The hazard was only ever the ZERO-LENGTH STEP — a flat "R&D" bar claiming
  // the company spends nothing. Omitting the step makes no claim at all, and
  // incomeStatementComplete has already established that what remains sums.
  const holed = lines.map((c) => (c.key === "researchAndDevelopment" ? { ...c, val: null } : c));
  // The 100 that R&D carried has to go somewhere or the chart would not sum,
  // so operating income moves with it — this fixture is a filer that reports
  // no R&D line at all, not one whose R&D vanished from a reconciling set.
  const holedTotal = holed.map((c) => (c.key === "operatingIncome" ? { ...c, val: 200 } : c));
  const gap = mod.waterfallGate(viewOf([], [], { incomeStatement: holedTotal, incomeStatementComplete: true }));
  check("a missing expense line is left out of the chart, not drawn at zero",
    gap.ok === true && !gap.steps.some((st) => st.key === "researchAndDevelopment"),
    gap.ok ? gap.steps.map((st) => st.key).join(" ") : `refused: ${gap.why}`);
  check("...and no step has zero length, whatever the reason it is absent",
    gap.ok && gap.steps.every((st) => st.delta !== 0),
    "a bar of no length is a label with nothing behind it");
  await underMutation(
    "absent lines drawn as zero steps",
    "    if (v === null || v === 0) continue;",
    "    const drawn = v ?? 0;\n    steps.push({ key: p.key, label: p.label, delta: -drawn });\n    continue;",
    (m) => {
      const g = m.waterfallGate(viewOf([], [], { incomeStatement: holedTotal, incomeStatementComplete: true }));
      return g.ok && !g.steps.some((st) => st.key === "researchAndDevelopment");
    }
  );

  // ── THE CHART ADDS UP ITS OWN BARS ───────────────────────────────────────
  //
  // incomeStatementComplete measures GROSS PROFIT minus opex; this chart runs
  // from REVENUE through cost of revenue. A filer whose filed gross profit is
  // not revenue minus cost of revenue passes the flag and would still draw
  // bars that visibly miss the total. `holed` above is exactly that shape —
  // flag hand-set to true, R&D's 100 unaccounted for — and it must refuse.
  const unsummed = mod.waterfallGate(viewOf([], [], { incomeStatement: holed, incomeStatementComplete: true }));
  check("steps that do not reach the filed total refuse, flag or no flag",
    unsummed.ok === false,
    unsummed.ok
      ? `drew ${unsummed.steps.reduce((a, st) => a + st.delta, 0)} against a filed ${unsummed.total}`
      : unsummed.why);
  await underMutation(
    "the chart's own sum check removed",
    "  if (Math.abs(drawn - operating) > Math.max(Math.abs(operating), 1) * (WATERFALL_TOLERANCE_PCT / 100)) {",
    "  if (false) {",
    (m) => m.waterfallGate(viewOf([], [], { incomeStatement: holed, incomeStatementComplete: true })).ok === false
  );
  check("the declared tolerance is the one enforced",
    /WATERFALL_TOLERANCE_PCT \/ 100/.test(SRC),
    "a constant nothing reads is a tolerance nobody is held to");

  // A FILED ZERO IS OMITTED FOR THE SAME REASON — it has no length either.
  // The omitted 50 moves into operating income, so the chart still reaches its
  // total — otherwise the sum check refuses first and this proves nothing.
  const zeroed = lines.map((c) =>
    c.key === "otherOperatingExpense" ? { ...c, val: 0 }
      : c.key === "operatingIncome" ? { ...c, val: 150 } : c);
  const zg = mod.waterfallGate(viewOf([], [], { incomeStatement: zeroed, incomeStatementComplete: true }));
  check("a filed zero is omitted too, rather than drawn as a flat bar",
    zg.ok === true && !zg.steps.some((st) => st.key === "otherOperatingExpense"),
    zg.ok ? zg.steps.map((st) => st.key).join(" ") : `refused: ${zg.why}`);

  // NOTHING LEFT TO BREAK DOWN IS NOT A WATERFALL.
  // OPERATING INCOME EQUAL TO REVENUE, deliberately: without the floor this
  // fixture draws one step that sums perfectly, so the floor is the ONLY rule
  // that can refuse it. With a smaller total the sum check would refuse too
  // and the mutation below would pass for the wrong reason.
  const bare = lines
    .filter((c) => c.key === "revenue" || c.key === "operatingIncome")
    .map((c) => (c.key === "operatingIncome" ? { ...c, val: 1000 } : c));
  const bg = mod.waterfallGate(viewOf([], [], { incomeStatement: bare, incomeStatementComplete: true }));
  check("revenue with no expense line at all refuses — two bars break nothing down",
    bg.ok === false && bg.why === "missing-lines",
    bg.ok ? `drew ${bg.steps.length} steps` : bg.why);
  await underMutation(
    "one-expense-step floor removed",
    "  if (steps.length < 2) return { ok: false, why: \"missing-lines\" };",
    "",
    (m) => m.waterfallGate(viewOf([], [], { incomeStatement: bare, incomeStatementComplete: true })).ok === false
  );
  check("the gate reads the SAME flag the card's wording turns on",
    /view\.incomeStatementComplete/.test(SRC),
    "a second reconciliation test here would disagree with the card the first time either tolerance moved");
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
