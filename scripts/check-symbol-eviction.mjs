// Eviction: corroborated before it fires, and complete when it does.
//
// TWO THINGS FAIL SILENTLY HERE, IN OPPOSITE DIRECTIONS.
//
//   EVICTING TOO EAGERLY. pruneUniverse ZREMs the score, so an evicted symbol
//   restarts from zero and has to earn its way back -- eviction is destructive
//   and irreversible in practice. Worse, absence from the screener is NOT a
//   delisting signal on its own: the query filters isActivelyTrading=true AND
//   takes only the top SCREENER_LIMIT rows by market cap, so every live
//   small-cap in the universe is "absent" every single day. Absence alone would
//   evict the entire tail.
//
//   EVICTING INCOMPLETELY. The per-symbol key list is the kind of thing that is
//   right on the day it is written and wrong the first time a key is added. The
//   symptom is a symbol that was "removed" still holding storage and still
//   answering reads, which looks like nothing at all.
//
// So the key list here is DERIVED from the source by scanning for per-symbol
// key constructions, not compared against a second hand-typed copy -- two
// hand-typed lists is the same problem twice.
//
// WHAT A PASS ON THAT ASSERTION DOES NOT COVER, stated because a check that
// reads as proof of completeness while being a heuristic is worse than no
// check. The scan requires the CONSTANT NAME to end in PREFIX and only walks
// lib/. It cannot see:
//
//   * an inline literal -- `redis.del("msh:thing:" + symbol)`
//   * a constant named *_KEY, *_NS or anything else
//   * a per-symbol key built anywhere under app/
//   * a key assembled by a helper that takes the prefix as an argument
//
// The scan is widened to app/ below, which removes the third. The other three
// are real gaps and the PASS should be read as "no key of the COMMON SHAPE is
// missing", not "no key is missing".
//
//   node scripts/check-symbol-eviction.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const evict = readCodeOnly("lib/server/symbolEviction.ts");
const queue = readCodeOnly("lib/server/stalenessQueue.ts");
const job = readCodeOnly("app/api/jobs/warm-screener-fundamentals/route.ts");

// AST EXTRACTION, NOT `[\s\S]*?\n\}`. That regex stops at the first line
// beginning with a closing brace, and a TypeScript signature can produce one
// before the function ends -- an inline parameter object type closes `}): T {`
// in column 0. It has silently truncated a lift in this repo before
// (claude/traps/), and a truncated lift is a syntax error at best and a
// half-function that passes at worst. The AST knows where the function ends.
const evictAst = ts.createSourceFile(
  "symbolEviction.ts",
  evict,
  ts.ScriptTarget.Latest,
  true
);
const grabFn = (name) => {
  let out = null;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      out = node.getText(evictAst).replace(/^export\s+/, "");
    }
    ts.forEachChild(node, visit);
  };
  visit(evictAst);
  return out;
};

const lift = async (src, extra = "") => {
  const js = ts.transpileModule(`${extra}\n${src}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};

// ── 1. Corroboration ────────────────────────────────────────────────────────
console.log("\n1. Eviction requires corroboration, not a single reading");

const fn = (evict.match(/export function shouldEvict\([\s\S]*?\n\}/) ?? [])[0];
const days = Number((evict.match(/EVICTION_CORROBORATION_DAYS = (\d+)/) ?? [])[1]);
const streak = Number((evict.match(/EVICTION_MIN_FAIL_STREAK = (\d+)/) ?? [])[1]);
if (!fn || !days || !streak) {
  console.error(
    `FAIL: could not extract shouldEvict (${!!fn}), the day threshold (${days}) or ` +
      `the streak threshold (${streak}) — this script would otherwise pass by ` +
      `measuring nothing.`
  );
  process.exit(1);
}
const maxAgeMs = Number(
  Function(
    `"use strict"; return (${
      (evict.match(/EVICTION_FAIL_MAX_AGE_MS = ([0-9 *]+);/) ?? [])[1] ?? "0"
    });`
  )()
);
if (!maxAgeMs) {
  console.error("FAIL: could not read EVICTION_FAIL_MAX_AGE_MS — measuring nothing.");
  process.exit(1);
}
const mod = await lift(fn, `const EVICTION_CORROBORATION_DAYS = ${days};
const EVICTION_MIN_FAIL_STREAK = ${streak};
const EVICTION_FAIL_MAX_AGE_MS = ${maxAgeMs};`);
const NOW = 1_800_000_000_000;
const fresh = NOW - 60_000;

check(
  "one day of evidence is never enough",
  mod.shouldEvict(1, 99, fresh, NOW) === false,
  `${days} distinct days required — one bad screener response, one FMP outage or ` +
    `one deploy mid-run produces a single day of both signals`
);
check(
  "absence alone never evicts, however many days",
  mod.shouldEvict(365, 0, fresh, NOW) === false &&
    mod.shouldEvict(365, streak - 1, fresh, NOW) === false,
  "the screener takes the top rows BY MARKET CAP, so every live small-cap is " +
    "absent every day — absence alone would evict the whole tail of the universe"
);
check(
  "quote failure alone never evicts either",
  mod.shouldEvict(0, 99, fresh, NOW) === false,
  "a symbol can fail quotes for a week and still be listed; that is what the " +
    "deferral in #403 is for, and it is reversible where this is not"
);
check(
  "both signals, sustained, do evict",
  mod.shouldEvict(days, streak, fresh, NOW) === true,
  `${days} days absent AND a failure streak of ${streak}`
);
check(
  "the day evidence is a SET of day stamps, not a counter",
  /days\.add\(dayStamp\(nowMs\)\)/.test(evict) && !/incr\(/.test(evict),
  "an INCR would let one day's two runs manufacture two days of corroboration"
);
check(
  "reappearing in the screener clears the evidence",
  /clearAbsence\(universe\.filter/.test(job),
  "the rule is 'absent on N days recently', not 'absent on N days ever'"
);
check(
  "a failed screener read does not start a sweep",
  /if \(!result\.ok \|\| !result\.symbols\.length\)/.test(job) &&
    /sweep\.skipped = "screener-unavailable"/.test(job),
  "a failed read returns no symbols, which would read as the ENTIRE universe " +
    "being absent and start corroboration against every symbol at once"
);

// ── 2. The key list is complete, and stays complete ─────────────────────────
console.log("\n2. Every per-symbol key pattern is in the cleanup list");

// DERIVED BY SCANNING, NOT BY COMPARING TWO HAND-TYPED LISTS. Finds every
// template literal of the shape `${SOMETHING_PREFIX}${symbol-ish}` across the
// server code, resolves each constant to its literal value, and requires the
// eviction registry to cover it.
const SYMBOLISH = /^(symbol|sym|clean|s)$/;
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.ts$/.test(entry.name)) files.push(full);
  }
};
walk(path.join(ROOT, "lib"));
// app/ TOO. Route handlers build per-symbol keys as readily as lib/ does, and
// the first version of this scan could not see any of them.
walk(path.join(ROOT, "app"));

const discovered = new Map(); // prefix value -> { sep, file, constant }
for (const file of files) {
  const rel = path.relative(ROOT, file);
  // STRIPPED, NOT RAW. The first version read the files with readFileSync and
  // promptly matched THIS MODULE'S OWN COMMENTS -- the prose above
  // PER_SYMBOL_KEYS writes `${PREFIX}${symbol}` and `${PREFIX}:${symbol}` to
  // explain the shapes, and the scan dutifully discovered them as key patterns
  // and reported a missing entry that did not exist. A scan for code that finds
  // the description of the code is claude/traps/grep-finds-the-comment-not-the-code.md,
  // in the check written to prevent it.
  //
  // minRetainedFraction is relaxed because this sweeps every file in lib/,
  // including comment-dominated ones the default 2% guard would reject.
  let src;
  try {
    src = readCodeOnly(rel, { minRetainedFraction: 0.005 });
  } catch {
    continue;
  }
  for (const m of src.matchAll(
    /\$\{([A-Za-z_]*(?:KEY_)?PREFIX)\}(:?)\$\{([^}]*)\}/g
  )) {
    const [, constant, sep, expr] = m;
    // `${PREFIX}${String(symbol).trim().toUpperCase()}` and `${PREFIX}${sym}`
    // are the same thing; a route slug or an IP hash is not.
    const bare = expr.replace(/String\(|\)\.trim\(\)\.toUpperCase\(\)|\)|\.toUpperCase\(\)/g, "").trim();
    if (!SYMBOLISH.test(bare)) continue;
    const decl = src.match(new RegExp(`${constant}\\s*=\\s*"([^"]+)"`));
    if (!decl) continue;
    discovered.set(decl[1] + "|" + sep, { constant, file: rel });
  }
}

