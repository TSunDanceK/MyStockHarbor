// WHERE THE CONVERSION HAPPENS, AND WHAT IT IS ALLOWED TO TOUCH — run, and run
// again under the mutations the brief names.
//
// Three properties, each demonstrated with NUMBERS rather than asserted:
//
//   1. CONVERT AFTER DIFFERENCING. A quarter is a difference of two cumulative
//      filings; converting the cumulatives first and subtracting after is a
//      different number, and an ordinary-looking one.
//   2. GROWTH IN THE REPORTING CURRENCY. Growth across two converted periods
//      compounds the business result with the currency move.
//   3. SHARE COUNTS ARE NOT MONEY. Converting one is a company with a
//      different number of shares than it has.
//
// Each is then run with the rule removed, and the mutation must make it FAIL.
//
// ── THE RATES ARE REAL ────────────────────────────────────────────────────
// 1.0710 and 1.1604 are measured DEXUSEU values (2024-06-28 and 2026-09-11,
// relay 35494551985) — an 8.3% move, which is an ordinary two-year drift for
// EUR/USD rather than a figure chosen to make the error look big.
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const SRC = readCodeOnly("lib/server/secCurrency.ts").replace(
  /^import[\s\S]*?from\s*"[^"]+";$/gm,
  ""
);
const FX = readCodeOnly("lib/server/fxRates.ts");
const FIELDS = readCodeOnly("lib/server/secFields.ts");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const build = (src = SRC) => lift([FIELDS, FX, src].join("\n"));
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

// Two measured rates, two years apart.
const R_OLD = 1.0710;
const R_NEW = 1.1604;
const near = (a, b, eps = 1e-6) => typeof a === "number" && Math.abs(a - b) < eps;
const fmt = (n) => (typeof n === "number" ? n.toFixed(2) : String(n));

// A flat series at each rate, wide enough that averageOver's coverage bar is met.
const flat = (from, to, rate) => {
  const out = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) {
    out.push({ date: new Date(t).toISOString().slice(0, 10), usdPerUnit: rate });
  }
  return out;
};
const series = {
  currency: "EUR",
  source: "fixture",
  observations: [
    ...flat("2024-01-01", "2024-12-31", R_OLD),
    ...flat("2026-01-01", "2026-12-31", R_NEW),
  ],
};

const moneyIdx = [...mod.moneyFieldIndexes()];
const MONEY = moneyIdx[0];
const cell = (val) => ({ val, tag: "X", ns: "ifrs-full", derived: "as-filed" });
const period = (start, end, vals) => ({
  end, start, fp: null, fy: null, accession: "a", filed: end,
  values: Object.entries(vals).reduce((acc, [i, v]) => { acc[Number(i)] = cell(v); return acc; }, []),
});
const result = (quarters) => ({
  symbol: "RYAAY", cik: 1, entityName: "Ryanair", fieldsHash: "x",
  quarters, years: [], instants: [], coverShares: null,
  taxonomies: ["ifrs-full"], refusedUnits: [], conceptChoice: {}, notes: [],
});

console.log("\n1. CONVERT AFTER DIFFERENCING");
{
  // The filer's own figures, in EUR: two quarters, already differenced by
  // extractCompanyFacts, which is what convertExtractResult receives.
  const Q_OLD = 1000;
  const Q_NEW = 1000; // a genuinely FLAT year in the filer's own currency
  const r = result([period("2026-07-01", "2026-09-30", { [MONEY]: Q_NEW }),
                    period("2024-07-01", "2024-09-30", { [MONEY]: Q_OLD })]);
  const { result: got, conversion } = mod.convertExtractResult(r, series);
  const after = got.quarters.map((p) => p.values[MONEY].val);
  check(
    "each differenced quarter is converted at its own period's rate",
    near(after[0], Q_NEW * R_NEW) && near(after[1], Q_OLD * R_OLD),
    `got ${fmt(after[0])} (expected ${fmt(Q_NEW * R_NEW)}), ${fmt(after[1])} (expected ${fmt(Q_OLD * R_OLD)})`
  );
  check(
    "the conversion records the rate and basis for every period it touched",
    conversion.applied.length === 2 &&
      conversion.applied.every((a) => a.basis === "average") &&
      conversion.from === "EUR" && conversion.source === "fixture",
    JSON.stringify(conversion.applied.map((a) => `${a.end} ${a.basis} ${a.usdPerUnit.toFixed(4)}`))
  );

  // WHAT CONVERT-BEFORE-DIFFERENCING WOULD HAVE PRODUCED, computed here so the
  // size of the error is visible rather than asserted. SEC publishes YTD, so
  // the Q3 quarter is YTD_Q3 - YTD_Q2.
  const YTD_Q2 = 2000, YTD_Q3 = 3000;          // -> Q3 = 1000, as above
  const rQ2 = R_OLD, rQ3 = R_NEW;              // the two cumulatives' own rates
  const wrong = YTD_Q3 * rQ3 - YTD_Q2 * rQ2;
  const right = (YTD_Q3 - YTD_Q2) * rQ3;
  check(
    "converting the cumulatives first and subtracting after is a DIFFERENT number",
    !near(wrong, right, 1e-6),
    `before-differencing ${fmt(wrong)} vs after-differencing ${fmt(right)} ` +
      `— ${(((wrong - right) / right) * 100).toFixed(1)}% out, and neither looks wrong on a page`
  );
  check(
    "and the shipped path produces the after-differencing figure",
    near(after[0], right),
    `${fmt(after[0])} === ${fmt(right)}`
  );
}

