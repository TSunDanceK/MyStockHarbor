// Quotes have two entry points on purpose, and which one a caller uses decides
// whether a route can be prerendered.
//
// THE HISTORY. lib/server/quoteData.ts issues a literal `cache: "no-store"`
// fetch on a Redis miss. On a PRERENDERED route that throws
// DYNAMIC_SERVER_USAGE at request time -- a 500, not a fallback to dynamic --
// and it is why both insights routes were stuck dynamic. The module's own
// comment called it "THE REMAINING BLOCKER" and declined to fix it in an
// outage-recovery PR, because choosing a cache window is a freshness decision.
//
// THE SPLIT, AND WHY IT IS NOT JUST "WRAP IT". lib/youtube.ts wraps its own
// no-store fetches in unstable_cache and every consumer gets the cache, which
// is free there because its only consumers are page renders. Quotes have a
// third consumer: /api/quote, which is force-dynamic and answers
// Cache-Control: no-store. unstable_cache sits IN FRONT of the 60s Redis TTL,
// so a value served from it can be written back to Redis with a fresh TTL --
// worst case ~60s becomes ~120s. Immaterial on pages cached for 30 minutes and
// 24 hours; a real regression on an endpoint whose contract is to be live.
//
// So: fetchQuoteSnapshotForRender for renders, fetchQuoteSnapshot for the live
// endpoint. Getting that backwards is silent in both directions -- a render
// using the live path 500s only once the route is actually prerendered, and the
// API using the cached path just quietly serves staler prices.
//
//   node scripts/check-quote-render-path.mjs
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const quote = readCodeOnly("lib/server/quoteData.ts");

// `fetchQuoteSnapshotForRender` contains `fetchQuoteSnapshot` as a prefix, so
// every test for the live name has to exclude it explicitly. A plain
// .includes() here would report the render path as using the live entry point.
const usesLive = (src) => /fetchQuoteSnapshot(?!ForRender)\s*\(/.test(src);

console.log("\n=== 1. The two entry points exist and differ ===\n");

check(
  "the uncached fetch is named as such",
  /async function fetchQuoteFromFmpUncached\(/.test(quote),
  "matches the *Uncached naming lib/youtube.ts already uses for the same split"
);
check(
  "a cached wrapper exists over it",
  /const fetchQuoteFromFmpCached[\s\S]{0,200}unstable_cache\([\s\S]{0,200}fetchQuoteFromFmpUncached/.test(quote),
  "the wrapper is what a render path reaches instead of the no-store call"
);
check(
  "the wrapper's revalidate reuses the module's own TTL",
  /revalidate: QUOTE_CACHE_TTL_SECONDS/.test(quote),
  "a second freshness layer at a different granularity is a number nobody can reconcile with the first"
);
check(
  "only one literal no-store fetch remains in the module",
  (quote.match(/cache: "no-store"/g) ?? []).length === 1,
  "a second one would need its own wrapper and would not be covered by the split above"
);
check(
  "both entry points are exported",
  /export async function fetchQuoteSnapshot\(/.test(quote) &&
    /export async function fetchQuoteSnapshotForRender\(/.test(quote),
  "the live path stays available precisely so the API route is not slowed to fix a render problem"
);

console.log("\n=== 2. Render paths use the cached entry point ===\n");

for (const mod of ["lib/insightSnapshots.ts", "lib/videoStockData.ts"]) {
  const src = readCodeOnly(mod);
  check(
    `${mod} uses fetchQuoteSnapshotForRender`,
    /fetchQuoteSnapshotForRender\s*\(/.test(src),
    "this module is on a page's read path, so the live entry point would put a no-store fetch inside a render"
  );
  check(
    `${mod} does NOT call the live entry point`,
    !usesLive(src),
    "mixing the two in one module reintroduces the blocker through whichever call is on the render path"
  );
}

console.log("\n=== 3. The live endpoint was not slowed down to fix it ===\n");

const api = readCodeOnly("app/api/quote/route.ts");
check(
  "/api/quote still uses the live entry point",
  usesLive(api),
  "it is force-dynamic and answers no-store; routing it through the cache would double its staleness for no benefit"
);
check(
  "/api/quote is still force-dynamic",
  /export const dynamic = "force-dynamic"/.test(api),
  "the whole argument for leaving it on the live path is that it is never prerendered"
);

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