const listed = new Set(
  [...evict.matchAll(/\{ prefix: "([^"]+)", sep: "(:?)" \}/g)].map(
    (m) => m[1] + "|" + m[2]
  )
);
const missing = [...discovered.keys()].filter((k) => !listed.has(k));

check(
  "the scan found per-symbol key patterns to check against",
  discovered.size >= 10,
  `${discovered.size} discovered by shape across lib/ and app/ — a scan that finds ` +
      `nothing ` +
    `passes trivially, which is the failure mode of a derived list`
);
check(
  "every discovered per-symbol key prefix is in PER_SYMBOL_KEYS",
  missing.length === 0,
  missing.length
    ? `missing: ${missing
        .map((k) => `${k.split("|")[0]} (${discovered.get(k).constant} in ${discovered.get(k).file})`)
        .join(", ")}`
    : `all ${discovered.size} covered, separators included — a wrong separator ` +
      `deletes nothing while looking like it deleted something`
);

// ── 1b. The streak evidence has to be about TODAY ──────────────────────────
console.log("\n1b. A stale streak proves nothing, and a bad day is not swept");

// THE CHAIN THIS CLOSES, and every link of it happened. For any symbol below
// the screener's market-cap floor `absent` is true EVERY DAY by construction,
// and clearAbsence only fires for symbols PRESENT in the response -- so it
// never fires for them. The failure streak is the ONLY live gate. An FMP
// incident inflates that streak; the deferral then stops the symbol being
// retried for up to 24h, so the inflated streak is STILL IN THE ROW when the
// next daily sweep reads it, and another absence day is booked. http-429
// occurred on three consecutive days, 08-30 to 09-01.
check(
  "a streak older than the window does not count",
  mod.shouldEvict(days, streak, NOW - maxAgeMs - 1, NOW) === false,
  `${maxAgeMs / 3_600_000}h window — a symbol parked for the 24h deferral cap ` +
    `carries yesterday's streak all day, and "was failing 24 hours ago and has ` +
    `not been asked since" is not evidence of a delisting`
);
check(
  "a missing or unparseable failAt does not count",
  mod.shouldEvict(days, streak, undefined, NOW) === false &&
    mod.shouldEvict(days, streak, 0, NOW) === false &&
    mod.shouldEvict(days, streak, NaN, NOW) === false,
  "an undated streak is evidence forever, which is the whole defect"
);
check(
  "the window is wider than the deferral cap it has to survive",
  maxAgeMs > 24 * 60 * 60 * 1000,
  `${maxAgeMs / 3_600_000}h against a 24h cap — a window at exactly the cap ` +
    `would race it`
);
check(
  "failAt is written on the same path as the streak",
  /failStreak: streak,[\s\S]{0,200}failAt: Date\.now\(\),/.test(
    readCodeOnly("lib/server/pricePool.ts")
  ),
  "written apart, the two could disagree about when the evidence was gathered"
);

// Running the health gate rather than grepping it: which branch a job record
// reaches is not something a regex can see.
const degradeFn = (evict.match(/export function poolLooksDegraded\([\s\S]*?\n\}/) ?? [])[0];
if (!degradeFn) {
  console.error("FAIL: could not extract poolLooksDegraded — measuring nothing.");
  process.exit(1);
}
const maxHealthAgeMs = Number(
  Function(
    `"use strict"; return (${
      (evict.match(/POOL_HEALTH_MAX_AGE_MS = ([0-9 *]+);/) ?? [])[1] ?? "0"
    });`
  )()
);
if (!maxHealthAgeMs) {
  console.error("FAIL: could not read POOL_HEALTH_MAX_AGE_MS — measuring nothing.");
  process.exit(1);
}
const emptyShare = Number(
  (evict.match(/POOL_DEGRADED_EMPTY_SHARE = ([0-9.]+);/) ?? [])[1]
);
if (!emptyShare) {
  console.error("FAIL: could not read POOL_DEGRADED_EMPTY_SHARE — measuring nothing.");
  process.exit(1);
}
const health = await lift(degradeFn, `const POOL_DEGRADED_DEFER_SHARE = 0.1;
const POOL_DEGRADED_REFUSAL_SHARE = 0.2;
const POOL_DEGRADED_EMPTY_SHARE = ${emptyShare};
const POOL_HEALTH_MAX_AGE_MS = ${maxHealthAgeMs};`);
const UNIVERSE = 800;
const NOW_H = 1_800_000_000_000;
const goodSession = {
  at: NOW_H,
  priceAttempts: 400,
  quotesRefused: 2,
  empties: 1,
  deferredSymbols: 3,
  deferSuppressed: false,
};

// THE BAND BETWEEN THE TWO THRESHOLDS, which was uncovered. pricePool's
// circuit breaker discards a run's deferrals above 50% empties; this gate
// refuses a session above 20%. A run at 21-50% is suppressed by neither: its
// deferrals apply, its streaks stick, and the gate used to return null --
// because `empties` was in the type and in the stored record and NOTHING READ
// IT. Three such days is the round-1 eviction chain, living in the gap.
check(
  "a session that came back empty a third of the time is not evidence",
  health.poolLooksDegraded(
    { ...goodSession, priceAttempts: 400, empties: 120, quotesRefused: 2 },
    UNIVERSE,
    NOW_H
  ) === "many-empty",
  `120 of 400 = 30%, above the ${emptyShare * 100}% gate and below the breaker's ` +
    `50% — deferrals applied and streaks stuck, and this used to return null`
);
check(
  "a normal empty rate still permits the sweep",
  health.poolLooksDegraded(
    { ...goodSession, priceAttempts: 400, empties: 40 },
    UNIVERSE,
    NOW_H
  ) === null,
  `40 of 400 = 10% — a real delisting or two is not a degraded session, and a ` +
    `gate that blocks every day is an off switch`
);
check(
  "the gate's threshold is at or below the run-level breaker's",
  emptyShare <= 0.5,
  `${emptyShare} against PRICE_EMPTY_RATE_ABORT 0.5 — the breaker withholds an ` +
    `ACTION inside one run and is set high because discarding deferrals is ` +
    `itself destructive; this refuses a WHOLE SESSION. Different questions, so ` +
    `they may differ — but a gate ABOVE the breaker would leave the same gap ` +
    `pointing the other way`
);