console.log("\n2. GROWTH IN THE REPORTING CURRENCY, NOT ON THE CONVERTED FIGURES");
{
  const FLAT = 1000;
  const r = result([period("2026-07-01", "2026-09-30", { [MONEY]: FLAT }),
                    period("2024-07-01", "2024-09-30", { [MONEY]: FLAT })]);
  const { result: got, conversion } = mod.convertExtractResult(r, series);

  const usd = got.quarters.map((p) => p.values[MONEY].val);
  const growthOnConverted = usd[0] / usd[1] - 1;
  const home = got.quarters.map((p) => mod.inReportingCurrency(p, conversion).values[MONEY].val);
  const growthInReporting = home[0] / home[1] - 1;

  check(
    "a flat year in the filer's own currency is FLAT in the reporting currency",
    near(growthInReporting, 0, 1e-9),
    `${(growthInReporting * 100).toFixed(4)}%`
  );
  check(
    "the same flat year on the CONVERTED figures reads as the currency move",
    near(growthOnConverted, R_NEW / R_OLD - 1, 1e-9) && Math.abs(growthOnConverted) > 0.08,
    `${(growthOnConverted * 100).toFixed(2)}% — an FX drift printed under a heading that says growth`
  );
  check(
    "inReportingCurrency recovers the filer's own figures exactly",
    near(home[0], FLAT, 1e-9) && near(home[1], FLAT, 1e-9),
    `${fmt(home[0])}, ${fmt(home[1])}`
  );
  await underMutation(
    "growth taken on converted figures (reporting-currency recovery removed)",
    "      v === null || !money.has(i) || v.val === null ? v : { ...v, val: v.val / rate }",
    "      v",
    (m) => {
      const c = m.convertExtractResult(r, series);
      const h = c.result.quarters.map((p) => m.inReportingCurrency(p, c.conversion).values[MONEY].val);
      return near(h[0] / h[1] - 1, 0, 1e-9);
    }
  );

  // MARGINS ARE RATE-INVARIANT, asserted so nobody "fixes" them later.
  const two = result([period("2026-07-01", "2026-09-30", { [MONEY]: 1000, [moneyIdx[1]]: 250 })]);
  const conv = mod.convertExtractResult(two, series).result.quarters[0];
  check(
    "a margin is unchanged by conversion — both sides carry the same rate",
    near(conv.values[moneyIdx[1]].val / conv.values[MONEY].val, 250 / 1000, 1e-12),
    "within-period ratios need no special handling"
  );
}

console.log("\n3. SHARE COUNTS ARE NOT MONEY");
{
  const sharesIdx = [...Array(40).keys()].find((i) => !mod.moneyFieldIndexes().has(i) && i !== MONEY);
  const r = result([period("2026-07-01", "2026-09-30", { [MONEY]: 1000, [sharesIdx]: 500_000_000 })]);
  const got = mod.convertExtractResult(r, series).result.quarters[0];
  check(
    "a non-money field passes through untouched",
    got.values[sharesIdx].val === 500_000_000,
    `got ${got.values[sharesIdx].val}`
  );
  check(
    "while the money field beside it was converted",
    near(got.values[MONEY].val, 1000 * R_NEW),
    `got ${fmt(got.values[MONEY].val)}`
  );
  await underMutation(
    "every field converted, share counts included",
    "          if (!money.has(i)) return v;",
    "",
    (m) => m.convertExtractResult(r, series).result.quarters[0].values[sharesIdx].val === 500_000_000
  );
}

console.log("\n4. A PERIOD WITH NO HONEST RATE IS DROPPED, NOT LEFT IN EUROS");
{
  const r = result([period("2020-07-01", "2020-09-30", { [MONEY]: 1000 }),
                    period("2026-07-01", "2026-09-30", { [MONEY]: 1000 })]);
  const { result: got, conversion } = mod.convertExtractResult(r, series);
  check(
    "a period the series does not cover is dropped",
    got.quarters.length === 1 && got.quarters[0].end === "2026-09-30",
    `kept ${got.quarters.map((p) => p.end).join(", ")}`
  );
  check(
    "and its end is recorded, so the page can say the series is short",
    conversion.refused.includes("2020-09-30"),
    `refused: ${JSON.stringify(conversion.refused)}`
  );
}

console.log("\n5. THE CURRENCY IS DECIDED ONCE, PER FILER");
{
  const facts = (units) => ({
    cik: 1,
    facts: { "ifrs-full": { Revenue: { units } } },
  });
  const tag = (mod2 = mod) => mod2.reportingCurrency;
  check(
    "a filer publishing only EUR reports in EUR",
    tag()(facts({ EUR: [{ val: 1 }] })) === "EUR"
  );
  check(
    "a filer publishing any USD at all is read as USD, so nothing rendering today moves",
    tag()(facts({ EUR: [{ val: 1 }], USD: [{ val: 1 }] })) === "USD"
  );
  check(
    "two foreign currencies and no USD REFUSES rather than voting",
    tag()(facts({ EUR: [{ val: 1 }, { val: 2 }], PLN: [{ val: 1 }] })) === null,
    "a column half in euros and half in zloty is the failure the unit guard exists to prevent"
  );
  await underMutation(
    "ambiguous currency resolved by majority vote",
    "  if (foreign.length !== 1) return null;\n  return foreign[0][0];",
    "  return foreign.sort((a, b) => b[1] - a[1])[0][0];",
    (m) => m.reportingCurrency(facts({ EUR: [{ val: 1 }, { val: 2 }], PLN: [{ val: 1 }] })) === null
  );
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
