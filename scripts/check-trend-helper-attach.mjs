// The Trend Helper line on the daily trend-flip cards, and the one way it can
// be silently wrong.
//
// WHAT IS DRAWN. Those cards colour an HMA(55) segment-by-segment from the
// CONFIRMED trend state, so the bar where the colour changes is a factual claim:
// it must be the flip date printed in the row beside it.
//
// WHY IT IS COMPUTED SERVER-SIDE. HMA(55) is first non-null at index 60, and the
// card ships 72 bars while showing the last 64. A client recomputation would
// paint 12 of 64 candles and leave 52 blank -- and worse, computeTrendHelper
// carries confirmed state forward from the start of history, so a 72-bar window
// starts at state 0 and can confirm the OPPOSITE direction to the one the page
// screened on. Both are asserted below, because they are the reasons the whole
// design is the shape it is.
//
// THE FAILURE THIS EXISTS FOR. The trend series and the chart points come from
// different arrays -- one is every closed bar, the other is bars with a finite
// close sliced to the last 72 -- so they DO NOT SHARE INDICES. Joining by index
// draws a line whose colour changes a bar or two off the flip date. Nothing
// throws; the chart just quietly disagrees with the text next to it. The
// misalignment is constructed deliberately here rather than hoped for.
//
//   node scripts/check-trend-helper-attach.mjs
//
// Runs the REAL lib/ta/trendHelper.ts, not a copy of its logic.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "lib/ta/trendHelper.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const js = ts.transpileModule(fs.readFileSync(SRC, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;

const {
  computeTrendHelper,
  attachTrendHelper,
  trendTailForPoints,
  hmaSeries,
  latestTrendFlip,
  TREND_HELPER_SLOW,
} = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const { trendLen, confirmBars } = TREND_HELPER_SLOW;

// A series that falls for a long stretch and then turns up hard, so the Slow
// preset has a real, unambiguous flip well after its warm-up.
const N = 220;
const closes = [];
for (let i = 0; i < N; i++) {
  closes.push(i < 150 ? 300 - i * 1.1 : 300 - 150 * 1.1 + (i - 150) * 3.2);
}
const dates = Array.from({ length: N }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000);
  return d.toISOString().slice(0, 10);
});

console.log("\n=== 1. Why this is not computed on the client ===\n");

const warm = hmaSeries(closes, trendLen);
const firstNonNull = warm.findIndex((v) => typeof v === "number" && Number.isFinite(v));
check(
  "HMA(55) is first non-null at index 60",
  firstNonNull === 60,
  `a 72-bar payload leaves only ${72 - firstNonNull} usable bars of the 64 the card shows — found ${firstNonNull}`
);

const windowSeries = computeTrendHelper(closes.slice(-72), trendLen, confirmBars);
const fullSeries = computeTrendHelper(closes, trendLen, confirmBars);
check(
  "a 72-bar window disagrees with the full history on the newest bar's state",
  windowSeries.state[windowSeries.state.length - 1] !== fullSeries.state[fullSeries.state.length - 1] ||
    windowSeries.state.filter((s) => s === 0).length > fullSeries.state.slice(-72).filter((s) => s === 0).length,
  "confirmed state is carried forward from the start of history, so a windowed recomputation is not the same signal"
);

console.log("\n=== 2. The join survives a genuine index misalignment ===\n");

// The real shapes: the trend series covers every closed bar; chartPoints drop a
// bar with a non-finite close and keep only the last 72. Their indices differ by
// a different amount at every position, which is the whole point.
const trend = {
  dates,
  line: fullSeries.line,
  state: fullSeries.state,
};

const cleanIdx = [];
for (let i = 0; i < N; i++) {
  if (i === 40 || i === 165) continue; // dropped upstream for a non-finite close
  cleanIdx.push(i);
}
const chartPoints = cleanIdx.slice(-72).map((i) => ({ date: dates[i], close: closes[i] }));

check(
  "the two arrays really are misaligned (otherwise this proves nothing)",
  dates.indexOf(chartPoints[0].date) !== 0 &&
    dates.indexOf(chartPoints[10].date) !== 10,
  "an index join would happen to work on aligned inputs, so the test data has to be unaligned"
);