// THE ASSERTION THAT WOULD HAVE CAUGHT THE PREVIOUS VERSION, and the reason it
// did not exist: the fixture populated all four fields, and no production
// record at 06:50 UTC ever does.
//
// warm-screener-fundamentals runs "50 6 * * *" = 02:50 ET. warmPricePool's
// market-hours gate returns early there with
// { ok: true, skipped: true, reason: "market-closed", written: 0 }, and jobRuns
// keeps ONE key per job -- "this is not a history" -- so the last job record at
// sweep time is ALWAYS that skip. Every condition read a null and passed.
check(
  "a market-closed skip record does NOT read as clean",
  health.poolLooksDegraded({ at: NOW_H, targets: UNIVERSE }, UNIVERSE, NOW_H) !== null,
  `got ${JSON.stringify(
    health.poolLooksDegraded({ at: NOW_H, targets: UNIVERSE }, UNIVERSE, NOW_H)
  )} — this is the shape production actually has at 02:50 ET, and the previous ` +
    `gate returned null for it: deferSuppressed null is not === true, ` +
    `deferredSymbols null becomes 0, and priceAttempts null makes 'attempts > 0' ` +
    `false so the refusal test was skipped entirely`
);
check(
  "a record missing any required field is incomplete, not clean",
  health.poolLooksDegraded({ ...goodSession, priceAttempts: undefined }, UNIVERSE, NOW_H) ===
    "incomplete-record" &&
    health.poolLooksDegraded({ ...goodSession, quotesRefused: null }, UNIVERSE, NOW_H) ===
      "incomplete-record" &&
    health.poolLooksDegraded({ ...goodSession, deferredSymbols: "3" }, UNIVERSE, NOW_H) ===
      "incomplete-record" &&
    health.poolLooksDegraded({ ...goodSession, empties: undefined }, UNIVERSE, NOW_H) ===
      "incomplete-record" &&
    health.poolLooksDegraded({ ...goodSession, deferSuppressed: undefined }, UNIVERSE, NOW_H) ===
      "incomplete-record",
  "`numOf(k) ?? 0` then `if (x > 0)` makes absent data read as healthy — in a " +
    "PR series about absence being mistaken for health"
);
check(
  "no session record at all blocks the sweep",
  health.poolLooksDegraded(null, UNIVERSE, NOW_H) === "no-session-run",
  "on a Monday the last session was Friday and the 36h TTL has expired it, " +
    "which is right: EVICTION_FAIL_MAX_AGE_MS is 48h, so Friday's streaks could " +
    "not evict anything anyway"
);
check(
  "a clean session permits the sweep",
  health.poolLooksDegraded(goodSession, UNIVERSE, NOW_H) === null,
  "the gate must not block every day, or it is just an off switch"
);
check(
  "a session that suppressed its deferrals blocks the sweep",
  health.poolLooksDegraded({ ...goodSession, deferSuppressed: true }, UNIVERSE, NOW_H) ===
    "defer-suppressed",
  "that run already decided its own evidence was untrustworthy"
);
check(
  "wholesale deferral blocks it",
  health.poolLooksDegraded({ ...goodSession, deferredSymbols: 200 }, UNIVERSE, NOW_H) ===
    "many-deferred",
  "delistings arrive one at a time; 200 of 800 parked is a statement about FMP"
);
check(
  "a session full of refusals blocks it",
  health.poolLooksDegraded({ ...goodSession, quotesRefused: 300 }, UNIVERSE, NOW_H) ===
    "many-refused",
  "670 of 700 symbols were refused on 08-31"
);
// `at` WAS IN THE SIGNATURE AND NOTHING READ IT -- a field that looks checked.
// The session key's TTL is 36h, so a warm-price-pool outage of 30 hours leaves
// the key live and a 30-hour-old session reading as a clean bill for today.
check(
  "a session record older than the window is stale, not clean",
  health.poolLooksDegraded(
    { ...goodSession, at: NOW_H - maxHealthAgeMs - 1 },
    UNIVERSE,
    NOW_H
  ) === "stale-session-record",
  `${maxHealthAgeMs / 3_600_000}h window — below the key's own 36h TTL so this is ` +
    `the binding limit rather than a second opinion about it, and below ` +
    `EVICTION_FAIL_MAX_AGE_MS (48h) so the gate can never be more permissive ` +
    `than the evidence rule it protects`
);
// THE WINDOW'S TWO CONSTRAINTS, AS ARITHMETIC. Both were stated in the comment
// and neither was asserted, so widening the window to 72h passed -- the
// staleness test measures `maxHealthAgeMs - 1` against whatever the constant
// happens to be, which can never object to the constant itself.
const sessionTtlMs =
  Number(
    Function(
      `"use strict"; return (${
        (readCodeOnly("lib/server/pricePool.ts").match(
          /SESSION_HEALTH_TTL_SECONDS = ([0-9 *]+);/
        ) ?? [])[1] ?? "0"
      });`
    )()
  ) * 1000;
if (!sessionTtlMs) {
  console.error("FAIL: could not read SESSION_HEALTH_TTL_SECONDS — measuring nothing.");
  process.exit(1);
}
check(
  "the window is the binding limit, not a second opinion about the key's TTL",
  maxHealthAgeMs < sessionTtlMs,
  `${maxHealthAgeMs / 3_600_000}h against a ${sessionTtlMs / 3_600_000}h TTL — at or ` +
    `above the TTL the key would expire before this ever fired, and the age ` +
    `check would be unreachable code`
);
check(
  "and never more permissive than the evidence rule it protects",
  maxHealthAgeMs < maxAgeMs,
  `${maxHealthAgeMs / 3_600_000}h against EVICTION_FAIL_MAX_AGE_MS ` +
    `${maxAgeMs / 3_600_000}h — a gate that accepts health older than the streaks ` +
    `it vouches for is vouching for nothing`
);
check(
  "a record with no usable `at` is incomplete",
  health.poolLooksDegraded({ ...goodSession, at: undefined }, UNIVERSE, NOW_H) ===
    "incomplete-record" &&
    health.poolLooksDegraded({ ...goodSession, at: "yesterday" }, UNIVERSE, NOW_H) ===
      "incomplete-record",
  "absence is a reason to skip, never a pass"
);
check(
  "a non-positive universe size blocks rather than being ignored",
  health.poolLooksDegraded(goodSession, 0, NOW_H) === "no-universe" &&
    health.poolLooksDegraded(goodSession, -1, NOW_H) === "no-universe",
  "`universeSize > 0 &&` was the last fail-open here: dead code that read as a " +
    "guard, which is the exact shape that made two earlier drafts inert"
);
check(
  "a session that attempted nothing has no evidence either way",
  health.poolLooksDegraded({ ...goodSession, priceAttempts: 0 }, UNIVERSE, NOW_H) === "no-attempts",
  "zero attempts is not a clean bill; it is no bill"
);

