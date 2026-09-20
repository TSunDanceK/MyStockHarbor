// THE RATE RULES, RUN — and every one of them run again under a mutation that
// breaks it, because an assertion nothing can break is not an assertion.
//
// The mutations are applied to the SOURCE TEXT and re-lifted, so what is tested
// is the shipped function rather than a transcription of it. A mutation that
// fails to make its assertion fail is reported as loudly as a broken assertion:
// it means the assertion was never really testing the property.
//
// ── THE FIXTURE IS REAL, MEASURED DATA ─────────────────────────────────────
// The six observations below are the actual DEXUSEU values for 2024-06-24 to
// 2024-07-01 as FRED served them on a runner (relay 35494551985), including the
// real gap: there is NO row for Saturday the 29th or Sunday the 30th. Nothing
// here is invented, and the weekend hole is the case the spot rule exists for —
// 2024-06-30 is a balance-sheet date thousands of filers use.
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const SRC = readCodeOnly("lib/server/fxRates.ts");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/**
 * Apply a source mutation, re-lift, and assert the property now BREAKS.
 *
 * `probe` returns true when the property still holds. A mutation that leaves it
 * holding means the assertion above it proves nothing, so that is a failure of
 * the CHECK and is labelled as one rather than as a pass.
 */
const underMutation = async (name, from, to, probe) => {
  if (!SRC.includes(from)) {
    check(`mutation "${name}" could not be applied`, false, `source no longer contains: ${from.slice(0, 70)}`);
    return;
  }
  let stillHolds;
  try {
    const mod = await lift(SRC.replace(from, to));
    stillHolds = await probe(mod);
  } catch {
    // A mutation that makes the module throw has certainly broken the property.
    stillHolds = false;
  }
  check(`MUTATION "${name}" breaks the assertion`, !stillHolds,
    stillHolds ? "the property still held with the rule removed — the assertion above proves nothing" : "");
};

const fx = await lift(SRC);

// The real DEXUSEU week, weekend genuinely absent.
const WEEK = [
  { date: "2024-06-24", usdPerUnit: 1.0727 },
  { date: "2024-06-25", usdPerUnit: 1.0705 },
  { date: "2024-06-26", usdPerUnit: 1.0682 },
  { date: "2024-06-27", usdPerUnit: 1.0708 },
  { date: "2024-06-28", usdPerUnit: 1.0711 },
  { date: "2024-07-01", usdPerUnit: 1.0728 },
];
const series = (observations = WEEK) => ({ currency: "EUR", source: "fixture", observations });
const near = (a, b, eps = 1e-9) => typeof a === "number" && Math.abs(a - b) < eps;

console.log("\nSPOT ON A BALANCE-SHEET DATE — backward, never forward");
{
  const got = fx.spotOn(series(), "2024-06-30");
  check(
    "a Sunday balance-sheet date resolves to the PRIOR Friday, not the following Monday",
    got?.date === "2024-06-28" && near(got.usdPerUnit, 1.0711),
    `got ${got?.date} = ${got?.usdPerUnit}`
  );
  // THE MUTATION THE BRIEF NAMES: "past period at today's rate". Taking the
  // newest observation instead of walking back is exactly that failure, and it
  // is the one that makes a historical figure move — the Monday rate did not
  // exist on the Sunday, so the page would print one number today and another
  // tomorrow for a period that closed months ago.
  await underMutation(
    "past period converted at the newest rate (forward-fill)",
    "    if (o.date > dateISO) break;\n    best = o;",
    "    best = o;",
    (m) => m.spotOn(series(), "2024-06-30")?.date === "2024-06-28"
  );

  const far = fx.spotOn(series(), "2024-08-15");
  check(
    "a date far beyond the last observation REFUSES rather than reusing a stale rate",
    far === null,
    far ? `got ${far.date} = ${far.usdPerUnit}` : ""
  );
  await underMutation(
    "backfill window removed",
    "  if (gap > FX_SPOT_BACKFILL_DAYS) return null;",
    "",
    (m) => m.spotOn(series(), "2024-08-15") === null
  );
}