const attached = attachTrendHelper(chartPoints, trend);

check(
  "every attached point carries the value for ITS OWN date",
  attached.every((p) => {
    if (typeof p.trendLine !== "number") return true;
    const i = dates.indexOf(p.date);
    return Math.abs(trend.line[i] - p.trendLine) < 0.01;
  }),
  "this is the assertion an index join fails"
);

const flip = latestTrendFlip(closes, trendLen, confirmBars);
const flipDate = dates[flip.flipIndex];
const atFlip = attached.find((p) => p.date === flipDate);
const flipPos = attached.findIndex((p) => p.date === flipDate);

check("the flip is inside the attached window", Boolean(atFlip), `flip on ${flipDate}`);
check(
  "trendState at the flip date equals the flip direction",
  atFlip?.trendState === flip.direction,
  `the coloured bar IS the claim the row's text makes — direction ${flip.direction}, state ${atFlip?.trendState}`
);
check(
  "the bar before the flip has a different state",
  flipPos > 0 && attached[flipPos - 1].trendState !== atFlip?.trendState,
  `if these matched, the colour change would not be visible at the flip — ${attached[flipPos - 1]?.trendState} then ${atFlip?.trendState}`
);

console.log("\n=== 3. Bounds and absence ===\n");

check(
  "only the last 64 points are enriched",
  attached.slice(0, attached.length - 64).every((p) => p.trendLine === undefined) &&
    attached.slice(-64).some((p) => typeof p.trendLine === "number"),
  "the card's visible window is 64 bars, so earlier points would be bytes nobody renders"
);
check(
  "a point with no matching date is left untouched",
  attachTrendHelper([{ date: "1999-01-01", close: 1 }], trend)[0].trendLine === undefined,
  "absent data must mean no line rather than a line drawn from the wrong bar"
);
check(
  "a null line value is skipped rather than written as null",
  attachTrendHelper([{ date: dates[0], close: closes[0] }], trend)[0].trendLine === undefined,
  `index 0 is inside HMA warm-up, so its line is null — writing it through would render a break at value 0`
);
check(
  "state is normalised to -1 | 0 | 1",
  attached.every((p) => p.trendState === undefined || [-1, 0, 1].includes(p.trendState)),
  "the chart switches colour on the sign, so an out-of-range value would fall through to grey"
);

console.log("\n=== 4. Routing, and what must NOT have moved ===\n");

// Source-level, said plainly: chartOverlayForEntry lives in a React component
// that cannot be imported from node without pulling React and the whole picker
// tree in. What is checked is the decision's shape, not its execution.
const grid = fs.readFileSync(path.join(process.cwd(), "app/components/PickerResultsGrid.tsx"), "utf8");
const mini = fs.readFileSync(path.join(process.cwd(), "app/components/MiniPickerCandleChart.tsx"), "utf8");

const flipBranch = grid.indexOf('href.includes("trend-flip")');
const bestTrendBranch = grid.indexOf('href.includes("best-trend")');

// HIDDEN, NOT DELETED (2026-10-07, #553 COWORK #186 ruling 6): the weekly
// pages were excluded (`&& !href.includes("weekly")`) while their cards drew
// daily candles. They now draw weekly candles with the weekly line, and the
// "never the daily line on a weekly row" rule moved to section 5.
check(
  "every trend-flip page, daily and weekly, routes to trendHelper",
  /if \(href\.includes\("trend-flip"\)\) return "trendHelper" as const;/.test(grid),
  "without a branch these pages fall through to bare candles, which is what they showed before"
);
check(
  "the trend-flip branch precedes the best-trend branch",
  flipBranch !== -1 && bestTrendBranch !== -1 && flipBranch < bestTrendBranch,
  "ordering matters only against this one branch, and only in this direction"
);
check(
  "/best-trend-score-stocks still routes to the untouched 'trend' overlay",
  /href\.includes\("best-trend"\)\) return "trend" as const;/.test(grid),
  "that overlay is MA50 + MA200 and belongs to a different page — renaming or reusing it would change that page"
);
check(
  "the 'trend' overlay still draws BOTH moving averages",
  /overlay === "trend"[\s\S]{0,200}ma50Values[\s\S]{0,200}ma200Values/.test(mini),
  "this is the page that must look identical after the change"
);
check(
  "trendHelper is a separate overlay value, not a reuse of 'trend'",
  /\| "trendHelper"/.test(mini) && /\| "trend"/.test(mini),
  "sharing one name would make the two pages impossible to route apart"
);
check(
  "the chart has no client-side trend fallback",
  !/hmaSeries|computeTrendHelper/.test(mini),
  "a recomputation from 72 bars would be blank for most of the window and mis-coloured for the rest"
);
check(
  "colours come from the shared constant, not hard-coded hexes",
  /TREND_HELPER_COLORS/.test(mini) && !/#3b82f6|#eab308|#94a3b8/.test(mini),
  "the single-source file exists to stop exactly this drift between the three charts that draw this line"
);