// THE SOURCE, not just the logic. Reading the job record is what made the
// previous gate inert, and it looked correct in isolation.
check(
  "the gate reads the session-health key, not the job record",
  /readPricePoolSessionHealth\(\)/.test(job) && !/readJobRuns\(\)/.test(job),
  "at 02:50 ET the last warm-price-pool JOB record is always a market-closed " +
    "skip, and jobRuns keeps no history to fall back to"
);
// ORDERING, NOT PRESENCE. The first version tested that the write EXISTS and
// that "market-closed" appears somewhere in the file — both still true with the
// write wrapped in `if (false)`. What matters is that the market-closed return
// happens BEFORE the write, so that path can never reach it.
const poolSrc = readCodeOnly("lib/server/pricePool.ts");
const marketClosedReturn = poolSrc.indexOf('reason: "market-closed"');
const healthWrite = poolSrc.indexOf("await redis.set<PricePoolSessionHealth>(");
check(
  "that key is written only by a run that did work",
  marketClosedReturn !== -1 && healthWrite > marketClosedReturn,
  marketClosedReturn === -1 || healthWrite === -1
    ? `market-closed return at ${marketClosedReturn}, health write at ${healthWrite}`
    : "the market-closed path returns long before the write, which is the point — " +
      "a record written on a skipped run would carry the zeroes the gate exists " +
      "to distrust"
);

// BOTH SITES. `deferredSymbols: deferred.size + newlyDeferred` appears in the
// session-health write AND in the run result, so a single match passed with one
// of them reverted — the same lazy-scope shape this project keeps finding.
const deferredAfter = (poolSrc.match(/deferredSymbols: deferred\.size \+ newlyDeferred/g) ?? [])
  .length;
check(
  "deferredSymbols is reported AFTER this run's deferrals, at BOTH sites",
  deferredAfter === 2 && !/deferredSymbols: deferred\.size,/.test(poolSrc),
  `${deferredAfter} of 2 — \`deferred\` is read at the top of the run, so ` +
    `reporting its size alone described the state going IN, and the ` +
    `many-deferred signal lagged one run while its name read as current`
);

check(
  "a skipped day is distinguishable from a clean one on the record",
  /sweepSkipped: sweep\.skipped/.test(job) &&
    /sweep\.skipped = "universe-unavailable"/.test(job) &&
    /sweep\.skipped = "sweep-threw"/.test(job),
  "getWarmTargetSymbols self-fetches the live site from inside a cron, and the " +
    "firewall runs Bot Protection at ~1.3k/day — a challenged self-fetch used to " +
    "make `absentAndFailing: 0` read identical to 'looked and found nothing'"
);

// ── 3. The things that never self-clean ─────────────────────────────────────
console.log("\n3. The hashes and the queues, which no TTL will ever reach");

