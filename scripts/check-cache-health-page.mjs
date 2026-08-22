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

// EVERY source read here goes through this. The first version stripped comments
// from the page and read backfillAuth.ts, stalenessQueue.ts and sitemap.ts RAW,
// which made this script an instance of the exact trap it was written to guard
// against (claude/traps/grep-finds-the-comment-not-the-code.md).
//
// It was not theoretical. `/CACHE_HEALTH_KEY/.test(auth)` was satisfied by the
// COMMENT on backfillAuth.ts:79 explaining the key, so pointing the actual read
// at EARNINGS_BACKFILL_KEY -- sharing the key that authorises FMP spend, the
// single thing the spec forbids most emphatically -- left all 33 checks passing.
// Reported by the owner and reproduced before fixing.
//
// The lesson generalises past this file: a checker that reads one source
// carefully and the rest casually is only as good as its most casual read.
const codeOf = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .split("\n")
    .map((l) => (l.trim().startsWith("//") ? "" : l))
    .join("\n");

const readCode = (rel) => codeOf(fs.readFileSync(path.join(ROOT, rel), "utf8"));

const code = codeOf(src);

// For "does it USE this symbol" questions, string literals are blanked too.
//
// The read-only check reads `!/\brecordJobRun\b/.test(code)` and is labelled
// "does not import or call". Adding the words "this job does not call
// recordJobRun" to the page's own help text failed it -- a true detection of
// the wrong thing, since a mention in prose is neither an import nor a call.
// Left as-is it would have forced the page to talk around the identifier it
// needs to name, which is the check bending the code rather than guarding it.
const codeNoStrings = code
  .replace(/`(?:[^`\\]|\\.)*`/g, "``")
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/'(?:[^'\\]|\\.)*'/g, "''");

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

const auth = readCode("lib/server/backfillAuth.ts");
// Both halves matter, and presence of the NAME is not one of them. This asserts
// the actual read -- `const expected = process.env.CACHE_HEALTH_KEY` -- so a
// checkCacheHealthKey rewired to any other variable fails here regardless of
// what the surrounding prose still says.
check(
  "checkCacheHealthKey READS process.env.CACHE_HEALTH_KEY",
  /const expected = process\.env\.CACHE_HEALTH_KEY\s*;/.test(auth)
);
check(
  "...and no other env var is read inside it",
  !/export function checkCacheHealthKey[\s\S]*?process\.env\.(?!CACHE_HEALTH_KEY)[A-Z_]+/.test(auth)
);
check("...and it fails closed when unset", /if \(!expected \|\| !submitted\) return false;/.test(auth));
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
  check(`does not import or call ${sym}`, !new RegExp(`\\b${sym}\\b`).test(codeNoStrings));
}
check("no form, button or action element at all", !/<form|<button|"use server"|formAction/.test(code));

console.log("\n=== 4. Cheap: aggregates only, never a scan ===\n");
// If the page ever needs a full scan to answer something, that answer belongs
// in a counter instead (spec, "The page must be cheap to load").
const SCAN_SYMBOLS = ["readCachedFundamentalsBulk", "readPricePoolBulk", "getDailyHistoryBulk", "hgetall", "keys(", "scan("];
for (const sym of SCAN_SYMBOLS) {
  check(`does not use ${sym}`, !codeNoStrings.includes(sym));
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
const queue = readCode("lib/server/stalenessQueue.ts");
check("every registered dataset declares its own ttlSeconds", (queue.match(/ttlSeconds:/g) ?? []).length >= 5);

console.log("\n=== 5b. Seeded is not faulted, and cannot stay neutral forever ===\n");
// registerSymbols scores the whole universe 0, so a freshly instrumented
// dataset reads "every symbol never refreshed" -- and the first version painted
// that red. That is the jobs table's own bug one level down: unobserved
// rendering as failed. The fix has to cut BOTH ways, though: a neutral status a
// dead dataset can sit in forever is the same lie inverted, so the escalation
// is asserted alongside it.
check(
  'a distinct "seeded" status exists, separate from "unknown"',
  /"seeded"/.test(code) && /type Status = [^;]*"seeded"/.test(code)
);
check(
  "...with its own colour, not reusing a judged one",
  /seeded:\s*"#/.test(code)
);
check(
  "all-never no longer returns a bare fault",
  !/if \(d\.never === d\.tracked && d\.tracked > 0\) \{\s*return \{ status: "fault"/.test(code)
);
check(
  "...and DOES escalate to fault once past a multiple of its own TTL",
  /seededAgoSec > d\.ttlSeconds \* 2/.test(code) && /status: "fault"[\s\S]{0,120}nothing has ever refreshed/.test(code),
  "a neutral status nothing can escalate is a dead dataset reading calm forever"
);
check(
  "missing seed time is reported as unjudgeable, not assumed fresh",
  /d\.seededAtMs === null[\s\S]{0,200}seed time unknown/.test(code)
);
check(
  "the seed timestamp is written nx, so it records the FIRST seed and never moves",
  /p\.set\(seededKey\(dataset\), Date\.now\(\), \{ nx: true \}\)/.test(queue),
  "a refreshing timestamp would keep the status permanently young"
);
check(
  "staleness is judged against the OBSERVED population, not the tracked one",
  /const observed = Math\.max\(0, d\.tracked - d\.never\)/.test(code) && /d\.stale \/ observed/.test(code),
  "otherwise 'went stale' and 'not reached yet' are the same number"
);
check(
  "...and a mostly-unobserved dataset still cannot read ok",
  /d\.never \/ d\.tracked >= 0\.25[\s\S]{0,160}status: "warn"/.test(code)
);

console.log("\n=== 5c. The FMP rolling window, pinned ===\n");
// Reviewed 2026-08-22 and correct as written. Pinned because the two plausible
// "corrections" -- anchoring to a calendar month, or widening past the 31-day
// key TTL -- both make it silently wrong, and both look like fixes.
const usage = readCode("lib/server/fmpUsage.ts");
check(
  "readFmpUsage still defaults to a 30-day window",
  /export async function readFmpUsage\(days = 30\)/.test(usage)
);
check(
  "...clamped to 31, so it can never sum buckets the TTL has already dropped",
  /Math\.min\(31,/.test(usage) && /FMP_BYTES_TTL_SECONDS = 60 \* 60 \* 24 \* 31/.test(usage)
);
check(
  "...and it is a rolling window ending today, not a calendar month",
  /d\.setUTCDate\(d\.getUTCDate\(\) - i\)/.test(usage) && !/getUTCMonth\(\)\s*,\s*1/.test(usage)
);
check(
  "the page asks for 30 and does not override it with something else",
  /readFmpUsage\(30\)/.test(code)
);
// The meter's real limitation, recorded where a reader of the totals will meet
// it. fmpFetch cannot see a Next Data Cache hit, so the totals are an upper
// bound on wire bytes rather than a measurement of them -- and quoting them as
// a measurement is exactly the layer confusion this project has paid for before.
check(
  "fmpFetch says plainly that it counts call sites, not wire bytes",
  /UPPER BOUND/.test(fs.readFileSync(path.join(ROOT, "lib/server/fmpUsage.ts"), "utf8")),
  "a Data Cache hit records a sample with no network request"
);

console.log("\n=== 6. Unlinked and unindexed ===\n");
check("noindex + nofollow", /index:\s*false/.test(code) && /follow:\s*false/.test(code));
const sitemap = readCode("app/sitemap.ts");
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
      const body = codeOf(fs.readFileSync(full, "utf8"));
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

console.log("\n=== 8. Every declaration has a producer behind it ===\n");
// THE FAILURE THIS SECTION EXISTS FOR, reported by the owner and reproduced.
// The jobs table listed six jobs and only two called recordJobRun, so
// warm-price-pool -- which runs every three minutes -- rendered "never run, or
// older than the 8-day record TTL". An uninstrumented job read exactly like a
// dead one: the failure this whole page was built to remove, reproduced inside
// it. The same hole existed on the dataset side, where screenerFundamentals sat
// in the registry with nothing writing to its queue.
//
// A registry entry is a DECLARATION. Nothing made the declaration true, so both
// are now verified against the tree: a job declared instrumented must have a
// recordJobRun call, and a registered dataset must have a markRefreshed or
// registerSymbols call.
const treeFiles = [];
const collect = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full);
    else if (/\.tsx?$/.test(e.name)) treeFiles.push(full);
  }
};
collect(path.join(ROOT, "app"));
collect(path.join(ROOT, "lib"));
const tree = treeFiles.map((f) => codeOf(fs.readFileSync(f, "utf8"))).join("\n");

const jobs = readCode("lib/server/jobRuns.ts");
const jobEntries = [...jobs.matchAll(/"([a-z-]+)":\s*\{\s*label:[^}]*instrumented:\s*(true|false)/g)];
check("the JOBS registry declares instrumentation per job", jobEntries.length >= 6, `${jobEntries.length} entries`);
for (const [, job, flag] of jobEntries) {
  const has = new RegExp(`recordJobRun\\(\\s*"${job}"`).test(tree);
  if (flag === "true") {
    check(`${job}: declared instrumented AND calls recordJobRun`, has);
  } else {
    check(`${job}: declared NOT instrumented, and indeed does not record`, !has);
  }
}

const datasetKeys = [...readCode("lib/server/stalenessQueue.ts").matchAll(/^  ([a-zA-Z]+):\s*\{$/gm)].map((m) => m[1]);
check("the DATASETS registry has entries", datasetKeys.length >= 6, datasetKeys.join(", "));
for (const ds of datasetKeys) {
  const has =
    new RegExp(`markRefreshed\\(\\s*"${ds}"`).test(tree) ||
    new RegExp(`registerSymbols\\(\\s*"${ds}"`).test(tree);
  check(`${ds}: something actually writes to its queue`, has);
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