console.log("\nAVERAGE ACROSS A DURATION — the mean, not an endpoint");
{
  const got = fx.averageOver(series(), "2024-06-24", "2024-07-01");
  const mean = WEEK.reduce((a, o) => a + o.usdPerUnit, 0) / WEEK.length;
  check(
    "a duration averages every observation inside it",
    near(got?.usdPerUnit, mean, 1e-12) && got?.observations === 6,
    `got ${got?.usdPerUnit?.toFixed(6)} over ${got?.observations} obs (expected ${mean.toFixed(6)})`
  );
  // NOT THE CLOSING SPOT. 1.0728 vs 1.071017 is 0.17% here, which looks
  // harmless precisely because this week was calm; over a year in which a
  // currency moves 10% the same substitution is a 10% error in revenue.
  check(
    "the average is NOT the closing spot",
    !near(got?.usdPerUnit, 1.0728, 1e-6),
    ""
  );
  await underMutation(
    "duration converted at the closing spot instead of the average",
    "  const sum = inSpan.reduce((a, o) => a + o.usdPerUnit, 0);\n  return { usdPerUnit: sum / inSpan.length, observations: inSpan.length, coverage };",
    "  return { usdPerUnit: inSpan[inSpan.length - 1].usdPerUnit, observations: inSpan.length, coverage };",
    (m) => near(m.averageOver(series(), "2024-06-24", "2024-07-01")?.usdPerUnit, mean, 1e-12)
  );

  // A span with one observation in eight weeks: 1/57 coverage.
  const sparse = series([{ date: "2024-06-24", usdPerUnit: 1.0727 }]);
  const thin = fx.averageOver(sparse, "2024-05-01", "2024-06-26");
  check(
    "a span too sparse to average REFUSES rather than averaging what happened to be there",
    thin === null,
    thin ? `got ${thin.usdPerUnit} from ${thin.observations} obs, coverage ${thin.coverage.toFixed(3)}` : ""
  );
  await underMutation(
    "coverage floor removed",
    "  if (coverage < FX_AVERAGE_MIN_COVERAGE) return null;",
    "",
    (m) => m.averageOver(sparse, "2024-05-01", "2024-06-26") === null
  );
}