console.log("\n=== 5. The payload boundary, which is where the first attempt died ===\n");

// #387 attached the line to the section items' chartPoints. takeTop strips
// those -- deliberately, because they duplicate signalRecords -- so the field
// was assigned and then discarded before the payload was written. tsc was
// clean, the build was green, `grep -c trendLine` over an 8.97 MB response
// returned 0, and the chart correctly drew nothing. None of the assertions
// above could see it, because all of them stop at the module boundary.

const builder = fs.readFileSync(path.join(process.cwd(), "lib/server/pickersBuilder.ts"), "utf8");
const page = fs.readFileSync(path.join(process.cwd(), "app/components/PickerResultPage.tsx"), "utf8");

// takeTop is a whitelist TWICE: an explicit destructure and an explicit object
// literal. Rather than pin one field name, compare the whole section-item type
// against both lists -- the next field added will be dropped the same way.
const sectionItemBlock = builder.slice(
  builder.indexOf("type PickerSection = {"),
  builder.indexOf("\n};", builder.indexOf("type PickerSection = {"))
);
const sectionFields = [...sectionItemBlock.matchAll(/^    ([a-zA-Z_]+)\??:/gm)].map((m) => m[1]);

const takeTopBlock = builder.slice(
  builder.indexOf("const takeTop = (arr: PickerItem[]"),
  builder.indexOf("\n  };", builder.indexOf("const takeTop = (arr: PickerItem[]"))
);
const destructured = (takeTopBlock.match(/\.map\(\(\{([^}]*)\}\)/s)?.[1] ?? "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const missingFromDestructure = sectionFields.filter((f) => !destructured.includes(f));
const missingFromLiteral = sectionFields.filter(
  (f) => !new RegExp(`^\\s+${f}[,:]`, "m").test(takeTopBlock)
);

check(
  "every section-item field survives takeTop's destructure",
  missingFromDestructure.length === 0,
  `a field not named here is dropped from every section item with no error and no type complaint — missing: ${missingFromDestructure.join(", ") || "none"}`
);
check(
  "every section-item field survives takeTop's object literal",
  missingFromLiteral.length === 0,
  `the literal is the second whitelist; naming a field in only one of the two still drops it — missing: ${missingFromLiteral.join(", ") || "none"}`
);
check(
  "the section item type declares trendSeries",
  sectionFields.includes("trendSeries"),
  "declared on both PickerItem and the section item type, or it is dropped at whichever end omits it"
);

// HIDDEN, NOT DELETED (2026-10-07, #553 COWORK #186 ruling 6): the weekly
// sections now draw WEEKLY candles with the WEEKLY line, so these two read:
//   /trendSeries: weekly \? undefined : dailyTrendSeries/ and !/chartPoints: weekly \?/
//   /weekly \? undefined :/  ("the weekly sections get no series")
// The rule they held -- never the daily line on a weekly row -- is kept below.
const weeklyRules = (b) => {
  const fails = [];
  if (!/trendSeries: weekly \? weeklyTrendSeries : dailyTrendSeries,/.test(b)) fails.push("pushTrendFlip ships a series, the weekly one on a weekly row");
  if (!/chartPoints: weekly && weeklyFlipPoints\?\.length \? weeklyFlipPoints : chartPoints,/.test(b)) fails.push("a weekly row draws weekly candles; a daily row its plain points (never enriched)");
  if (!/trendTailForPoints\(weeklyFlipPoints, trendFlips\.weeklyTrend, WEEKLY_FLIP_CANDLES\)/.test(b)) fails.push("the weekly series is the weekly line over the weekly candles");
  if (!/\.filter\(\(p\) => closedWeeks\.has\(p\.date\.slice\(0, 10\)\)\)/.test(b)) fails.push("only closed weeks are drawn, as the flip is measured");
  if (!/const \{ dailyTrend: _dailyFull, weeklyTrend: _weeklyFull, \.\.\.trendFlipFlags \} = trendFlips;/.test(b) || !/\n\s*\.\.\.trendFlipFlags,\n/.test(b) || /\n\s*\.\.\.trendFlips,\n/.test(b)) fails.push("the record carries the flags, never the full daily or weekly series");
  for (const t of ["trendFlipBullishWeekly", "trendFlipBearishWeekly"]) {
    if (!new RegExp(`source: ${t},\\s*take: Math\\.max\\(40, ${t}\\.length\\),[\\s\\S]{0,200}?keepChartPoints: true,`).test(b)) fails.push(`the ${t} section keeps its weekly candles`);
  }
  return fails;
};
{
  const f = weeklyRules(builder);
  check("weekly rows: weekly candles, the weekly line, closed weeks, kept through takeTop (never the daily line); records carry no full series", f.length === 0, f.join("; "));
  for (const [label, from, to] of [
    ["the daily line on a weekly row", "trendSeries: weekly ? weeklyTrendSeries : dailyTrendSeries,", "trendSeries: dailyTrendSeries,"],
    ["weekly rows on daily candles", "chartPoints: weekly && weeklyFlipPoints?.length ? weeklyFlipPoints : chartPoints,", "chartPoints,"],
    ["the week in progress drawn", ".filter((p) => closedWeeks.has(p.date.slice(0, 10)))", ""],
    ["the full series spread into every record", "            ...trendFlipFlags,\n", "            ...trendFlips,\n"],
    ["the weekly candles stripped by takeTop", "take: Math.max(40, trendFlipBearishWeekly.length),\n      // The weekly candles ride with the item (#553 COWORK #186 ruling 6):\n      // signalRecords carries daily points only.\n      keepChartPoints: true,", "take: Math.max(40, trendFlipBearishWeekly.length),"],
  ]) {
    const m = builder.includes(from) ? weeklyRules(builder.replace(from, to)) : ["anchor matched nothing"];
    check(`mutant "${label}" is caught`, builder.includes(from) && m.length > 0, m[0] ?? "no rule failed");
  }
}
check(
  "PickerResultPage merges the series onto the record's points",
  /attachTrendHelper\(entry\.chartPoints, item\.trendSeries\)/.test(page),
  "without this the field arrives in the payload and nothing consumes it — the same silent nothing, one stage later"
);

console.log("\n=== 6. Round trip: build -> JSON -> merge ===\n");

// The real functions, across the boundary that actually broke: the payload is
// serialised, so anything the build produces has to survive stringify/parse and
// still make the flip-date claim the row's text makes.
const tail = trendTailForPoints(chartPoints, trend);
check("trendTailForPoints returns a series", Boolean(tail), `${tail?.dates.length ?? 0} bars`);
check(
  "it carries only the drawn window, not the whole history",
  tail.dates.length <= 64 && tail.dates.length < trend.dates.length,
  `sending the full series would put back most of the bytes the split exists to avoid — ${tail.dates.length} of ${trend.dates.length}`
);
check(
  "warm-up bars are dropped rather than sent as nulls",
  tail.line.every((v) => typeof v === "number" && Number.isFinite(v)),
  "they render nothing, and on a long series they are most of it"
);

const overWire = JSON.parse(JSON.stringify(tail));
const merged = attachTrendHelper(
  chartPoints.map((p) => ({ ...p })),
  overWire
);
const mFlip = merged.find((p) => p.date === flipDate);
const mPos = merged.findIndex((p) => p.date === flipDate);

check(
  "the flip-date colour claim survives the payload boundary",
  mFlip?.trendState === flip.direction,
  `this is the end-to-end version of the assertion in section 2 — direction ${flip.direction}, state ${mFlip?.trendState}`
);
check(
  "the bar before the flip still differs after the round trip",
  mPos > 0 && merged[mPos - 1].trendState !== mFlip?.trendState
);
check(
  "the merged line matches the build-side values exactly",
  merged.every((p) => {
    if (typeof p.trendLine !== "number") return true;
    const i = overWire.dates.indexOf(p.date);
    return i !== -1 && Math.abs(overWire.line[i] - p.trendLine) < 0.001;
  }),
  "one join is used on both sides, so a divergence here would mean the shapes have drifted apart"
);

console.log("\n=== 7. Production shape (#553 COWORK #185): stored charts + section series -> the page join ===\n");

// What production ships, rather than the clean shape above: the record's 72
// DAILY points end in a LIVE bar (today, before the close) that the closed
// series excludes, and the series rides as the section's trendTailForPoints.
// The drawn card is the last 64 points.
{
  const live = { date: "2026-08-09", close: closes[N - 1] * 1.01 };
  const stored = [...cleanIdx.slice(-71).map((i) => ({ date: dates[i], close: closes[i] })), live];
  const section = JSON.parse(JSON.stringify(trendTailForPoints(stored, trend)));
  const joined = attachTrendHelper(stored.map((p) => ({ ...p })), section);
  const drawn = joined.slice(-64);
  const coloured = drawn.filter((p) => typeof p.trendLine === "number");
  check("the live bar carries no line (the series is closed bars only)", typeof drawn[drawn.length - 1].trendLine !== "number");
  check("every other drawn bar is coloured", coloured.length === 63, `${coloured.length} of 64`);
  const pos = joined.findIndex((p) => p.date === flipDate);
  check(
    "the colour changes on the flip date in the joined window",
    pos > 0 && joined[pos].trendState === flip.direction && joined[pos - 1].trendState !== flip.direction,
    `flip ${flipDate} at index ${pos} of ${joined.length}`
  );
}

console.log("\n=== 8. Weekly cards (#553 COWORK #186 ruling 6): weekly candles, weekly line ===\n");
{
  const { resampleWeeklyClosed } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  // Weekdays over ~3 years: a long fall, then a hard turn up.
  const daily = [];
  let t = Date.UTC(2023, 0, 2);
  for (let k = 0; daily.length < 800; k++, t += 86400000) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const i = daily.length;
    daily.push({ date: new Date(t).toISOString().slice(0, 10), close: i < 560 ? 400 - i * 0.4 : 400 - 560 * 0.4 + (i - 560) * 1.6 });
  }
  const weeks = resampleWeeklyClosed(daily);
  const wSeries = computeTrendHelper(weeks.map((w) => w.close), trendLen, confirmBars);
  const wTrend = { dates: weeks.map((w) => w.date), line: wSeries.line, state: wSeries.state };
  const wFlip = latestTrendFlip(weeks.map((w) => w.close), trendLen, confirmBars);
  check("the fixture has a weekly flip after the weekly warm-up", Boolean(wFlip) && wFlip.flipIndex > 60, `flip index ${wFlip?.flipIndex}`);
  // The build's candles: the last 64 CLOSED weeks, each dated by its last session.
  const candles = weeks.slice(-64).map((w) => ({ date: w.date, close: w.close }));
  const wTail = JSON.parse(JSON.stringify(trendTailForPoints(candles, wTrend, 64)));
  const wDrawn = attachTrendHelper(candles.map((p) => ({ ...p })), wTail);
  const wDate = weeks[wFlip.flipIndex].date;
  const wPos = wDrawn.findIndex((p) => p.date === wDate);
  check("the flip week is inside the 64 drawn weeks", wPos >= 0, `week ending ${wDate}`);
  check(
    "the colour changes on the flip week (the row's \"week ending\" date)",
    wPos > 0 && wDrawn[wPos].trendState === wFlip.direction && wDrawn[wPos - 1].trendState !== wFlip.direction,
    `${wDrawn[wPos - 1]?.trendState} then ${wDrawn[wPos]?.trendState}`
  );
  check("every drawn week carries the weekly line", wDrawn.every((p) => typeof p.trendLine === "number"));
}

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
