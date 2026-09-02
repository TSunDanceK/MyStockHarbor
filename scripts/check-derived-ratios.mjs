// The price-derived ratios are computed, and computed in the right units.
//
// WHY THIS EXISTS. psRatio, pfcfRatio, divYield and payoutRatio are no longer
// taken from ratios-ttm; they are divisions against stored numerators and the
// pooled price, the same way forwardPe has always worked. Two things about that
// fail silently:
//
//   * THE UNIT. FMP returns dividendYieldTTM and dividendPayoutRatioTTM as
//     FRACTIONS and stockDataCache multiplies by 100 for display, so
//     ResultEntry.divYield and .payoutRatio are PERCENTS. A locally computed
//     yield is a fraction. Forget the x100 and a 1.35% yield renders as 0.01% --
//     plausible on a low-yield stock, absurd on a high one, and wrong on every
//     one. Nothing throws; the column just quietly reports a hundredth.
//
//   * THE FALLBACK. These return the stored ratios-ttm value when a numerator
//     is missing, so no row goes blank while revenue or cash flow is still
//     being warmed. Returning null instead would empty four columns for any
//     symbol warm-stock-data has not reached, and it would look like a data gap
//     rather than a code change.
//
// The functions are RUN, not pattern-matched. A regex for `* 100` cannot tell a
// scale that is applied from one in a comment, and this file's subject is a
// factor of 100 that appears in both (claude/traps/a-regex-over-source-has-no-scope.md).
//
//   node scripts/check-derived-ratios.mjs
import ts from "typescript";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const grid = readCodeOnly("app/components/PickerResultsGrid.tsx");

// Lift the four functions out of the .tsx and run them against a `num` stub
// matching the real one (finite numbers through, everything else null).
const NAMES = ["psRatio", "pfcfRatio", "divYieldPct", "payoutRatioPct"];
const bodies = NAMES.map((name) => {
  const m = grid.match(
    new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`)
  );
  return m ? m[0] : null;
});
const missing = NAMES.filter((_, i) => !bodies[i]);
if (missing.length) {
  console.error(
    `FAIL: could not extract ${missing.join(", ")} from PickerResultsGrid.tsx — ` +
      `this script would otherwise pass by measuring nothing.`
  );
  process.exit(1);
}

const src = `
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
${bodies.join("\n")}
export { ${NAMES.join(", ")} };
`;
const js = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const fns = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

// ── 1. The unit ─────────────────────────────────────────────────────────────
console.log("\n1. Derived yield and payout are PERCENTS, not fractions");

// $2.00 a share on a $100 price is 2%, not 0.02.
check(
  "a $2.00 dividend on a $100 price yields 2, not 0.02",
  fns.divYieldPct({ divPerShare: 2 }, { price: 100 }) === 2,
  `got ${fns.divYieldPct({ divPerShare: 2 }, { price: 100 })} — the stored field is ` +
    `already x100'd for display, so a derived fraction here is a 100x error`
);
// $2.00 paid out of $8.00 of earnings is a 25% payout.
check(
  "a $2.00 payout on $8.00 EPS is 25, not 0.25",
  fns.payoutRatioPct({ divPerShare: 2, epsTtm: 8 }, {}) === 25,
  `got ${fns.payoutRatioPct({ divPerShare: 2, epsTtm: 8 }, {})}`
);
// The pair must agree with each other: payout = yield x price / eps.
const y = fns.divYieldPct({ divPerShare: 2 }, { price: 100 });
const p = fns.payoutRatioPct({ divPerShare: 2, epsTtm: 8 }, {});
check(
  "the two scale identically",
  Math.abs(p - (y * 100) / 8) < 1e-9,
  `yield ${y}%, payout ${p}% — one scaled and the other not is the shape that ` +
    `would survive a single-value test`
);

// ── 2. The plain divisions ──────────────────────────────────────────────────
console.log("\n2. P/S and P/FCF divide market cap by the stored numerator");

check(
  "P/S is market cap over revenue",
  fns.psRatio({ marketCap: 1000, revenue: 250 }, {}) === 4,
  `got ${fns.psRatio({ marketCap: 1000, revenue: 250 }, {})}`
);
check(
  "P/FCF is market cap over free cash flow",
  fns.pfcfRatio({ marketCap: 1000, freeCashFlow: 50 }, {}) === 20,
  `got ${fns.pfcfRatio({ marketCap: 1000, freeCashFlow: 50 }, {})}`
);

// ── 3. Degradation ──────────────────────────────────────────────────────────
console.log("\n3. A missing numerator falls back; a bad one does not fabricate");

check(
  "a missing numerator returns the stored ratios-ttm value, not null",
  fns.psRatio({ marketCap: 1000, psRatio: 7 }, {}) === 7 &&
    fns.pfcfRatio({ marketCap: 1000, pfcfRatio: 9 }, {}) === 9 &&
    fns.divYieldPct({ divYield: 3 }, { price: 100 }) === 3 &&
    fns.payoutRatioPct({ divPerShare: 2, payoutRatio: 40 }, {}) === 40,
  "four columns would go blank for every symbol warm-stock-data has not " +
    "reached yet, and it would read as a data gap rather than a code change"
);
check(
  "a zero or negative denominator does not produce a number",
  fns.psRatio({ marketCap: 1000, revenue: 0 }, {}) === null &&
    fns.pfcfRatio({ marketCap: 1000, freeCashFlow: -50 }, {}) === null &&
    fns.payoutRatioPct({ divPerShare: 2, epsTtm: -1 }, {}) === null &&
    fns.divYieldPct({ divPerShare: 2 }, { price: 0 }) === null,
  "a loss-maker's P/FCF is not a small number, it is not a number — and a " +
    "negative would sort to the top of a cheapest-first column " +
    "(same guard as forwardPe's `eps <= 0`)"
);
check(
  "and with no stored fallback either, the answer is null rather than 0",
  fns.psRatio({}, {}) === null && fns.divYieldPct({}, { price: null }) === null,
  "zero is a value; absent is not"
);

// ── 4. The columns actually use them ────────────────────────────────────────
console.log("\n4. The derivations are wired to the rendered columns");

for (const [key, fn] of [
  ["ps", "psRatio"],
  ["pfcf", "pfcfRatio"],
  ["dyield", "divYieldPct"],
  ["payout", "payoutRatioPct"],
]) {
  const col = (grid.match(new RegExp(`const ${key}: Col = \\{[^\\n]*`)) ?? [])[0] ?? "";
  check(
    `the ${key} column reads ${fn}, not the stored field directly`,
    col.includes(`${fn}(e, d)`) && !/get: \(e\) =>/.test(col),
    col
      ? `a function defined but not wired is the quiet half of this change`
      : `column ${key} not found`
  );
}

console.log(
  failures === 0
    ? "\nAll derived-ratio assertions hold.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