check(
  "both per-symbol hashes are HDEL'd",
  /p\.hdel\(hash, symbol\)/.test(evict) &&
    /"msh:price-pool:v1"/.test(evict) &&
    /"msh:picker-charts:v1"/.test(evict),
  "their fields carry no TTL and the key-level expiry is reset every run, so a " +
    "dead field is immortal — these are the only hdel calls in the codebase"
);
check(
  "the staleness queues get a deregister",
  /export async function deregisterSymbols/.test(queue) &&
    /deregisterSymbols\(sweep\.evicted\)/.test(job),
  "the only ZREM in stalenessQueue clears a deferral, so tracked = ZCARD only " +
    "ever grew — an evicted symbol was counted permanently stale in every " +
    "/cache-health denominator, which made removing a dead ticker make the " +
    "health page WORSE"
);
check(
  "deregistration covers every dataset, not one",
  /for \(const dataset of Object\.keys\(DATASETS\) as DatasetKey\[\]\)/.test(queue),
  "a symbol in six queues and out of two is a state nothing downstream expects"
);
check(
  "the cleanup counts what the pipeline DID, not what it was asked to do",
  /const results = \(await p\.exec\(\)\) as unknown\[\];/.test(evict) &&
    !/out\.keys = PER_SYMBOL_KEYS\.length/.test(evict),
  "reporting the list length claims 14 deletions when 14 keys were absent, " +
    "which makes an eviction that removed nothing indistinguishable from one " +
    "that removed everything — in the one record anybody would consult"
);
check(
  "the eviction is logged so 'was this removed' has an answer",
  /zadd\(EVICTED_KEY/.test(evict),
  "and deliberately does NOT gate re-admission — if the symbol comes back, " +
    "discovery should admit it like any other"
);

// ── 4. What 8d must not do ─────────────────────────────────────────────────
console.log("\n4. Pool-only IPO symbols stay outside the sweep");

// THE PROTECTION IS AN ABSENCE, WHICH IS WHY IT NEEDS AN ASSERTION. A newly
// listed symbol is below the screener floor by definition, so `absent` is true
// for it from day one; if it also quotes badly in its first days it accumulates
// both signals and can be evicted before it has 30 bars. Today it is safe only
// because the sweep iterates getWarmTargetSymbols and 8d admits IPOs to the
// PRICE POOL rather than to warm targets. That is exactly the kind of invariant
// a later PR breaks silently -- someone adds IPOs to the universe for a good
// reason and never learns this depended on them not being there.
check(
  "the sweep's candidate set is the warm targets, not the price pool",
  /getWarmTargetSymbols\(/.test(job) &&
    !/readPricePoolBulk\(universe\)/.test(job) &&
    /const missing = universe\.filter/.test(job),
  "iterating the pool instead would sweep every pool-only symbol, including " +
    "IPOs admitted under 8d option 2 — which are absent from the screener by " +
    "construction and have no history to defend themselves with"
);
check(
  "the pool is read only for symbols already shortlisted from the universe",
  /readPricePoolBulk\(missing\)/.test(job),
  "the pool supplies EVIDENCE about candidates; it must never supply the " +
    "candidates"
);

// ── 5. The preset list is hand-edited, never evicted ───────────────────────
console.log("\n5. A dead PRESET_UNIVERSE symbol alarms once instead of looping");

// WHY THIS IS NOT AN EVICTION. evictSymbol deletes Redis keys; PRESET_UNIVERSE
// is a hardcoded array in the bundle. Evicting one of its symbols removes the
// caches and changes nothing -- the next pickers build re-injects the ticker
// from the array, it re-fails, and three days later it is evicted again. An
// evict -> reinject -> refail loop that fills the log with one name while the
// only real remedy, editing the file, is something nobody is told about.
// META is in that list and FB -> META is exactly the rename case.
//
// RUN, NOT GREPPED, and run against the SHIPPED ARRAY rather than an injected
// fixture: "META is exempt" is a claim about the list's contents as much as
// about the branch, and a check that supplies its own set proves only half.
// The alarm marker key needs no assertion of its own here -- it is a
// `${PREFIX}${symbol}` shape, so section 2's derived scan fails if it is ever
// dropped from PER_SYMBOL_KEYS.
const presetSrc = readCodeOnly("lib/server/presetUniverse.ts");
const presetLiteral = (presetSrc.match(/PRESET_UNIVERSE: string\[\] = \[([\s\S]*?)\];/) ?? [])[1];
const presetList = presetLiteral
  ? [...presetLiteral.matchAll(/"([^"]+)"/g)].map((m) => m[1])
  : [];
const actionFn = grabFn("evictionAction");
// THE SHARED PRESET GATE. evictionAction delegates to it, so a lift without it
// throws a ReferenceError -- which is how this was caught rather than reasoned
// about.
const gateFn = grabFn("actionFor");
const staleFn = grabFn("staleBarsShouldEvict");
const staleActionFn = grabFn("staleBarEvictionAction");
const mergeDayFn = grabFn("mergeStaleBarDay");
const dayStampFn = grabFn("dayStamp");
const staleWeekdays = Number((evict.match(/EVICTION_STALE_BAR_WEEKDAYS = (\d+)/) ?? [])[1]);
const staleEvidenceDays = Number((evict.match(/STALE_BAR_EVIDENCE_DAYS = (\d+)/) ?? [])[1]);
const barStampMaxAgeMs = Number(
  Function(
    `"use strict"; return (${
      (evict.match(/EVICTION_BAR_STAMP_MAX_AGE_MS = ([0-9 *]+);/) ?? [])[1] ?? "0"
    });`
  )()
);
const freshnessWarnWeekdays = Number(
  (readCodeOnly("lib/server/historyCache.ts").match(
    /HISTORY_MAX_BAR_AGE_WEEKDAYS = (\d+)/
  ) ?? [])[1]
);
if (
  !gateFn ||
  !staleFn ||
  !staleActionFn ||
  !mergeDayFn ||
  !dayStampFn ||
  !staleWeekdays ||
  !staleEvidenceDays ||
  !barStampMaxAgeMs ||
  !freshnessWarnWeekdays
) {
  console.error(
    `FAIL: could not extract the stale-bar route — actionFor ${!!gateFn}, ` +
      `staleBarsShouldEvict ${!!staleFn}, staleBarEvictionAction ${!!staleActionFn}, ` +
      `mergeStaleBarDay ${!!mergeDayFn}, dayStamp ${!!dayStampFn}, ` +
      `threshold ${staleWeekdays}, evidence window ${staleEvidenceDays}, ` +
      `stamp age ${barStampMaxAgeMs}, freshness warn ${freshnessWarnWeekdays}. ` +
      `Every assertion in section 5 would pass by measuring nothing.`
  );
  process.exit(1);
}
const claimFn = (evict.match(/export async function claimPresetHandEditAlarm\([\s\S]*?\n\}/) ?? [])[0];
if (!actionFn || !claimFn || presetList.length < 50 || !presetList.includes("META")) {
  console.error(
    `FAIL: could not extract evictionAction (${!!actionFn}), ` +
      `claimPresetHandEditAlarm (${!!claimFn}), or the shipped preset list ` +
      `(${presetList.length} symbols, META ${presetList.includes("META") ? "in" : "MISSING"}) ` +
      `— an empty preset set makes every assertion below pass by exempting nothing.`
  );
  process.exit(1);
}

const evicting = await lift(
  `${fn}\n${gateFn}\n${actionFn}\n${staleFn}\n${staleActionFn}\n${dayStampFn}\n${mergeDayFn}\n` +
    `export { evictionAction, staleBarsShouldEvict, staleBarEvictionAction, mergeStaleBarDay };`,
  `const EVICTION_CORROBORATION_DAYS = ${days};
const EVICTION_MIN_FAIL_STREAK = ${streak};
const EVICTION_FAIL_MAX_AGE_MS = ${maxAgeMs};
const EVICTION_STALE_BAR_WEEKDAYS = ${staleWeekdays};
const EVICTION_BAR_STAMP_MAX_AGE_MS = ${barStampMaxAgeMs};
const STALE_BAR_EVIDENCE_DAYS = ${staleEvidenceDays};
const PRESET_SYMBOLS = new Set(${JSON.stringify(presetList)});`
);

check(
  "a preset symbol meeting EVERY eviction condition is not evicted",
  evicting.evictionAction("META", days, streak, fresh, NOW) === "hand-edit",
  `${days} days absent and a streak of ${streak} — the same inputs that evict ` +
    `any other symbol. Called without a preset argument, so this is the array ` +
    `that actually ships`
);
check(
  "a symbol outside the list still evicts on those conditions",
  evicting.evictionAction("ZZZZ", days, streak, fresh, NOW) === "evict",
  "an exemption that swallowed everything would look identical on the record " +
    "to a sweep that never found anything"
);
check(
  "the exemption does not bypass the evidence rule",
  evicting.evictionAction("META", 1, streak, fresh, NOW) === "keep" &&
    evicting.evictionAction("META", days, 0, fresh, NOW) === "keep",
  "a preset symbol with no case to answer must be silent, not alarmed about — " +
    "otherwise the alarm fires for ~100 mega-caps and means nothing"
);
check(
  "the exemption survives a formatting difference",
  evicting.evictionAction(" meta ", days, streak, fresh, NOW) === "hand-edit",
  "a raw `has` against a lower-cased or padded pool symbol would miss the " +
    "exemption and evict a curated name — the exact outcome this prevents, " +
    "reached through whitespace"
);

// THE ALARM IS ONCE PER SYMBOL, and that is the requirement rather than a
// nicety: a message that repeats every day is the same log-filling churn the
// loop produced, and gets muted the same way. Run against a Redis stub that
// implements SET NX, because "does it pass nx" and "does it read the reply
// correctly" are two different bugs and only running catches the second.
const store = new Map();
// THE CONSTANTS THE FUNCTION CLOSES OVER, INJECTED FROM SOURCE. Without them
// the lifted body throws a ReferenceError inside its own try, the catch
// returns false, and "the alarm can never be claimed" is indistinguishable
// from "the fixture was broken" — a fail-closed catch hides a broken test as
// readily as it hides a broken Redis. Read rather than hardcoded so a renamed
// constant fails loudly here instead of quietly downgrading the assertion.
const alarmPrefix = (evict.match(/PRESET_ALARM_KEY_PREFIX = "([^"]+)"/) ?? [])[1];
const alarmTtl = Number(
  Function(
    `"use strict"; return (${
      (evict.match(/PRESET_ALARM_TTL_SECONDS = ([0-9 *]+);/) ?? [])[1] ?? "0"
    });`
  )()
);
if (!alarmPrefix || !alarmTtl) {
  console.error(
    `FAIL: could not read PRESET_ALARM_KEY_PREFIX (${alarmPrefix}) or ` +
      `PRESET_ALARM_TTL_SECONDS (${alarmTtl}) — the lifted claim would throw ` +
      `into its own catch and report a false that means nothing.`
  );
  process.exit(1);
}
const stubRedis = `const PRESET_ALARM_KEY_PREFIX = ${JSON.stringify(alarmPrefix)};
const PRESET_ALARM_TTL_SECONDS = ${alarmTtl};
const redis = {
  set: async (key, value, opts) => {
    if (opts && opts.nx && __store.has(key)) return null;
    __store.set(key, value);
    return "OK";
  },
};
const dayStamp = () => "2026-09-02";`;
// Assigned BEFORE the lift: the module body reads it at import time, and a
// store handed over afterwards is `undefined` in there — which is a stub that
// throws rather than one that answers.
globalThis.__EVICT_ALARM_STORE = store;
const alarm = await lift(claimFn, `const __store = globalThis.__EVICT_ALARM_STORE;\n${stubRedis}`);
const first = await alarm.claimPresetHandEditAlarm("META", NOW);
const second = await alarm.claimPresetHandEditAlarm("META", NOW);
const other = await alarm.claimPresetHandEditAlarm("INTC", NOW);
check(
  "the alarm can be claimed once and then not again",
  first === true && second === false,
  "SET NX makes the claim and the test one round trip, so two overlapping runs " +
    "cannot both win it — a read-then-write would let them"
);
check(
  "the claim is per symbol, not a global mute",
  other === true,
  "a second dead preset name must still be heard while the first is still on file"
);
check(
  "the marker outlives a day by a wide margin",
  alarmTtl >= 7 * 24 * 60 * 60 && alarmTtl <= 90 * 24 * 60 * 60,
  `${alarmTtl / 86_400} days — a TTL near the daily cron's period is the loop ` +
    `with extra steps, and a permanent marker makes one missed line the only ` +
    `warning that will ever exist`
);
const noRedis = await lift(
  claimFn,
  `const PRESET_ALARM_KEY_PREFIX = "x:";
const PRESET_ALARM_TTL_SECONDS = 1;
const redis = null;
const dayStamp = () => "x";`
);
check(
  "with no Redis the alarm fails CLOSED",
  (await noRedis.claimPresetHandEditAlarm("META", NOW)) === false,
  "an alarm that cannot be de-duplicated is the loop; the run record still " +
    "names the symbol either way, so nothing is lost by staying quiet"
);

// THE WIRING, BY ORDER RATHER THAN BY PROXIMITY. Both halves of this can
// invert silently: the branch could fall through into evictSymbol, and the
// record push could end up INSIDE the once-a-month claim, which would make the
// standing state as rationed as the shouting.
const handIdx = job.indexOf('if (action === "hand-edit")');
const pushIdx = job.indexOf("sweep.presetHandEdit.push(symbol);");
const claimIdx = job.indexOf("if (await claimPresetHandEditAlarm(symbol))");
const contIdx = handIdx === -1 ? -1 : job.indexOf("continue;", handIdx);
const evictIdx = job.indexOf("await evictSymbol(symbol);");
check(
  "the sweep decides through evictionAction, and hand-edit returns before it",
  /const action = evictionAction\(symbol, days, failStreak, row\?\.failAt, nowMs\);/.test(job) &&
    !/shouldEvict/.test(job) &&
    handIdx !== -1 &&
    contIdx !== -1 &&
    evictIdx !== -1 &&
    contIdx < evictIdx,
  `hand-edit branch at ${handIdx}, its continue at ${contIdx}, evictSymbol at ` +
    `${evictIdx} — the branch has to LEAVE the iteration, not merely log before ` +
    `deleting the keys anyway`
);
check(
  "the symbol is recorded on every run, and only the shouting is rationed",
  pushIdx !== -1 && claimIdx !== -1 && pushIdx < claimIdx &&
    /presetNeedsHandEdit: sweep\.presetHandEdit\.join\(", "\) \|\| null,/.test(job),
  "the log line is claimed at most once a month, so the run record is what a " +
    "person reading on day thirty sees — and it names the ticker rather than " +
    "counting it, because 'something needs a hand edit' is not actionable"
);

// ── 6. The third signal: stale bars, independent of FMP's metadata ──────────
console.log("\n6. Stale bars evict, and the freshness warning does not");

// WHY THERE IS A THIRD SIGNAL AT ALL. The 2026-09-04 sweep passed its gate and
// reported absentAndFailing: 0 while nine tickers sat with bars between two
// weeks and fourteen months old. Both existing signals ask FMP whether the
// symbol is alive -- the screener filters isActivelyTrading=true so a stale
// symbol stays IN the response, and stable/quote still answers so failStreak
// stays 0. Two views of one wrong answer.
//
// THE ARITHMETIC IS LIFTED FROM historyCache, not reimplemented here. Asserting
// a threshold against a second copy of weekdaysBehindEastern would prove the
// two copies agree, which is not the claim.
const historySrc = readCodeOnly("lib/server/historyCache.ts");
const historyAst = ts.createSourceFile("historyCache.ts", historySrc, ts.ScriptTarget.Latest, true);
const grabHistory = (name) => {
  let out = null;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      out = node.getText(historyAst).replace(/^export\s+/, "");
    }
    ts.forEachChild(node, visit);
  };
  visit(historyAst);
  return out;
};
const calFns = ["getEasternParts", "weekdaysBehindEastern", "parseNewestBarStamp"].map(
  (n) => [n, grabHistory(n)]
);
const calMissing = calFns.filter(([, src]) => !src).map(([n]) => n);
if (calMissing.length) {
  console.error(
    `FAIL: could not extract ${calMissing.join(", ")} from historyCache — every ` +
      `weekday figure below would be a number this file invented.`
  );
  process.exit(1);
}
const cal = await lift(
  `${calFns.map(([, src]) => src).join("\n")}\n` +
    `export { weekdaysBehindEastern, parseNewestBarStamp };`
);

