// A DERIVED CACHE THAT NOBODY CAN DROP IS A REPAIR THAT NOBODY CAN SHIP.
//
// /upcoming-ipos does not read msh:ipo:filings:v1. It reads a derived feed that
// readFeed serves from Redis for 24 hours WITHOUT calling the fetcher. On
// 2026-09-21 that produced a failure with no obvious suspect: the store was
// repaired and verified through a debug route, two production redeploys were
// confirmed READY and aliased, and the page still rendered the pre-repair rows.
// Both ends checked out. The layer between them had never been looked at, and a
// redeploy cannot clear it -- a redeploy clears the in-memory tier, and Redis is
// precisely what that tier falls back to.
//
// Two rules come out of it, and both are here because both are invisible:
//
//   1. Whoever rewrites a source key must be able to drop what was derived from
//      it. invalidateFeed is that, and the control below is the half that
//      matters -- a "cache" that refetches every time would pass an
//      invalidation test trivially while costing an upstream call per render.
//
//   2. The derived key must be NAMESPACED BY PROVIDER. One entry shared by fmp
//      and sec means a flip serves the old provider's rows under the new
//      provider's chrome for up to 24h, with the footer, the column labels and
//      the intro copy all saying the flip worked.
//
//   node scripts/check-feed-invalidation.mjs
import "./lib/register-ts-here.mjs";

const { readFeed, invalidateFeed } = await import("../lib/server/feedCache.ts");
const { ipoFeedKey } = await import("../lib/server/ipoCalendar.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("\n1. invalidateFeed drops the cached copy, and the cache is a cache");

{
  let calls = 0;
  const key = `test:invalidation:${Date.now()}`;
  const fetcher = async () => {
    calls += 1;
    return [{ n: calls }];
  };

  const first = await readFeed(key, fetcher, { freshSeconds: 3600 });
  check(
    "a cold read goes upstream",
    calls === 1 && first.items[0].n === 1,
    `calls=${calls} source=${first.source}`
  );

  // THE CONTROL. If this refetched, the assertion after the invalidation would
  // pass no matter what invalidateFeed did -- including doing nothing at all.
  const second = await readFeed(key, fetcher, { freshSeconds: 3600 });
  check(
    "CONTROL — a warm read does NOT go upstream",
    calls === 1 && second.items[0].n === 1,
    `calls=${calls} source=${second.source} — if this is 2, the invalidation test below proves nothing`
  );

  await invalidateFeed(key);

  const third = await readFeed(key, fetcher, { freshSeconds: 3600 });
  check(
    "after invalidateFeed the next read goes upstream again",
    calls === 2 && third.items[0].n === 2,
    `calls=${calls} source=${third.source} — a store repair reaches the page only through this`
  );
}

console.log("\n2. The derived feed key is namespaced by provider");

{
  const sec = ipoFeedKey("sec");
  const fmp = ipoFeedKey("fmp");
  check("the sec key names the provider", sec === "ipo:all:sec", `got ${sec}`);
  check("the fmp key names the provider", fmp === "ipo:all:fmp", `got ${fmp}`);
  check(
    "and the two DIFFER — one shared entry is a flip that does not take effect",
    sec !== fmp,
    `sec=${sec} fmp=${fmp} — sharing it serves the old provider's rows under the new provider's footer, labels and copy`
  );
}

console.log(
  failures === 0
    ? "\nA repaired source can reach the page, and a flip cannot serve the other provider.\n"
    : `\n${failures} fixture(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
