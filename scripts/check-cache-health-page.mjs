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
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

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
// Comments stripped with the real tokeniser, and guarded -- see scripts/lib/source-code.mjs.
const codeOf = (text, file) => stripComments(text, { file });

const readCode = (rel) => codeOf(fs.readFileSync(path.join(ROOT, rel), "utf8"), rel);

const code = codeOf(src, PAGE);

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
// CALL-OR-IMPORT, NOT BARE WORD. The bare-word form fired on the page's own
// legend text, which names registerSymbols in prose to explain what "N seen"
// means -- a false positive that would have been "fixed" by making the page
// vaguer. A call needs parentheses and a reference needs an import, so both
// forms are asserted and neither can be reached by writing the name in JSX.
for (const sym of WRITE_SYMBOLS) {
  const calls = new RegExp(`\\b${sym}\\s*\\(`).test(codeNoStrings);
  const imports = new RegExp(`import[\\s\\S]{0,200}?\\b${sym}\\b[\\s\\S]{0,200}?from`).test(codeNoStrings);
  check(`does not import or call ${sym}`, !calls && !imports);
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

console.log("\n=== 5d. Meter vs dashboard reconciliation ===\n");
// The meter says 14.72 GB and nothing has ever checked that against the only
// number that bills. /api/debug/fmp-usage?dashboardGb= does the comparison; the
// arithmetic is extracted and run here, because the route itself needs Redis and
// a key and so is not exercisable from a check.
const usageRouteSrc = fs.readFileSync(path.join(ROOT, "app/api/debug/fmp-usage/route.ts"), "utf8");
const usageSf = ts.createSourceFile("route.ts", usageRouteSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let reconFn = null;
const findRecon = (node) => {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "buildReconciliation") reconFn = node.getText(usageSf);
  ts.forEachChild(node, findRecon);
};
findRecon(usageSf);

if (!reconFn) {
  check("buildReconciliation is extractable", false, "measuring nothing");
} else {
  const reconJs = ts.transpileModule(
    `const GB = 1024 ** 3;\n${reconFn}\nexport { buildReconciliation };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
  ).outputText;
  const { buildReconciliation } = await import(
    `data:text/javascript;base64,${Buffer.from(reconJs).toString("base64")}`
  );

  const GB = 1024 ** 3;
  const rep = (opts) => ({
    days: 30,
    daysWithData: 10,
    totalWireBytes: 5 * GB,
    totalDecodedBytes: 5 * GB,
    ...opts,
  });

  check(
    "no dashboard figure -> says so, does not invent a ratio",
    buildReconciliation(rep({}), NaN).done === false
  );
  // THE FAILURE THIS GUARDS. The meter started on 2026-08-22, so for weeks a
  // 30-day dashboard figure sits against a 2-day meter reading. Comparing the
  // raw totals gives ~0.07 and the false conclusion "the meter is catastrophically
  // undercounting" -- a wrong answer of exactly the kind that gets acted on.
  check(
    "2 days of counters vs a 30-day dashboard figure -> refuses, does not compare",
    buildReconciliation(rep({ daysWithData: 2 }), 14.72).done === false
  );
  check(
    "...and it is normalised PER DAY once there is enough, not total vs total",
    (() => {
      // 10 covered days at 0.5 GB/day; dashboard 15 GB over 30 days = 0.5 GB/day.
      const r = buildReconciliation(rep({ daysWithData: 10, totalWireBytes: 5 * GB }), 15);
      return r.done === true && Math.abs(r.wireRatio - 1) < 0.01;
    })(),
    "raw totals would read 5 vs 15 and call it a 3x undercount"
  );
  check(
    "a meter running high reads as EXPECTED, not as a fault",
    /EXPECTED direction/.test(
      buildReconciliation(rep({ totalWireBytes: 15 * GB, totalDecodedBytes: 15 * GB }), 15).verdict
    ),
    "cached responses record a sample with no network request"
  );
  check(
    "a meter running LOW is flagged as the surprising direction",
    /surprising/.test(buildReconciliation(rep({ totalWireBytes: 1 * GB, totalDecodedBytes: 1 * GB }), 15).verdict),
    "something is calling FMP without going through fmpFetch"
  );
  check(
    "it names which layer is closer rather than asserting one",
    buildReconciliation(rep({ totalWireBytes: 5 * GB, totalDecodedBytes: 9 * GB }), 15).closerLayer === "wire"
  );
}

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
      const body = codeOf(fs.readFileSync(full, "utf8"), path.relative(ROOT, full));
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
const tree = treeFiles.map((f) => codeOf(fs.readFileSync(f, "utf8"), path.relative(ROOT, f))).join("\n");

const jobs = readCode("lib/server/jobRuns.ts");
const jobEntries = [...jobs.matchAll(/"([a-z-]+)":\s*\{\s*label:[^}]*instrumented:\s*(true|false)/g)];
check("the JOBS registry declares instrumentation per job", jobEntries.length >= 6, `${jobEntries.length} entries`);

// THE CRON IS A DECLARATION TOO. The page now judges a job's silence against
// its stated cadence -- a daily job quiet since deploy is neutral, a 3-minute
// job quiet is a fault -- so a registry cron that has drifted from vercel.json
// makes the page confidently wrong in whichever direction the drift went. Same
// treatment as `instrumented`: verified against reality, not trusted.
const vercelCrons = new Map(
  (JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")).crons ?? []).map((c) => [
    String(c.path).replace("/api/jobs/", ""),
    String(c.schedule),
  ])
);
const registryCrons = new Map(
  [...jobs.matchAll(/"([a-z-]+)":\s*\{[^}]*cron:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]])
);
check("every job in the registry declares a cron", registryCrons.size === jobEntries.length, `${registryCrons.size} of ${jobEntries.length}`);
for (const [job, cron] of registryCrons) {
  check(
    `${job}: registry cron matches vercel.json`,
    vercelCrons.get(job) === cron,
    `registry "${cron}" vs vercel.json "${vercelCrons.get(job) ?? "ABSENT"}"`
  );
}
// And the other direction: a scheduled job with no registry entry is invisible
// on the page entirely, which is the absence this whole page exists to end.
for (const [job] of vercelCrons) {
  check(`${job}: scheduled in vercel.json AND present in the registry`, registryCrons.has(job));
}
// THE DATASET TABLE MUST NOT CARRY ITS OWN COPY OF A SCHEDULE. It used to: the
// DATASETS entries in stalenessQueue.ts spelled out "every 3 min" and "daily
// 07:00" as prose, and nothing compared them to anything. The 2026-08-31 cron
// stagger (#374) made both false within the hour, so /cache-health told readers
// the price pool refreshed every three minutes and history warmed at 07:00 when
// neither had been true since the deploy. The cadence is now composed from the
// JOBS registry by describeCron, and these two checks are what stop a future
// edit quietly reintroducing a hand-typed one.
const staleness = readCode("lib/server/stalenessQueue.ts");
const datasetJobs = [...staleness.matchAll(/job:\s*"([a-z-]+)"/g)].map((m) => m[1]);

// EITHER A JOB OR AN EXPLICIT "no cron", never neither. A lazily populated
// dataset (news, sectorNews) has no cron by design, so requiring a job for
// every entry would force someone to invent a job name that does not exist just
// to satisfy the shape -- which is how the page ends up naming a cron nobody
// runs. Counting both variants against the entry total is what stops a dataset
// being added that declares neither and prints a blank cadence.
const datasetEntryCount = [...staleness.matchAll(/^  ([a-zA-Z]+):\s*\{$/gm)].length;
const lazyDatasets = (staleness.match(/population: "on-demand",/g) ?? []).length;

check(
  "every dataset either names a warm job or declares lazy population",
  datasetJobs.length + lazyDatasets === datasetEntryCount,
  `an entry declaring neither would render an empty cadence — ${datasetJobs.length} scheduled + ${lazyDatasets} lazy of ${datasetEntryCount}`
);
for (const job of new Set(datasetJobs)) {
  check(`dataset job "${job}" exists in the JOBS registry`, registryCrons.has(job));
}
check(
  "no dataset hard-codes a cadence — it is composed from the registry",
  !/(?:label|note|qualifier):\s*"[^"]*(?:every \d+ min|daily \d{2}:\d{2}|hourly)/.test(staleness),
  "prose here cannot be diffed against the registry, so it drifts unnoticed"
);

for (const [, job, flag] of jobEntries) {
  const has = new RegExp(`recordJobRun\\(\\s*"${job}"`).test(tree);
  if (flag === "true") {
    check(`${job}: declared instrumented AND calls recordJobRun`, has);
  } else {
    check(`${job}: declared NOT instrumented, and indeed does not record`, !has);
  }
}

const stalenessSrc = readCode("lib/server/stalenessQueue.ts");
const datasetKeys = [...stalenessSrc.matchAll(/^  ([a-zA-Z]+):\s*\{$/gm)].map((m) => m[1]);
// ONE ENTRY'S OWN TEXT, NOT `${ds}: \{[\s\S]*?<field>`. That lazy form runs
// straight past the entry it names and finds the field in a LATER one: the
// first draft of the refreshWindow assertions below reported fundamentals,
// profile, screenerFundamentals and stockData as declaring a market-hours gate,
// because the nearest `refreshWindow:` after each of them is pricePool's. Four
// assertions failing for a reason unrelated to the code — and had the property
// been the other way round, four passing for one.
//
// The registry is one object with two-space-indented entries, so an entry ends
// at the next line that is exactly `  },`.
const datasetBlock = (ds) => {
  const start = stalenessSrc.indexOf(`\n  ${ds}: {`);
  if (start === -1) return "";
  const end = stalenessSrc.indexOf("\n  },", start);
  return end === -1 ? stalenessSrc.slice(start) : stalenessSrc.slice(start, end);
};
check(
  "each dataset entry can be isolated from its neighbours",
  datasetKeys.every((ds) => datasetBlock(ds).length > 0) &&
    !datasetBlock("fundamentals").includes("pricePool"),
  "a per-entry assertion written as a lazy match reads the NEXT entry's fields " +
    "— which is how four of these first reported the wrong answer"
);
check("the DATASETS registry has entries", datasetKeys.length >= 6, datasetKeys.join(", "));
for (const ds of datasetKeys) {
  const has =
    new RegExp(`markRefreshed\\(\\s*"${ds}"`).test(tree) ||
    new RegExp(`registerSymbols\\(\\s*"${ds}"`).test(tree);
  check(`${ds}: something actually writes to its queue`, has);
}

console.log("\n=== Coverage: a ratio of a set to itself is not coverage ===\n");
// THE DISTINCTION THE OLD CHECK COULD NOT DRAW. Above, markRefreshed OR
// registerSymbols counts as "a writer" -- and that is why dailyHistory passed
// while rendering "24 / 24, within policy" off a queue that contained only the
// symbols something had already refreshed. Every symbol that failed was missing
// from the denominator instead of counted against it, so the ratio was 100% by
// construction and could never have been anything else.
//
// The two writers do different jobs:
//   registerSymbols -> declares the DENOMINATOR (what ought to be fresh)
//   markRefreshed   -> supplies the NUMERATOR
//
// So the registry declares which kind each dataset is, and this asserts the
// declaration matches the tree in BOTH directions. Fixing dailyHistory once was
// not the point; the point is that the next dataset added without a denominator
// cannot render green.
for (const ds of datasetKeys) {
  const declared = /coverage:\s*"(registered|observed-only)"/.exec(datasetBlock(ds))?.[1];
  const registers = new RegExp(`registerSymbols\\(\\s*"${ds}"`).test(tree);
  check(`${ds}: declares a coverage kind`, Boolean(declared), declared ?? "MISSING");
  if (declared === "registered") {
    check(`${ds}: declared "registered" AND has a registerSymbols caller`, registers);
  } else if (declared === "observed-only") {
    check(
      `${ds}: declared "observed-only", and indeed nothing registers it`,
      !registers,
      "a stale declaration here would hide a real denominator, or invent one"
    );
  }
}

console.log("\n=== Refresh windows: idle because correct is not broken ===\n");
// SAME COUPLING AS `coverage`, ONE PROPERTY OVER. A dataset whose warm job
// refuses to run outside the trading window is SUPPOSED to be past its TTL for
// fifteen hours a day, and the page rendered that red every night -- correct
// wording, wrong colour, on a page whose whole job is being unambiguous at a
// glance. A permanent red is a red nobody reads.
//
// Declared in the registry, and asserted against the tree in BOTH directions,
// so a stale declaration cannot silence a dataset that is genuinely broken and
// a missing one cannot leave a gated dataset shouting.
const marketGatedJobs = new Set();
const GATED_MODULES = ["lib/server/pricePool.ts"];
for (const mod of GATED_MODULES) {
  if (/isActiveMarketWindow/.test(readCode(mod))) marketGatedJobs.add(mod);
}
check(
  "the module the declaration is about really gates on the trading window",
  marketGatedJobs.has("lib/server/pricePool.ts"),
  "warmPricePool returns { skipped: true, reason: 'market-closed' } outside " +
    "isActiveMarketWindow — if that ever stops being true the declaration is a lie"
);
for (const ds of datasetKeys) {
  const declared = /refreshWindow:\s*"market-hours"/.test(datasetBlock(ds));
  if (ds === "pricePool") {
    check(
      `${ds}: declares its market-hours gate`,
      declared,
      "without it the page reads 100% past TTL as a fault every night and all weekend"
    );
  } else {
    check(
      `${ds}: does NOT claim a market-hours gate`,
      !declared,
      "every other dataset runs on its own cron around the clock, and a false " +
        "declaration would silence a real failure"
    );
  }
}
check(
  "DatasetHealth carries the flag, derived from the registry",
  /marketHoursOnly:\s*boolean/.test(stalenessSrc) &&
    /def\.refreshWindow === "market-hours"/.test(stalenessSrc),
  "a field the page reads must be computed from the declaration, not typed twice"
);

// The page must act on it, not merely receive it. A field threaded through and
// then rendered identically is the same green panel with more code behind it.
const healthPage = readCode("app/cache-health/page.tsx");
check(
  "DatasetHealth carries coverageEstablished",
  /coverageEstablished:\s*boolean/.test(stalenessSrc) &&
    /coverageEstablished:\s*def\.coverage === "registered"/.test(stalenessSrc)
);
check(
  "statusFor returns a distinct status for an uncovered dataset",
  /if \(!d\.coverageEstablished\)/.test(healthPage) && /status: "uncovered"/.test(healthPage)
);
// RUN, NOT READ. The first version of this assertion compared the source
// positions of `status: "uncovered"` and `status: "ok"` -- and calibration
// showed it was worthless: moving the entire coverage branch down to sit just
// above the `return { status: "ok" }` line kept the text order intact while
// changing the control flow completely, and the check stayed green. That is
// claude/traps/measuring-the-wrong-layer.md exactly. The property is about which
// branch WINS, so the only honest test runs the function.
const statusFn = (() => {
  const pf = ts.createSourceFile(PAGE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const want = ["fmtAge", "statusFor"];
  const found = {};
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && want.includes(n.name?.text)) {
      found[n.name.text] = n.getText(pf).replace(/^export\s+/, "");
    }
    ts.forEachChild(n, visit);
  };
  visit(pf);
  return want.every((w) => found[w]) ? want.map((w) => found[w]).join("\n") : null;
})();
check("statusFor was extracted", Boolean(statusFn), statusFn ? "ok" : "MISSING — measuring nothing");

if (statusFn) {
  const js = ts.transpileModule(`${statusFn}\nexport { statusFor };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const { statusFor } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

  const row = (over) => ({
    dataset: "x",
    label: "x",
    ttlSeconds: 3600,
    note: "",
    tracked: 100,
    stale: 0,
    never: 0,
    deferred: 0,
    oldestMs: Date.now(),
    seededAtMs: Date.now(),
    instrumented: true,
    coverageEstablished: true,
    marketHoursOnly: false,
    ...over,
  });

  // EVERY EXISTING CALL BELOW PASSES `marketOpen` EXPLICITLY. Leaving it off
  // would make it `undefined` -- falsy, so the market-window branch is skipped
  // and every assertion still passes, for a reason that has nothing to do with
  // what it claims. That is the same shape as the three-argument readMemo call
  // that turned out to be hiding `nowMs - at >= undefined`: a test bug that
  // passes is a test that measures nothing.
  const OPEN = true;
  const SHUT = false;

  // The shape that produced "24 / 24, within policy": every observed symbol
  // fresh, nothing declaring what ought to be there.
  const perfectButUncovered = statusFor(row({ coverageEstablished: false }), OPEN);
  check(
    "an uncovered dataset with EVERY observed symbol fresh is not ok",
    perfectButUncovered.status !== "ok",
    perfectButUncovered.status
  );
  check("...it is reported as uncovered", perfectButUncovered.status === "uncovered", perfectButUncovered.status);

  // And it must not be reachable from the other direction either: an uncovered
  // dataset that happens to look BAD is still an unearned measurement, not a
  // verdict about the dataset.
  const staleUncovered = statusFor(row({ coverageEstablished: false, stale: 90 }), OPEN);
  check("an uncovered dataset with stale symbols is still uncovered", staleUncovered.status === "uncovered", staleUncovered.status);

  // The control: coverage established, so the ordinary judgements still apply.
  check("a covered, fresh dataset is ok", statusFor(row({}), OPEN).status === "ok");
  check("a covered, mostly-stale dataset is a fault", statusFor(row({ stale: 90 }), OPEN).status === "fault");
  // ── A GATED DATASET OUTSIDE ITS WINDOW ────────────────────────────────
  //
  // Measured on the live page, 2026-09-04 07:26 UTC: price pool `0 / 886`,
  // `886 past its TTL`, red, "100% of observed symbols past their own TTL".
  // Every word correct, the colour wrong -- warmPricePool refuses to run
  // outside the buffered window, and a 15-minute policy puts the whole universe
  // past TTL a quarter of an hour after the gate shuts. Roughly fifteen hours a
  // day of red, plus weekends, on a page whose entire job is being unambiguous
  // at a glance.
  const overnight = statusFor(row({ marketHoursOnly: true, stale: 100 }), SHUT);
  check(
    "a market-hours dataset, 100% past TTL with the market shut, is not a fault",
    overnight.status !== "fault" && overnight.status !== "warn",
    `${overnight.status} — ${overnight.why}`
  );
  check(
    "...and it is not green either",
    overnight.status === "seeded",
    "the page does not know the last session's run was healthy, only that " +
      "nothing was SUPPOSED to run since — green would be the opposite error"
  );
  check(
    "...and it says WHY, not just what",
    /trading window/.test(overnight.why) && /100%/.test(overnight.why),
    overnight.why
  );

  // THE BRANCH MUST STILL BE ABLE TO FAULT. A neutral status that can never
  // escalate is a dead job reading calm forever -- the exact failure the
  // `seeded` branch above this one was tightened to avoid.
  const midSession = statusFor(row({ marketHoursOnly: true, stale: 100 }), OPEN);
  check(
    "the same dataset IS a fault while the window is open",
    midSession.status === "fault",
    `${midSession.status} — a price pool that stops refreshing during the ` +
      `session must be red within the quarter hour, exactly as before`
  );
  check(
    "the exemption is not handed to every dataset just because the market is shut",
    statusFor(row({ marketHoursOnly: false, stale: 100 }), SHUT).status === "fault",
    "fundamentals, profile and the rest run on their own crons around the " +
      "clock — a shut market says nothing about them"
  );
  check(
    "a gated dataset that is genuinely fine reads ok, shut or open",
    statusFor(row({ marketHoursOnly: true, stale: 0 }), SHUT).status === "ok" &&
      statusFor(row({ marketHoursOnly: true, stale: 0 }), OPEN).status === "ok",
    "the branch is reached only when something is actually past TTL"
  );
  check(
    "an uncovered gated dataset is still uncovered, shut or not",
    statusFor(row({ marketHoursOnly: true, coverageEstablished: false, stale: 100 }), SHUT)
      .status === "uncovered",
    "the coverage question is not a freshness question and must win first"
  );

  check(
    "an uninstrumented dataset is still unknown, not uncovered",
    statusFor(row({ instrumented: false, coverageEstablished: false }), OPEN).status === "unknown",
    "nothing measured and no denominator are different problems with different fixes"
  );
}
check(
  "uncovered is not coloured green",
  /uncovered:\s*"#a78bfa"/.test(healthPage) && !/uncovered:\s*"#22c55e"/.test(healthPage)
);
check(
  "the RATIO ITSELF is withheld, not just recoloured",
  /!d\.coverageEstablished\s*\?\s*`\$\{d\.tracked\} seen`/.test(healthPage),
  'a purple "24 / 24" still reads as 24 of 24'
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
