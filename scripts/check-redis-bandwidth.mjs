// Redis bandwidth: the constants are re-derived, and the growth blocker bites.
//
// TWO THINGS FAIL SILENTLY HERE.
//
//   A BYTES-PER-SYMBOL CONSTANT GOING STALE. Every projection in
//   redisBandwidth.ts is `units x constant`. Add a field to a chart point or a
//   history bar and the constant is wrong, the projection is wrong, and nothing
//   about it looks wrong -- a number with no history is exactly as bad as a
//   typed one (the EARNINGS_PEAK_DAY_SHARE lesson). So every constant is
//   RE-DERIVED here by building the structure the writing module actually
//   writes -- field set, rounding and bar count read out of that source, not
//   typed into this file -- and serialising it.
//
//   THE UNIVERSE CAP RISING WHILE THE BILL IS OVER. At 762 symbols the
//   projection is ~207 GB/month against a 200 GB cap. At 1,500 it is roughly
//   twice the cap, which is an invoice or a throttle rather than a degradation.
//   The growth plan sequenced 700 -> 1,500 behind the EARNINGS work; this is
//   what stops the next reader acting on that alone.
//
// WHY THE ASSERTION IS A CEILING AND NOT A BUDGET. The honest budget check --
// "the projection at the configured cap fits under the plan limit" -- is RED
// TODAY, at the cap already shipping. A check red on main from the day it lands
// gets muted, and a muted check protects nothing. So the enforced rule is the
// DIRECTION: the cap may not RISE while the projection is over. Green today,
// red on exactly the action this exists to stop.
//
//   node scripts/check-redis-bandwidth.mjs
import ts from "typescript";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const meter = readCodeOnly("lib/server/redisBandwidth.ts");
const builder = readCodeOnly("lib/server/pickersBuilder.ts");
const history = readCodeOnly("lib/server/historyCache.ts");
const charts = readCodeOnly("lib/server/pickerChartsCache.ts");

const numFrom = (src, name) => {
  const raw = (src.match(new RegExp(`${name}\\s*=\\s*([0-9_ *]+)`)) ?? [])[1];
  if (!raw) return NaN;
  return Number(Function(`"use strict"; return (${raw.replace(/_/g, "")});`)());
};

// ── The shapes, rebuilt from the modules that write them ────────────────────
//
// Values are synthetic; the FIELD SET, the ROUNDING and the BAR COUNT are not.
// Digit count is what drives a number's JSON size, so a ladder of realistic
// price levels is used rather than one $100 stock -- a universe of 762 is not
// all the same order of magnitude.
const PRICES = [3.42, 17.8, 48.15, 96.4, 212.77, 431.06, 918.34];
const rnd = (seed) => {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
};
const bytes = (v) => Buffer.byteLength(JSON.stringify(v), "utf8");
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

const CHART_BARS = Number(
  (builder.match(/function buildPickerChartPoints\(points: Point\[\], bars = (\d+)\)/) ?? [])[1]
);
check(
  "the chart bar count was read from pickersBuilder",
  Number.isFinite(CHART_BARS) && CHART_BARS > 0,
  `${CHART_BARS} bars — typed here instead, this whole file would measure a guess`
);

// The field set of a PickerChartPoint, taken from the object buildPickerChartPoints
// RETURNS rather than from the exported type: the type carries trendLine and
// trendState, which are merged client-side and never stored.
const returned = builder.slice(
  builder.indexOf("function buildPickerChartPoints"),
  builder.indexOf("function buildDashboardHref")
);
const CHART_FIELDS = [...returned.matchAll(/^\s{8}([a-zA-Z0-9]+):/gm)].map((m) => m[1]);
check(
  "the chart point's field set was derived, not listed",
  CHART_FIELDS.length >= 9 && CHART_FIELDS.includes("macdHist") && !CHART_FIELDS.includes("trendLine"),
  `${CHART_FIELDS.join(", ")} — trendLine/trendState are merged client-side and never stored, ` +
    `so taking the exported TYPE would have over-counted every symbol`
);