// BOTH ENDS PINNED, so these cannot rot. check-history-bars learned this the
// expensive way: four assertions there were true only for as long as the real
// Monday they were written on lasted, and were red for a week inside a suite
// everybody reads as a count. A fixture pinned at one end drifts; pinned at
// both it is arithmetic.
const SWEEP_DAY = new Date("2026-09-04T06:50:00Z");
const behind = (iso) => cal.weekdaysBehindEastern(iso, SWEEP_DAY);

// THE REAL NINE, from warm-picker-universe's own recordNewestBarAge output on
// the morning this rule was written. Not invented: these are the symbols the
// two existing signals failed to catch.
const OBSERVED = [
  { sym: "HES", newest: "2025-07-18", verdict: "dead" },
  { sym: "WBA", newest: "2025-08-28", verdict: "dead" },
  { sym: "IPG", newest: "2025-11-26", verdict: "dead" },
  { sym: "FI", newest: "2025-12-08", verdict: "dead" },
  { sym: "DAY", newest: "2026-02-03", verdict: "dead" },
  { sym: "MMC", newest: "2026-02-09", verdict: "dead" },
  { sym: "BK", newest: "2026-06-29", verdict: "ambiguous" },
  { sym: "EA", newest: "2026-08-10", verdict: "alive" },
  { sym: "WBS", newest: "2026-08-20", verdict: "alive" },
];
const NOW_S = SWEEP_DAY.getTime();
const freshStamp = NOW_S - 23.8 * 60 * 60 * 1000; // the real 07:02 -> 06:50 gap
const fires = (o) =>
  evicting.staleBarsShouldEvict(days, behind(o.newest), freshStamp, NOW_S);
