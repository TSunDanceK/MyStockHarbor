// Pins open / dayHigh / dayLow through the price pool, and the guard that makes
// their absence visible.
//
// WHY THE GUARD IS THE POINT. Point's open/high/low are OPTIONAL, so a
// price-pool row missing them would type-check and slot silently into a
// synthesised daily bar. MA, RSI, MACD and Bollinger read `close` and would look
// perfectly fine. ATR spike and the support/resistance detector read high/low
// and would quietly stop firing -- no error, no empty state, just two features
// that never trigger again
// (claude/traps/a-visible-failure-is-not-a-harmless-one.md).
//
// So the fields landing is half the job; the other half is that a run which
// gets none of them SAYS SO.
//
//   node scripts/check-pricepool-ohlc.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const codeOf = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const pool = codeOf(read("lib/server/pricePool.ts"));

// SCOPED, because `open: num(row.open)` and even
// `const row = (Array.isArray(json) ? json[0] : json)` appear at MORE THAN ONE
// site in this file -- fetchStableQuote, fetchPeTtm and readPricePoolBulk all
// carry byte-identical lines. A regex over the whole file is satisfied by
// whichever copy survives, so deleting the one being asserted about stays
// green. Caught by calibration, not review
// (claude/traps/a-regex-over-source-has-no-scope.md).
const between = (startRe, endRe) => {
  const start = pool.search(startRe);
  if (start < 0) return "";
  const rest = pool.slice(start);
  const end = rest.slice(1).search(endRe);
  return end < 0 ? rest : rest.slice(0, end + 1);
};
const NEXT_FN = /\n(export )?(async )?function /;
const quoteFn = between(/async function fetchStableQuote/, NEXT_FN);
const readFn = between(/export async function readPricePoolBulk/, NEXT_FN);

console.log("\n=== 1. The fields exist end to end ===\n");
// Every hop. A field added to the type but not the writer is the partial-plumbing
// shape #330 had: it type-checks and is always undefined.
for (const field of ["open", "dayHigh", "dayLow"]) {
  check(`${field}: on PricePoolRow`, new RegExp(`\\n  ${field}: number \\| null;`).test(pool));
  check(`${field}: on QuoteLite`, new RegExp(`type QuoteLite = \\{[\\s\\S]*?${field}: number \\| null;[\\s\\S]*?\\};`).test(pool));
  check(`${field}: read off the quote row (fetchStableQuote)`, new RegExp(`${field}: num\\(row\\.${field}\\)`).test(quoteFn));
  check(`${field}: written by the per-symbol warm path`, new RegExp(`${field}: quote \\? quote\\.${field}`).test(pool));
  check(`${field}: carried forward on the bucket path`, new RegExp(`${field}: prev\\?\\.${field} \\?\\? null`).test(pool));
  check(`${field}: parsed back on read (readPricePoolBulk)`, new RegExp(`${field}: num\\(row\\.${field}\\)`).test(readFn));
}

console.log("\n=== 2. Absent is explicit null, never a missing key ===\n");
// The cold seed genuinely cannot know OHLC. It must write null rather than omit
// the keys, so a reader can tell "not fetched" from "field gone".
check(
  "the cold seed writes explicit nulls rather than omitting the keys",
  /open: null,\n\s*dayHigh: null,\n\s*dayLow: null,/.test(pool),
  "an omitted key and a null are the same to a consumer, until one of them is a bug"
);
check(
  "num() is used, so a non-finite value becomes null rather than NaN",
  /open: num\(row\.open\)/.test(quoteFn)
);
check(
  "the two scopes really are disjoint, so the checks above cannot alias",
  quoteFn.length > 0 &&
    readFn.length > 0 &&
    !quoteFn.includes("readPricePoolBulk") &&
    !readFn.includes("fetchStableQuote") &&
    !quoteFn.includes("fetchPeTtm"),
  `quote ${quoteFn.length} chars, read ${readFn.length} chars`
);

console.log("\n=== 3. The guard fires only when it means something ===\n");
// A run that fetched quotes and got no opens is the real signal. A run that
// fetched NO quotes has nothing to say about the fields, and warning there would
// report our own idleness as FMP's outage.
// RUN, not pattern-matched. These were two regexes, and the second was a strict
// SUBSTRING of the first -- it could not fail independently, so it looked like
// two checks and was one. The condition is now a predicate the harness executes.
const warnFn = (() => {
  const src = read("lib/server/pricePool.ts");
  const m = src.match(/export function shouldWarnMissingOpen[\s\S]*?\n\}/);
  return m ? m[0].replace(/^export /, "").replace(/: number/g, "").replace(/\): boolean/, ")") : null;
})();
if (!warnFn) {
  check("shouldWarnMissingOpen is extractable", false, "measuring nothing");
} else {
  const shouldWarn = new Function(`${warnFn}; return shouldWarnMissingOpen;`)();
  check("quotes fetched, none carried an open -> warn", shouldWarn(220, 0) === true);
  check("quotes fetched, some carried an open -> silent", shouldWarn(220, 219) === false);
  check("even ONE open is enough to stay silent", shouldWarn(220, 1) === false);
  check(
    "NO quotes fetched -> silent, whatever openCarried says",
    shouldWarn(0, 0) === false,
    "absence needs the producer to have run — idleness is not FMP's outage"
  );
  check("the source calls the predicate rather than inlining it", /if \(shouldWarnMissingOpen\(pxRefreshed, openCarried\)\)/.test(pool));
}
check("openCarried is actually counted", /if \(quote && quote\.open != null\) openCarried\+\+;/.test(pool));
check(
  "the warning names the consequence, not just the fact",
  /ATR spike and the support\/resistance detector/.test(read("lib/server/pricePool.ts"))
);

console.log("\n=== 4. It is reported, not only warned about ===\n");
// A warning that only fires at ZERO cannot show a slow decline. The count rides
// on the run record so the ratio is visible before it becomes a cliff.
check("openCarried is returned from warmPricePool", /openCarried,\n/.test(pool));
const route = codeOf(read("app/api/jobs/warm-price-pool/route.ts"));
check(
  "...and recorded on the job run, next to priceRefreshed",
  /priceRefreshed: result\.priceRefreshed \?\? null,/.test(route) &&
    /openCarried: result\.openCarried \?\? null,/.test(route),
  "so the cache health page shows the ratio, not just the cliff"
);

console.log("\n=== 5. No extra FMP call was added ===\n");
// The entire justification: these bytes are already paid for. If this change
// introduced a fetch, it would cost the thing it was meant to be free of.
const fetchCount = (pool.match(/fmpFetch\(/g) ?? []).length;
check(
  "fmpFetch call sites unchanged at 3",
  fetchCount === 3,
  `${fetchCount} — quote, ratios-ttm, mover buckets`
);
check(
  "the fields come off the response already being read",
  /const row = \(Array\.isArray\(json\) \? json\[0\] : json\)[\s\S]{0,400}open: num\(row\.open\)/.test(quoteFn),
  "scoped: fetchPeTtm carries a byte-identical `const row = (...)` line"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