console.log("\nDIRECTION — normalised in the adapter, so no call site can invert it");
{
  // The real DEXCAUS value, and the real DEXUSEU value, same day.
  const csv = (id, val) => `observation_date,${id}\n2026-09-11,${val}\n`;
  const stub = (body, ok = true, status = 200) => async () => ({
    ok, status, text: async () => body,
  });

  const cad = await fx.fredSource(stub(csv("DEXCAUS", "1.3864")))
    .fetchSeries("CAD", "2026-09-01", "2026-09-30");
  check(
    "DEXCAUS (Canadian dollars per USD) is INVERTED to USD per Canadian dollar",
    near(cad[0]?.usdPerUnit, 1 / 1.3864, 1e-12),
    `got ${cad[0]?.usdPerUnit?.toFixed(6)} (expected ${(1 / 1.3864).toFixed(6)}, NOT 1.3864)`
  );
  const eur = await fx.fredSource(stub(csv("DEXUSEU", "1.1604")))
    .fetchSeries("EUR", "2026-09-01", "2026-09-30");
  check(
    "DEXUSEU (USD per euro) is taken as published",
    near(eur[0]?.usdPerUnit, 1.1604, 1e-12),
    `got ${eur[0]?.usdPerUnit}`
  );
  check(
    "the two series therefore do NOT get the same treatment",
    !near(cad[0]?.usdPerUnit, 1.3864, 1e-9),
    ""
  );
  await underMutation(
    "every series treated as USD-per-unit (the 1.92x error on CNI)",
    'usdPerUnit: quote === "usd-per-unit" ? val : 1 / val',
    "usdPerUnit: val",
    async (m) => {
      const c = await m.fredSource(stub(csv("DEXCAUS", "1.3864")))
        .fetchSeries("CAD", "2026-09-01", "2026-09-30");
      return near(c[0]?.usdPerUnit, 1 / 1.3864, 1e-12);
    }
  );

  console.log("\nJUNK IN — a 200 carrying HTML, and FRED's \".\" placeholder");
  let threw = false;
  try {
    await fx.fredSource(stub("<!DOCTYPE html><html><head><title>Board of Governors"))
      .fetchSeries("EUR", "2026-09-01", "2026-09-30");
  } catch { threw = true; }
  check(
    "a 200 carrying HTML THROWS rather than parsing to an empty series",
    threw,
    "an empty series is indistinguishable from a quiet day; this is how the federalreserve.gov probes looked"
  );
  // BOTH GUARDS, REMOVED TOGETHER. csvRowsOrNull rejects HTML twice over — the
  // DOCTYPE test and the header-shape test — and the first version of this
  // mutation removed only the DOCTYPE line and reported that the assertion
  // "still held", because the header regex caught it anyway. That is defence in
  // depth doing its job, and it means the honest mutation has to take out the
  // whole of the validation, not one half a reader happens to think of first.
  await underMutation(
    "all CSV validation removed, so HTML parses as data",
    [
      "  if (!text || /^<!DOCTYPE|^<html/i.test(text)) return null;",
      String.raw`  const lines = text.split("\n");`,
      '  if (!/^[A-Za-z_]+,[A-Za-z0-9_]+/.test(lines[0] ?? "")) return null;',
    ].join("\n"),
    String.raw`  const lines = text.split("\n");`,
    async (m) => {
      try {
        await m.fredSource(stub("<!DOCTYPE html><html><head><title>Board of Governors"))
          .fetchSeries("EUR", "2026-09-01", "2026-09-30");
        return false;
      } catch { return true; }
    }
  );

  const dotted = await fx.fredSource(stub("observation_date,DEXUSEU\n2026-09-10,.\n2026-09-11,1.1604\n"))
    .fetchSeries("EUR", "2026-09-01", "2026-09-30");
  check(
    'a "." placeholder is DROPPED, never coerced to a zero rate',
    dotted.length === 1 && dotted[0].date === "2026-09-11" && !dotted.some((o) => o.usdPerUnit === 0),
    `got ${JSON.stringify(dotted)}`
  );
  await underMutation(
    '"." coerced to 0 by a truthiness guard',
    "    if (!Number.isFinite(val) || val <= 0) continue;\n    out.push({ date, usdPerUnit: quote",
    "    out.push({ date, usdPerUnit: quote",
    async (m) => {
      const d = await m.fredSource(stub("observation_date,DEXUSEU\n2026-09-10,.\n2026-09-11,1.1604\n"))
        .fetchSeries("EUR", "2026-09-01", "2026-09-30");
      return d.length === 1 && !d.some((o) => o.usdPerUnit === 0 || Number.isNaN(o.usdPerUnit));
    }
  );
}

console.log("\nFALLBACK — the primary's failure must not abort the lookup");
{
  const dead = { id: "dead", supports: () => true, fetchSeries: async () => { throw new Error("HTTP 503"); } };
  const alive = {
    id: "alive", supports: () => true,
    fetchSeries: async () => [{ date: "2026-09-11", usdPerUnit: 1.1604 }],
  };
  const got = await fx.loadSeries("EUR", "2026-09-01", "2026-09-30", [dead, alive]);
  check(
    "a throwing primary falls through to the fallback",
    got?.source === "alive" && got.observations.length === 1,
    `got ${got?.source ?? "null"}`
  );
  check(
    "and the series NAMES the source that answered",
    got?.source === "alive",
    "a figure that cannot say which source produced it is not auditable"
  );
  const none = await fx.loadSeries("EUR", "2026-09-01", "2026-09-30", [dead]);
  check("every source failing yields null, not an empty series", none === null, "");
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