const caught = OBSERVED.filter(fires).map((o) => o.sym);
const spared = OBSERVED.filter((o) => !fires(o)).map((o) => o.sym);

check(
  "every symbol the observation called certainly dead is caught",
  OBSERVED.filter((o) => o.verdict === "dead").every(fires),
  `caught ${caught.join(", ")} at ${staleWeekdays} trading days — ` +
    OBSERVED.map((o) => `${o.sym} ${behind(o.newest)}`).join(" · ")
);
check(
  "the two symbols the observation called alive are spared",
  OBSERVED.filter((o) => o.verdict === "alive").every((o) => !fires(o)),
  `spared ${spared.join(", ")} — EA at ${behind("2026-08-10")} and WBS at ` +
    `${behind("2026-08-20")} trading days are a data gap, not a death, and a ` +
    `threshold that takes them is wrong whatever it catches`
);
check(
  "the ambiguous one is left alone, and by a real margin",
  !fires(OBSERVED.find((o) => o.sym === "BK")) &&
    staleWeekdays - behind("2026-06-29") >= 10,
  `BK at ${behind("2026-06-29")} against a threshold of ${staleWeekdays} — ` +
    `${staleWeekdays - behind("2026-06-29")} trading days of margin. This is the ` +
    `judgement call the threshold deliberately does not take a view on; a margin ` +
    `of one or two would mean it had taken it by accident`
);

// THE ASSERTION THE BRIEF ASKED FOR FIRST, and the one most likely to be got
// wrong by reuse: HISTORY_MAX_BAR_AGE_WEEKDAYS is 2 and exists to FLAG a symbol
// worth a look. Evicting on it deletes a stock that missed two sessions over a
// holiday.
check(
  "a symbol at the FRESHNESS WARNING threshold is never evicted",
  !evicting.staleBarsShouldEvict(days, freshnessWarnWeekdays, freshStamp, NOW_S) &&
    !evicting.staleBarsShouldEvict(days, freshnessWarnWeekdays + 1, freshStamp, NOW_S) &&
    staleWeekdays > freshnessWarnWeekdays * 10,
  `warn at ${freshnessWarnWeekdays}, evict at ${staleWeekdays} — ${
    staleWeekdays / freshnessWarnWeekdays
  }x apart. The warning absorbs one market holiday; the eviction rule is a ` +
    `full quarter of trading, six times the statutory ten-business-day cap on ` +
    `an SEC suspension`
);
check(
  "past the threshold is ELIGIBLE, and still needs corroboration",
  evicting.staleBarsShouldEvict(days, staleWeekdays, freshStamp, NOW_S) === true &&
    evicting.staleBarsShouldEvict(1, staleWeekdays * 10, freshStamp, NOW_S) === false &&
    evicting.staleBarsShouldEvict(days - 1, staleWeekdays * 10, freshStamp, NOW_S) === false,
  `${days} distinct days, same window as the absence route — a stale series ` +
    `hardly ever flickers, but a garbled or half-written stamp does, and a rule ` +
    `that deletes data must not act on one reading of one`
);

// THE FROZEN-STAMP DEFECT, which is the failure mode this signal invents and
// nothing else in the file guards. The stamp is only rewritten when a symbol is
// actually refetched, so a symbol we STOP looking at keeps its old bar date
// while the weekdays-behind arithmetic climbs on its own. Without the age
// guard, the rule measures our own failure and bills it to the ticker.
check(
  "an observation older than the window proves nothing",
  evicting.staleBarsShouldEvict(days, staleWeekdays * 10, NOW_S - barStampMaxAgeMs - 1, NOW_S) ===
    false &&
    evicting.staleBarsShouldEvict(days, staleWeekdays * 10, undefined, NOW_S) === false &&
    evicting.staleBarsShouldEvict(days, staleWeekdays * 10, NaN, NOW_S) === false,
  `${barStampMaxAgeMs / 3_600_000}h — a symbol nothing refetches ages past any ` +
    `threshold for free, so an undated observation is evidence forever, the ` +
    `identical defect EVICTION_FAIL_MAX_AGE_MS closes on the other route`
);
check(
  "the observation window survives the 23.8h the schedule guarantees",
  barStampMaxAgeMs > 24 * 60 * 60 * 1000 &&
    evicting.staleBarsShouldEvict(days, staleWeekdays, freshStamp, NOW_S) === true,
  `stamps are written at 07:02 UTC and read at 06:50, so they are ALWAYS 23.8h ` +
    `old in use — a 24h window would sit twelve minutes from failing every day`
);
check(
  "a missing observation is not a dead symbol",
  evicting.staleBarsShouldEvict(days, null, freshStamp, NOW_S) === false &&
    cal.parseNewestBarStamp("2026-08-20") === null &&
    cal.parseNewestBarStamp("garbage|123") === null &&
    cal.parseNewestBarStamp("2026-08-20|0") === null &&
    cal.parseNewestBarStamp(undefined) === null,
  "a symbol absent from the hash, or a half-written field, must read as 'no " +
    "observation' — never as 'no bars'"
);