// THE FIXTURE MUST KNOW EVERY FIELD THE BUILDER RETURNS.
//
// Found by calibration, not by thinking: adding `atr14` to buildPickerChartPoints
// and re-running left this file GREEN. CHART_FIELDS picked the new name up
// correctly, the fixture had no value for it, `point[f]` was undefined, and
// JSON.stringify omits undefined — so a new field contributed exactly zero
// bytes and the constant it should have invalidated stayed "correct". An
// assertion that cannot notice the thing it exists to notice.
const FIXTURE_FIELDS = new Set([
  "date", "open", "close", "high", "low", "volume", "ma50", "ma200", "rsi14", "macdHist",
]);
const unknownFields = CHART_FIELDS.filter((f) => !FIXTURE_FIELDS.has(f));
if (unknownFields.length) {
  console.error(
    `FAIL: buildPickerChartPoints now returns ${unknownFields.join(", ")}, which this ` +
      `file has no value for. An unknown field serialises to nothing, so every byte ` +
      `figure below would silently ignore it. Add a realistic value to chartSeries ` +
      `and re-measure BYTES_PER_SYMBOL_PICKER_CHARTS.`
  );
  process.exit(1);
}

function chartSeries(basePrice, seed) {
  const r = rnd(seed);
  const out = [];
  let px = basePrice;
  const start = Date.UTC(2026, 5, 1);
  for (let i = 0; i < CHART_BARS; i++) {
    px = Math.max(0.5, px * (1 + (r() - 0.5) * 0.04));
    const point = {
      date: new Date(start + i * 86400000 * 1.4).toISOString().slice(0, 10),
      open: Number((px * 0.995).toFixed(2)),
      close: Number(px.toFixed(2)),
      high: Number((px * 1.012).toFixed(2)),
      low: Number((px * 0.988).toFixed(2)),
      volume: Math.round(200000 + r() * 40000000),
      ma50: Number((px * 0.98).toFixed(2)),
      ma200: Number((px * 0.94).toFixed(2)),
      rsi14: Number((30 + r() * 45).toFixed(2)),
      macdHist: Number(((r() - 0.5) * 2.5).toFixed(4)),
    };
    // Only the fields the builder actually returns.
    out.push(Object.fromEntries(CHART_FIELDS.map((f) => [f, point[f]])));
  }
  return out;
}

// A stored history entry. parseFmpHistoricalRows applies NO rounding, and the
// row count is the measured one recorded in claude/fmp-history-payload-audit-2026-08-30.md
// (831,564 rows / ~700 symbols on the 2026-08-24 forced warm).
const HISTORY_ROWS = 1188;
function historyEntry(basePrice, seed) {
  const r = rnd(seed);
  const daily = [];
  let px = basePrice;
  const start = Date.UTC(2021, 0, 4);
  for (let i = 0; i < HISTORY_ROWS; i++) {
    px = Math.max(0.5, px * (1 + (r() - 0.5) * 0.04));
    daily.push({
      date: new Date(start + i * 86400000 * 1.4).toISOString().slice(0, 10),
      open: Number((px * 0.995).toFixed(2)),
      close: Number(px.toFixed(2)),
      high: Number((px * 1.012).toFixed(2)),
      low: Number((px * 0.988).toFixed(2)),
      volume: Math.round(200000 + r() * 40000000),
    });
  }
  return {
    symbol: "AAAA",
    status: "qualified",
    checkedAt: 1757000000000,
    source: "fmp",
    daily,
    parsedRows: HISTORY_ROWS,
  };
}

const derivedCharts = Math.round(avg(PRICES.map((p, i) => bytes(chartSeries(p, 7 + i * 977)))));
const derivedHistory = Math.round(avg(PRICES.map((p, i) => bytes(historyEntry(p, 11 + i * 331)))));

