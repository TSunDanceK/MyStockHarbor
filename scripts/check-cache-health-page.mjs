// Pins the cache health page's security and cost properties, because every one
// of them is invisible once removed.
//
// Deleting `export const dynamic = "force-dynamic"` does not break a build, a
// type or a test. It turns the page into a prerendered route whose transitive
// path reaches a bare `Redis.fromEnv()` in backfillAuth.ts:16, and a no-store
// Redis call on a prerendered route throws DYNAMIC_SERVER_USAGE at request time
// -- a 500 on every request, which is the production outage documented in
// claude/traps/a-visible-failure-is-not-a-harmless-one.md and reverted in #323.
//
// The same is true of the rest: a page that quietly starts scanning still
// renders, a page that loses `noindex` still renders, and a page that gains a
// write control still renders. All four fail silently and all four are checked.
//
//   node scripts/check-cache-health-page.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PAGE = "app/cache-health/page.tsx";
const src = fs.readFileSync(path.join(ROOT, PAGE), "utf8");

// Comments in this page explain the very constructs being asserted, so prose
// would satisfy several of these checks
// (claude/traps/grep-finds-the-comment-not-the-code.md).
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .split("\n")
  .map((l) => (l.trim().startsWith("//") ? "" : l))
  .join("\n");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("\n=== 1. Never prerendered ===\n");
check(
  'exports dynamic = "force-dynamic"',
  /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/.test(code)
);
check(
  "reaches backfillAuth, which is why the above is mandatory",
  /backfillAuth/.test(code),
  "scripts/check-static-safety.mjs flags backfillAuth.ts:16 as a bare Redis.fromEnv()"
);

console.log("\n=== 2. Owner-only, with its OWN key ===\n");
check("gated on checkCacheHealthKey", /checkCacheHealthKey\s*\(/.test(code));
check("rate-limited by its own lockout", /checkCacheHealthLockout\s*\(/.test(code) && /recordCacheHealthFailure\s*\(/.test(code));
check(
  "does NOT reuse EARNINGS_BACKFILL_KEY",
  !/checkBackfillKey\s*\(/.test(code) && !/EARNINGS_BACKFILL_KEY/.test(code)
);
check("does NOT reuse CRON_SECRET", !/CRON_SECRET/.test(code));

const auth = fs.readFileSync(path.join(ROOT, "lib/server/backfillAuth.ts"), "utf8");
check("its key is CACHE_HEALTH_KEY, and fails closed when unset", /CACHE_HEALTH_KEY/.test(auth) && /if \(!expected \|\| !submitted\) return false;/.test(auth));
check(
  "its lockout namespace is separate from the backfill one",
  /msh:cache-health-fail/.test(auth) && /msh:earnings-backfill-fail/.test(auth)
);

console.log("\n=== 3. READ-ONLY — nothing here can spend an FMP call ===\n");
// The spec's first security rule. A shared key or a stray import is what turns
// a stats page into unbounded spend against a cap already at 73.6%.
const WRITE_SYMBOLS = [
  "warmFundamentals",
  "warmPricePool",
  "refreshScreenerFundamentals",
  "fmpFetch",
  "reserveFmpCallSlot",
  "ensureQualifiedHistory",
  "markRefreshed",
  "deferSymbol",
  "registerSymbols",
  "recordJobRun",
];
for (const sym of WRITE_SYMBOLS) {
  check(`does not import or call ${sym}`, !new RegExp(`\\b${sym}\\b`).test(code));
}
check("no form, button or action element at all", !/<form|<button|"use server"|formAction/.test(code));

console.log("\n=== 4. Cheap: aggregates only, never a scan ===\n");
// If the page ever needs a full scan to answer something, that answer belongs
// in a counter instead (spec, "The page must be cheap to load").
const SCAN_SYMBOLS = ["readCachedFundamentalsBulk", "readPricePoolBulk", "getDailyHistoryBulk", "hgetall", "keys(", "scan("];
for (const sym of SCAN_SYMBOLS) {
  check(`does not use ${sym}`, !code.includes(sym));
}
check(
  "reads only the aggregate helpers",
  /readAllDatasetHealth\s*\(/.test(code) && /readFmpUsage\s*\(/.test(code) && /readJobRuns\s*\(/.test(code)
);

console.log("\n=== 5. Status is per-dataset TTL, not a global threshold ===\n");
check(
  "compares against each dataset's own ttlSeconds",
  /ttlSeconds/.test(code) && /d\.stale/.test(code),
  "a 30-day-old profile is healthy; a 30-day-old price is a fault"
);
check(
  "no hardcoded global staleness constant",
  !/stale\s*=\s*24|STALE_HOURS|GLOBAL_STALE/.test(code)
);
const queue = fs.readFileSync(path.join(ROOT, "lib/server/stalenessQueue.ts"), "utf8");
check("every registered dataset declares its own ttlSeconds", (queue.match(/ttlSeconds:/g) ?? []).length >= 5);

console.log("\n=== 6. Unlinked and unindexed ===\n");
check("noindex + nofollow", /index:\s*false/.test(code) && /follow:\s*false/.test(code));
const sitemap = fs.readFileSync(path.join(ROOT, "app/sitemap.ts"), "utf8");
check("absent from app/sitemap.ts", !sitemap.includes("cache-health"));
// Linked from nowhere. Searched across the app, excluding the page itself.
const linkers = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(e.name)) {
      const rel = path.relative(ROOT, full);
      if (rel === PAGE) continue;
      const body = fs.readFileSync(full, "utf8");
      if (/href=["'`]\/cache-health/.test(body)) linkers.push(rel);
    }
  }
};
walk(path.join(ROOT, "app"));
check("linked from nowhere", linkers.length === 0, linkers.join(", "));

console.log("\n=== 7. The queue defers rather than excludes ===\n");
check(
  "deferral lives in its own set, so it cannot fake freshness",
  /DEFER_PREFIX/.test(queue) && !/score:\s*Date\.now\(\)\s*\+\s*seconds[\s\S]{0,80}queueKey/.test(queue)
);
check("expired deferrals are pruned on claim", /zremrangebyscore/.test(queue));
check("one queue per dataset, never a shared one", /const queueKey = \(dataset: DatasetKey\)/.test(queue));
check(
  "budget stays external — claimStalest takes a limit, never chooses one",
  /export async function claimStalest\(\s*dataset: DatasetKey,\s*limit: number/.test(queue) &&
    !/MAX_PER_RUN|budget/.test(queue)
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
