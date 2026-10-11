// The earnings store has two writers now, and they must stay one store.
//
// WHAT CHANGED. warm-earnings has populated msh:pickers:earnings:v1:<SYM> since
// it was written; lib/latest-earnings-data.ts -- the render path reached from
// three /stock/* pages and the dashboard -- ignored it and fetched FMP itself
// behind a 24h revalidate. That cost is driven by DISTINCT SYMBOLS RENDERED PER
// DAY rather than traffic, because the 24h cache collapses repeats, so it scales
// with how many stock pages exist: ~616 calls/day, ~1.3 GB/month at 3,000
// symbols.
//
// THE FAILURE THIS GUARDS. Both sides now WRITE. If they stop sharing the
// normaliser or the key, one writer starts producing rows the other would not
// have written, into a store neither owns -- and the symptom is not an error but
// a page rendering slightly different earnings depending on which writer got
// there first. Nothing throws.
//
//   node scripts/check-earnings-store.mjs
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const store = readCodeOnly("lib/server/earningsStore.ts");
const render = readCodeOnly("lib/latest-earnings-data.ts");
const cron = readCodeOnly("app/api/jobs/warm-earnings/route.ts");

console.log("\n=== 1. The render path reads the store ===\n");

check(
  "it reads Redis before reaching for FMP",
  /readEarningsRows\(symbol\)/.test(render),
  "this is the whole saving: a symbol the cron already fetched costs zero FMP calls to render"
);
check(
  "a miss still fetches rather than rendering nothing",
  /if \(stored\?\.length\) return/.test(render) && /fetchFmpJson<FmpStableEarningsItem\[\]>/.test(render),
  "earnings on a stock page is content the reader came for -- a cold symbol must not show an empty section"
);
check(
  "a miss POPULATES the store",
  /await writeEarningsRows\(symbol, rows\)/.test(render),
  "without this a cold symbol refetches every 24h forever, which is the cost this change exists to remove"
);
check(
  "the populate is awaited, not fired and forgotten",
  /await writeEarningsRows/.test(render),
  "a serverless request can end before a detached promise resolves, so the store would silently never fill"
);

console.log("\n=== 2. One store, one shape ===\n");

check(
  "the key prefix is defined once, in the store",
  /EARNINGS_REDIS_KEY_PREFIX = "msh:pickers:earnings:v1:"/.test(store) &&
    !/= "msh:pickers:earnings:v1:"/.test(cron),
  "two literals is how a rename fixes one writer and orphans the other's rows"
);
check(
  "the cron imports the shared key rather than redeclaring it",
  /STORE_KEY_PREFIX/.test(cron),
  "the store is shared, so its address has to be too"
);
check(
  "the normaliser is defined once, in the store",
  /export function normalizeEarningsRows/.test(store) &&
    !/^function normalizeEarningsRows/m.test(cron),
  "two normalisers could disagree about what a null EPS is, in rows both sides write"
);
check(
  "both writers use it",
  /normalizeEarningsRows/.test(cron) && /normalizeEarningsRows/.test(render),
  "a row written by one writer must be a row the other would have written"
);
check(
  "the TTL rule is defined once, in the store",
  /export function computeEarningsTtlSeconds/.test(store) &&
    !/^function computeEarningsTtlSeconds/m.test(cron),
  "a render-path write on a flat TTL would outlive the report it describes"
);

console.log("\n=== 3. The store's own rules ===\n");

check(
  "an empty result is never written",
  /if \(!redis \|\| !rows\.length\) return;/.test(store),
  "no rows and a failed fetch are indistinguishable here, and caching the second as the first would hold a blank page for up to a quarter"
);
check(
  "a read failure returns null rather than throwing",
  /catch \{[\s\S]{0,120}return null;/.test(store),
  "the caller falls back to FMP; a throw here would blank a page instead"
);
check(
  "the client passes PAGE_READ_CACHE",
  /Redis\.fromEnv\(PAGE_READ_CACHE\)/.test(store),
  "this module is on the render path of /stock/[symbol] and its two children"
);

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