console.log("\n1. The per-unit constants are measurements, and still true");

const declaredCharts = numFrom(meter, "BYTES_PER_SYMBOL_PICKER_CHARTS");
const declaredHistory = numFrom(meter, "BYTES_PER_SYMBOL_HISTORY");
const within = (a, b, pct) => Math.abs(a - b) / b <= pct;

check(
  "BYTES_PER_SYMBOL_PICKER_CHARTS matches what the builder would write",
  within(declaredCharts, derivedCharts, 0.05),
  `declared ${declaredCharts}, re-derived ${derivedCharts} from ${CHART_BARS} bars x ` +
    `${CHART_FIELDS.length} fields — add a field to a chart point and this fails ` +
    `instead of the projection quietly going wrong`
);
check(
  "BYTES_PER_SYMBOL_HISTORY matches what the parser would store",
  within(declaredHistory, derivedHistory, 0.05),
  `declared ${declaredHistory}, re-derived ${derivedHistory} from ${HISTORY_ROWS} rows`
);

// THE CROSS-CHECK THAT MAKES THE SYNTHETIC RECONSTRUCTION CREDIBLE. This whole
// file builds fake series; the only reason to believe the byte figures is that
// the same reconstruction lands on a number production actually measured.
// READ FROM A CONSTANT, NOT FROM THE HEADER COMMENT THAT USED TO CARRY IT.
// The first version of this assertion matched `avgChartChars 11,016` out of
// pickerChartsCache's prose — and readCodeOnly blanks comments, so it matched
// nothing and reported NaN. The number now ships as data for exactly this
// reason (claude/traps/grep-finds-the-comment-not-the-code.md).
const LIVE_AVG_CHART_CHARS = numFrom(charts, "PICKER_CHARTS_MEASURED_AVG_CHARS");
check(
  "the reconstruction agrees with the live 2026-08-06 measurement",
  Number.isFinite(LIVE_AVG_CHART_CHARS) && within(derivedCharts, LIVE_AVG_CHART_CHARS, 0.05),
  `re-derived ${derivedCharts} vs ${LIVE_AVG_CHART_CHARS} measured in production — ` +
    `without this the synthetic values would be believed on their own, which is ` +
    `the difference between a measurement and a plausible number`
);
check(
  "the live measurement carries its own provenance too",
  /PICKER_CHARTS_MEASURED_AT = "\d{4}-\d{2}-\d{2}"/.test(charts) &&
    /PICKER_CHARTS_MEASURED_SOURCE =/.test(charts),
  "it is the only live byte figure in the system and the anchor for every " +
    "reconstructed one, so where it came from is not optional"
);
check(
  "the constants carry the date and the method that produced them",
  /BYTES_MEASURED_AT = "\d{4}-\d{2}-\d{2}"/.test(meter) &&
    /BYTES_MEASURED_BY =/.test(meter) &&
    /check-redis-bandwidth/.test(meter),
  "a bare number with no history is exactly as bad as a typed one"
);

console.log("\n2. History is the term the model omitted, and it is not small");

