// `next: { revalidate: N }` on a response over 2 MB is SILENTLY INERT.
//
// Next's Data Cache refuses any single entry above 2 MB. It does not throw and
// it does not report at the call site: the revalidate simply never applies, the
// only surviving layer is whatever module memo the caller happens to have, and
// that dies with the Lambda. THE FAILURE LOOKS EXACTLY LIKE SUCCESS.
//
// Two live instances found by sweep on 2026-08-24:
//
//   /stable/stock-list  3.0 MB, refetched on every cold start — 166.9 MB across
//                       a window holding roughly three days of data.
//   /api/pickers        ~8 MB. splitPickersPayload's own note measured 3.38 MB
//                       at a 260-symbol universe on 2026-08-06, of which 2.86 MB
//                       was chartPoints, and records that the share grows
//                       LINEARLY with the cap. The universe is now 700. Its call
//                       site carried a comment describing the exact dedupe that
//                       the limit prevents.
//
//   node scripts/check-oversized-cache.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const USAGE = "lib/server/fmpUsage.ts";
const usageSrc = fs.readFileSync(path.join(ROOT, USAGE), "utf8");
const sf = ts.createSourceFile(USAGE, usageSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

let warnFn = null;
const findWarn = (n) => {
  if (ts.isFunctionDeclaration(n) && n.name?.text === "warnIfTooBigToCache") warnFn = n.getText(sf);
  ts.forEachChild(n, findWarn);
};
findWarn(sf);

console.log("\n=== 1. The guard exists and is the REAL function ===\n");
check("warnIfTooBigToCache was extracted", Boolean(warnFn), warnFn ? "" : "MISSING — measuring nothing");
if (!warnFn) {
  console.log(`\nFAILED (1)\n`);
  process.exit(1);
}

const limitExpr = /const NEXT_DATA_CACHE_MAX_BYTES = ([^;]+);/.exec(usageSrc)?.[1] ?? "0";
const js = ts.transpileModule(
  `const NEXT_DATA_CACHE_MAX_BYTES = ${limitExpr};\n` +
    `const oversizedCacheWarned = new Set();\n` +
    // Identity label, so the dedupe assertion below is about the dedupe rather
    // than about how an endpoint name happens to be derived.
    `const fmpEndpointLabel = (u) => u;\n` +
    `export const seen = [];\n` +
    `const console = { warn: (m) => seen.push(m) };\n` +
    `${warnFn}\nexport { warnIfTooBigToCache, NEXT_DATA_CACHE_MAX_BYTES };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
).outputText;
const w = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const MB = 1024 * 1024;

console.log("\n=== 2. It fires on exactly the case that fails green ===\n");
check("the limit is Next's 2 MB", w.NEXT_DATA_CACHE_MAX_BYTES === 2 * MB, String(w.NEXT_DATA_CACHE_MAX_BYTES));

w.warnIfTooBigToCache("/stock-list", { next: { revalidate: 300 } }, 3 * MB);
check("over the limit WITH a revalidate warns", w.seen.length === 1, w.seen[0]?.slice(0, 50) ?? "silent");
check("the warning names the actual size", /3\.0 MB/.test(w.seen[0] ?? ""), (w.seen[0] ?? "").slice(0, 70));
check("...and says the revalidate is inert", /INERT/.test(w.seen[0] ?? ""));

console.log("\n=== 3. And on nothing else ===\n");
// A guard that fires on every large response is a guard someone turns off.
w.warnIfTooBigToCache("/small", { next: { revalidate: 300 } }, 1 * MB);
check("under the limit is silent", w.seen.length === 1, "a 1 MB body caches fine");

w.warnIfTooBigToCache("/uncached", undefined, 9 * MB);
check(
  "over the limit with NO revalidate is silent",
  w.seen.length === 1,
  "an uncached fetch is not trying to cache anything — this is not size police"
);

w.warnIfTooBigToCache("/nocache", { next: { revalidate: false } }, 9 * MB);
check("revalidate:false is silent too", w.seen.length === 1, "explicitly opted out");

w.warnIfTooBigToCache("/stock-list", { next: { revalidate: 300 } }, 3 * MB);
check("it dedupes per endpoint", w.seen.length === 1, "a hot path must not fill the log with one fact");

console.log("\n=== 4. The boundary ===\n");
w.warnIfTooBigToCache("/exact", { next: { revalidate: 60 } }, 2 * MB);
check("exactly at the limit is fine", w.seen.length === 1);
w.warnIfTooBigToCache("/over", { next: { revalidate: 60 } }, 2 * MB + 1);
check("one byte over is not", w.seen.length === 2);

console.log("\n=== 5. It is wired into the metered fetch ===\n");
// Extracted-and-run proves the behaviour; this proves anything calls it.
const usageCode = stripComments(usageSrc, { file: USAGE });
check(
  "fmpFetch calls it with the body size it already computed",
  /warnIfTooBigToCache\(url, init, body\.byteLength\);/.test(usageCode),
  "no second read of the body — it is measuring what the meter already measured"
);

console.log("\n=== 6. The known instance's comment no longer claims otherwise ===\n");
// The pickers self-fetch described a dedupe the 2 MB limit prevents. A comment
// asserting behaviour the code does not have is the same failure this whole
// suite exists to catch, one layer down from the code.
const pickersPage = fs.readFileSync(path.join(ROOT, "app/pickers/page.tsx"), "utf8");
check(
  "the pickers self-fetch is annotated as inert",
  /THE `revalidate` BELOW IS INERT/.test(pickersPage),
  "it still carries next.revalidate, which is a harmless no-op — the marker is the point"
);
check(
  "and the old claim is gone",
  !/don't even need to\s*\n?\s*\/\/ re-hit the route/.test(pickersPage)
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