// THE #404 RULE, THROUGH THE NEW ROUTE. A curated symbol reaching eviction is
// the evict -> reinject -> refail loop; it has to reach the hand-edit alarm
// whichever signal found it, and the only way to be sure is one preset gate.
check(
  "a PRESET symbol past the stale-bar threshold gets the hand-edit alarm, never an eviction",
  evicting.staleBarEvictionAction("META", days, staleWeekdays * 10, freshStamp, NOW_S) ===
    "hand-edit" &&
    evicting.staleBarEvictionAction(" meta ", days, staleWeekdays * 10, freshStamp, NOW_S) ===
      "hand-edit" &&
    evicting.staleBarEvictionAction("ZZZZ", days, staleWeekdays * 10, freshStamp, NOW_S) ===
      "evict",
  "called without a preset argument, so this is the SHIPPED array — and META " +
    "is the case that matters, since FB -> META is the rename this signal " +
    "exists to catch"
);
check(
  "the exemption does not bypass the stale-bar evidence rule either",
  evicting.staleBarEvictionAction("META", 1, staleWeekdays * 10, freshStamp, NOW_S) === "keep" &&
    evicting.staleBarEvictionAction("META", days, freshnessWarnWeekdays, freshStamp, NOW_S) ===
      "keep",
  "an alarm that fires for a preset symbol with no case to answer is an alarm " +
    "for ~100 mega-caps, which is no alarm"
);
check(
  "both routes share ONE preset gate rather than two copies of it",
  /return actionFor\(shouldEvict\(/.test(evict) &&
    /staleBarsShouldEvict\(staleDays, weekdaysBehind, observedAtMs, nowMs\),/.test(evict) &&
    (evict.match(/presets\.has\(String\(symbol/g) ?? []).length === 1,
  `${(evict.match(/presets\.has\(String\(symbol/g) ?? []).length} normalising ` +
    `lookup in the module — a second copy is a second place for "never evict a ` +
    `preset" to be subtly different`
);

// THE EVIDENCE KEY IS ITS OWN, and this is not tidiness. clearAbsence is called
// for every symbol PRESENT in the screener response, and a stale-barred symbol
// is present every single day by construction. Sharing the key would wipe the
// evidence at the top of every sweep and the corroboration threshold could
// never be reached -- a route that looks wired in and evicts nothing, forever.
const absencePrefix = (evict.match(/ABSENCE_KEY_PREFIX = "([^"]+)"/) ?? [])[1];
const staleHash = (evict.match(/STALE_BAR_DAYS_HASH = "([^"]+)"/) ?? [])[1];
check(
  "the stale-bar evidence does not live behind clearAbsence",
  !!absencePrefix && !!staleHash && !staleHash.startsWith(absencePrefix),
  `${staleHash} vs ${absencePrefix} — clearAbsence fires for every symbol in ` +
    `the screener response, and a stale-barred symbol IS in it`
);
check(
  "one day's two runs cannot manufacture two days of corroboration",
  evicting.mergeStaleBarDay(evicting.mergeStaleBarDay("", NOW_S).join(","), NOW_S).length === 1,
  "a set of day stamps, not an INCR — the same reason recordAbsence is not one"
);
check(
  "evidence outside the window is dropped rather than carried forward",
  (() => {
    const old = "2020-01-01";
    const merged = evicting.mergeStaleBarDay(`${old},2020-01-02`, NOW_S);
    return merged.length === 1 && !merged.includes(old);
  })() &&
    evicting.mergeStaleBarDay(
      Array.from({ length: 3 }, (_, i) =>
        new Date(NOW_S - i * 86_400_000).toISOString().slice(0, 10)
      ).join(","),
      NOW_S
    ).length === 3,
  `${staleEvidenceDays}-day window — the rule is "stale on N days recently", ` +
    `not "stale on N days ever", so a gap has to reset the evidence`
);
check(
  "both new hashes are cleaned up on eviction",
  /"msh:history:newest-bar:v1"/.test(evict) &&
    /"msh:evict:stale-bar-days:v1"/.test(evict) &&
    /PER_SYMBOL_HASHES = \[[\s\S]*?"msh:history:newest-bar:v1"[\s\S]*?"msh:evict:stale-bar-days:v1"[\s\S]*?\]/.test(
      evict
    ),
  "neither carries a per-field TTL, so a leftover field is immortal — a stale " +
    "bar stamp would keep an evicted ticker in every barStampsRead denominator, " +
    "and leftover day evidence means a re-admitted symbol starts with days " +
    "already against it"
);

// ── 7. The sweep wires the third signal in, and says which one fired ────────
console.log("\n7. The run record distinguishes the signals");

const warm = readCodeOnly("app/api/jobs/warm-picker-universe/route.ts");
// ANCHORED ON THE SUMMARY CALL, not on the first or last recordJobRun in the
// file: these routes record twice, and the catch-block record carries only
// { error }. Three assertions in #416 passed against a record that could never
// have held the fields they were testing for.
const recIdx = job.indexOf('await recordJobRun("warm-screener-fundamentals", result.ok, {');
const record = recIdx === -1 ? "" : job.slice(recIdx);
check(
  "the sweep's run record was located",
  recIdx !== -1,
  "anchored on the summary call — the catch-block record carries only { error }"
);
check(
  "the record names the stale-bar signal separately from the metadata one",
  /absentAndFailing: sweep\.absent,/.test(record) &&
    /staleBarred: sweep\.staleBarred,/.test(record) &&
    /barStampsRead: sweep\.barStampsRead,/.test(record),
  "absentAndFailing: 0 beside staleBarred: 6 says the metadata signal went " +
    "blind; both at zero with a full barStampsRead says nothing is dead; " +
    "barStampsRead: 0 says the third signal is blind too. One folded count " +
    "answers none of the three"
);
check(
  "the record attributes the DESTRUCTIVE half to a signal as well",
  /evictedByAbsence: sweep\.evictedByAbsence,/.test(record) &&
    /evictedByStaleBars: sweep\.evictedByStaleBars,/.test(record),
  "a rising `evicted` that cannot be traced to the rule that caused it is the " +
    "one number on this record that costs data"
);
check(
  "the write end of the wire is recorded too",
  /barStampsWritten,/.test(warm) && /await flushNewestBarStamps\(\)/.test(warm),
  "barStampsWritten in warm-picker-universe against barStampsRead in the sweep " +
    "— a mismatch says the write failed, rather than that nothing is stale"
);
// SLICED, NOT `{0,400}` APART. readCodeOnly blanks comments in place rather
// than removing them, so offsets survive and a proximity window is broken by a
// comment growing between the two halves — which is exactly how the equivalent
// assertion in check-reference-cache went red for a reason unrelated to the
// code. The claim is "inside the !recorded block", so slice the block.
const notRecordedIdx = warm.indexOf("if (!recorded) {");
const notRecordedBlock =
  notRecordedIdx === -1
    ? ""
    : warm.slice(notRecordedIdx, warm.indexOf("\n    }", notRecordedIdx));
check(
  "a run that threw discards its observations instead of publishing a partial universe",
  notRecordedIdx !== -1 && /dropNewestBarStamps\(\);/.test(notRecordedBlock),
  "the sweep cannot tell a partial flush from a complete one, and every symbol " +
    "the run never reached would keep yesterday's stamp and age a day for free"
);
check(
  "the stale-bar pass runs behind the same pool-degraded gate",
  job.indexOf("sweep.skipped = `pool-degraded:${degraded}`") <
    job.indexOf("const stamps = await readNewestBarStamps();") &&
    job.indexOf("const stamps = await readNewestBarStamps();") !== -1,
  "a degraded morning is a morning the whole pipeline's evidence is suspect, " +
    "not just the price pool's"
);
const staleHandIdx = job.indexOf("const action = staleBarEvictionAction(");
const staleContIdx = staleHandIdx === -1 ? -1 : job.indexOf("continue;", staleHandIdx);
const staleEvictIdx = staleHandIdx === -1 ? -1 : job.indexOf("await evictSymbol(symbol);", staleHandIdx);
check(
  "on the stale-bar route too, hand-edit LEAVES the iteration before evictSymbol",
  staleHandIdx !== -1 &&
    staleContIdx !== -1 &&
    staleEvictIdx !== -1 &&
    staleContIdx < staleEvictIdx,
  `decision at ${staleHandIdx}, continue at ${staleContIdx}, evictSymbol at ` +
    `${staleEvictIdx} — logging before deleting the keys anyway is the loop with ` +
    `a warning attached`
);
check(
  "a symbol already handled by the absence route is not evicted twice",
  /const handled = new Set\(\[\.\.\.sweep\.evicted, \.\.\.sweep\.presetHandEdit\]\);/.test(job) &&
    /if \(handled\.has\(symbol\)\) continue;/.test(job),
  "a symbol carrying all three signals is one eviction attributed to the route " +
    "that found it, not two"
);
check(
  "recovering clears the stale-bar evidence, and only for fields that exist",
  /if \(staleDayEvidence\.has\(symbol\)\) staleRecovered\.push\(symbol\);/.test(job) &&
    /await writeStaleBarDays\(/.test(job),
  "the mirror of clearAbsence — and named rather than blanket-cleared, so a " +
    "clean universe costs no command at all"
);

console.log(
  failures === 0
    ? "\nAll eviction assertions hold.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