check(
  "one symbol's history outweighs its whole picker payload share",
  derivedHistory > (declaredCharts + numFrom(meter, "BYTES_PER_SYMBOL_PICKER_PAYLOAD")) * 5,
  `${(derivedHistory / 1024).toFixed(0)} KB against ${(
    (declaredCharts + numFrom(meter, "BYTES_PER_SYMBOL_PICKER_PAYLOAD")) / 1024
  ).toFixed(0)} KB — ${(
    derivedHistory / (declaredCharts + numFrom(meter, "BYTES_PER_SYMBOL_PICKER_PAYLOAD"))
  ).toFixed(1)}x. A model that counts only the payload is missing the larger ` +
    `per-symbol figure entirely`
);
check(
  "the bulk history read is metered where it happens, with its caller",
  /await recordRedisRead\("history-bulk", normalized\.length, caller\);/.test(history) &&
    (history.match(/recordRedisRead\("history-bulk"/g) ?? []).length === 2,
  "both bulk read paths — getDailyHistoryBulk and getCachedDailyHistoryBulk — " +
    "move the same bytes, and metering one would rank the other at zero"
);
check(
  "the SINGLE-symbol read is metered too",
  /await recordRedisRead\("history-single", 1, caller\);/.test(history),
  "the three plays builders read ~700 symbols each ONE AT A TIME; metering only " +
    "the bulk paths reported them at zero bytes while they moved the same ~110 KB " +
    "a symbol — the loop shape is not a property of the bytes"
);
check(
  "the picker payload and its chart series are metered SEPARATELY",
  /recordRedisRead\("picker-payload", records\.length\)/.test(builder) &&
    /recordRedisRead\("picker-charts", fields\.length\)/.test(charts),
  "they move for different reasons and at a 5x different size; one folded " +
    "counter cannot rank them, which is the entire purpose of the meter"
);

console.log("\n3. The growth blocker fails the build rather than arriving as an invoice");

const cap = numFrom(readCodeOnly("lib/server/dynamicUniverseCache.ts"), "ANALYSIS_UNIVERSE_CAP");
const ceiling = numFrom(meter, "REDIS_OVERAGE_MEASURED_AT_CAP");

/**
 * One `export const NAME = <expr>;` declaration, lifted VERBATIM.
 *
 * WHY NOT numFrom. That helper parses `[0-9_ *]+`, and
 * REDIS_PROJECTION_MEASURED_BYTES is `Math.round(48.6 * 1024 * 1024 * 1024)` --
 * a decimal inside a call, which it reads as NaN. Widening the regex until it
 * evaluates arbitrary expressions is how a source reader starts evaluating
 * identifiers it should not. Taking the whole declaration and letting the
 * module system evaluate it is both simpler and impossible to get subtly wrong:
 * the check runs the real value rather than a reconstruction of it.
 */
const declOf = (src, name) =>
  (src.match(new RegExp(`export const ${name} = [^;]+;`)) ?? [])[0] ?? "";

// RE-DERIVED 2026-09-11, AND RUN RATHER THAN RESTATED. The two functions below
// come out of the meter itself, so the numbers in these messages cannot drift
// from the ones the gate uses -- which is exactly what happened to the prose
// this replaces. It asserted "at 1,500 the projection is ~2x the plan cap"
// against a 207 GB baseline that #419/#420/#421 have since taken to 48.60,
// making the claim wrong by a factor of four in the reassuring direction.
const decls = [
  declOf(meter, "REDIS_PROJECTION_MEASURED_BYTES"),
  declOf(meter, "REDIS_OVERAGE_MEASURED_AT_CAP"),
  declOf(meter, "REDIS_BANDWIDTH_CAP_BYTES"),
  declOf(meter, "REDIS_PROJECTION_MEASURED_AT_CAP"),
];
if (decls.some((d) => !d)) {
  console.error(
    "FAIL: could not lift the budget constants. This script would otherwise " +
      "pass by measuring nothing."
  );
  process.exit(1);
}
const budgetMod = await lift(
  [
    ...decls,
    grabFunction(meter, "redisAffordableUniverseCap"),
    grabFunction(meter, "redisProjectedBytesAt"),
  ].join("\n")
);
const measured = budgetMod.REDIS_PROJECTION_MEASURED_BYTES;
const planCap = budgetMod.REDIS_BANDWIDTH_CAP_BYTES;
const affordable = budgetMod.redisAffordableUniverseCap();
const projectedAtCap = budgetMod.redisProjectedBytesAt(cap);
const GB = 1024 ** 3;

check(
  "the configured cap, the measured ceiling and the plan cap were all read",
  Number.isFinite(cap) && Number.isFinite(ceiling) && planCap > 0 && measured > 0,
  `ANALYSIS_UNIVERSE_CAP ${cap}, measured at ${ceiling}, plan cap ` +
    `${(planCap / GB).toFixed(0)} GB, measurement ${(measured / GB).toFixed(2)} GB/month`
);

// THE BUDGET RULE, WHICH COULD NOT BE WRITTEN BEFORE. The meter's own comment
// records why: "the honest budget check is RED TODAY, at the cap we already
// run. A check that is red on main from the day it lands is a check that gets
// muted." At 24.3% of the plan cap it is green, so it can finally be the rule,
// and it catches a regression in the bill that the direction rule cannot see.
check(
  "the projected bill at the configured cap fits under the plan cap",
  projectedAtCap > 0 && projectedAtCap < planCap,
  `${(projectedAtCap / GB).toFixed(2)} GB against ${(planCap / GB).toFixed(0)} GB — ` +
    `${((projectedAtCap / planCap) * 100).toFixed(1)}% of plan. Was ~207 GB (over) ` +
    `on 2026-09-04, before #419 closed the metering hole and #419/#420/#421 cut ` +
    `the traffic`
);

// THE DECISION RULE, AND IT IS NOT THE BUDGET. The budget would permit ~2,880
// symbols; the cap stays where the measurement was taken because raising the
// universe is a decision with a fresh measurement behind it, not a
// one-character edit. Stating the affordable figure in the message is
// deliberate -- the next person should see both numbers rather than inherit the
// old prose's wrong one.
check(
  "ANALYSIS_UNIVERSE_CAP has not been raised past the cap the measurement was taken at",
  cap <= ceiling,
  cap <= ceiling
    ? `${cap} <= ${ceiling}. The BILL would permit ~${affordable} at the measured ` +
      `${(measured / GB).toFixed(2)} GB/month, and that is not permission: the ` +
      `ceiling is where the measurement was taken, so raising it means re-taking ` +
      `it. For scale, 1,500 projects to ` +
      `${(budgetMod.redisProjectedBytesAt(1500) / GB).toFixed(0)} GB (` +
      `${((budgetMod.redisProjectedBytesAt(1500) / planCap) * 100).toFixed(0)}% of plan) ` +
      `and 3,000 to ${(budgetMod.redisProjectedBytesAt(3000) / GB).toFixed(0)} GB (` +
      `${((budgetMod.redisProjectedBytesAt(3000) / planCap) * 100).toFixed(0)}%), so the ` +
      `old 700 -> 1,500 -> 3,000 sequence is still blocked at its last step by the ` +
      `bill alone.`
    : `${cap} > ${ceiling} — the universe cap was raised past the cap the bandwidth ` +
      `measurement was taken at. Re-take it first.`
);
// DERIVED, PROVED BY RUNNING IT ON OTHER INPUTS. Comparing the function's
// answer to the same division computed here only proves two copies agree -- and
// a breakage that replaced the body with a typed `return 2880` passed it,
// because 2,880 is the right answer today. A function that ignores its
// arguments cannot survive being called with different ones.
check(
  "the affordable ceiling is DERIVED from the measurement, not written down",
  affordable === Math.floor((ceiling * planCap) / measured) &&
    affordable > ceiling &&
    // WITHIN ROUNDING, because the function floors and floor() does not
    // distribute over multiplication -- floor(x)*3 and floor(3x) differ by up
    // to 2. Asserting exact equality here failed on correct code, which is a
    // check calibrating itself rather than its subject.
    Math.abs(
      budgetMod.redisAffordableUniverseCap(measured * 2, ceiling, planCap) - affordable / 2
    ) <= 1 &&
    Math.abs(
      budgetMod.redisAffordableUniverseCap(measured, ceiling * 3, planCap) - affordable * 3
    ) <= 3,
  `${affordable} = ${ceiling} x ${(planCap / GB).toFixed(0)} GB / ` +
    `${(measured / GB).toFixed(2)} GB, and it halves at twice the bill and triples ` +
    `at three times the basis — it moves when the measurement does, which is what ` +
    `the last calibration could not do`
);
// AND RAISING THE CEILING ALONE IS NOT A WAY ROUND THE GATE. The gate compares
// ANALYSIS_UNIVERSE_CAP to the ceiling, so editing the ceiling upward weakens
// it invisibly. Tying it to the cap the measurement was taken at means moving
// it requires claiming a measurement taken there.
check(
  "the ceiling is the cap the measurement was actually taken at",
  ceiling === budgetMod.REDIS_PROJECTION_MEASURED_AT_CAP,
  `${ceiling} — found by breaking it: setting the ceiling to the affordable ` +
    `${affordable} left every other assertion here green while the gate had ` +
    `stopped gating`
);
check(
  "the measurement carries its date and where it came from",
  /REDIS_PROJECTION_MEASURED_AT = "\d{4}-\d{2}-\d{2}"/.test(meter) &&
    /REDIS_PROJECTION_MEASURED_SOURCE =/.test(meter),
  "the figure it replaces had four sentences of reasoning built on it and no " +
    "date, so it went stale silently and took the reasoning with it"
);
check(
  "the plan cap is named rather than assumed",
  /REDIS_BANDWIDTH_CAP_BYTES = 200 \* 1024 \* 1024 \* 1024/.test(meter),
  "200 GB — and it is a different limit from FMP's 40 GB, which sat at 11.4% " +
    "while this one was at ~100%"
);
check(
  "the report says how much of the window it actually observed",
  /daysMissing/.test(meter) && /daysMissing\+\+/.test(meter),
  "a window the meter was not running for makes the total a FLOOR, and a floor " +
    "presented as a measurement is how a small number stops people looking"
);

// THE METER MUST NOT BE ABLE TO BREAK WHAT IT MEASURES — RUN, DO NOT GREP.
//
// The first version tested `/catch \{/` against the extracted function text, and
// calibration showed it worthless: deleting the catch leaves the braces
// unbalanced, the TypeScript parser then swallows the NEXT function into this
// one, and readRedisBandwidth's own catch satisfied the regex. A shape assertion
// that passes because the parser mis-parsed is the worst kind.
//
// So it is lifted and executed against a Redis stub that throws, and the claim
// is the behavioural one: it resolves.
const recordFn = (() => {
  const sf = ts.createSourceFile("m.ts", meter, ts.ScriptTarget.Latest, true);
  let out = null;
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === "recordRedisRead") {
      out = n.getText(sf).replace(/^export\s+/, "");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
})();
const dayKeyFn = (() => {
  const sf = ts.createSourceFile("m.ts", meter, ts.ScriptTarget.Latest, true);
  let out = null;
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === "dayKey") {
      out = n.getText(sf).replace(/^export\s+/, "");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
})();
if (!recordFn || !dayKeyFn) {
  console.error(
    `FAIL: could not extract recordRedisRead (${!!recordFn}) or dayKey (${!!dayKeyFn}) — ` +
      `the fail-open assertion would measure nothing.`
  );
  process.exit(1);
}
const meterJs = ts.transpileModule(
  `const UNITS_KEY_PREFIX = "x:";
const UNITS_TTL_SECONDS = 1;
const redis = { pipeline: () => { throw new Error("upstash is down"); } };
${dayKeyFn}
${recordFn}
export { recordRedisRead };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
).outputText;
const lifted = await import(
  `data:text/javascript;base64,${Buffer.from(meterJs).toString("base64")}`
);
let threw = false;
try {
  await lifted.recordRedisRead("history-bulk", 762);
} catch {
  threw = true;
}
check(
  "the meter fails open when Redis throws",
  !threw,
  "it is instrumented into getDailyHistoryBulk, readPricePoolBulk and the picker " +
    "read path — a meter that can throw into those turns a bandwidth question " +
    "into an outage"
);

console.log(
  failures === 0
    ? "\nAll Redis bandwidth assertions hold.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
