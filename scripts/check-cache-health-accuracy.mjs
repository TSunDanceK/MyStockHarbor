// /cache-health was lying in two places, and both are numbers rather than prose.
//
// ─────────────────────────────────────────────────────────────────────────────
// D1 -- THE PRICE POOL WAS JUDGED AGAINST THE WRONG TIER'S POLICY.
//
//     Price pool   342 / 884 · 542 past TTL · policy 15m
//                  "61% of observed symbols past their own TTL"
//
// taken at 15:38 UTC on a Friday, so the market-closed branch #417 added does
// not explain it. #420 split the dataset -- ~200 tier-1 symbols at 15 minutes,
// the rest at 60 (priceTtlMsFor) -- and the registry kept the single 15-minute
// number, so every tier-2 symbol read as past TTL for 45 minutes in every hour.
//
// D2 -- THE DENOMINATORS WERE INFLATING, AND markRefreshed WAS DOING IT.
// A bare zadd adds absent members, so the function documented as supplying the
// NUMERATOR was writing the denominator too. dailyHistory's only markRefreshed
// caller is writeHistoryEntry, reached from every /stock/* render, so every
// symbol any crawler ever viewed joined its denominator permanently: 2,892
// against a universe of ~762.
//
// RUN, DO NOT GREP, and this file is the reason why: both defects are numbers
// that were computed correctly from the wrong inputs. A regex can see that
// zcount is called; only running it can see WHICH CUTOFF it was called with.
// Every fixture below has parts distinguishable from each other -- in
// particular a symbol that is stale under the old rule and fresh under the new
// one, because a fixture without that symbol cannot tell the two apart.
//
//   node scripts/check-cache-health-accuracy.mjs
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const queue = readCodeOnly("lib/server/stalenessQueue.ts");
const tiers = readCodeOnly("lib/server/priceTiers.ts");
const universe = readCodeOnly("lib/server/dynamicUniverseCache.ts");
const builder = readCodeOnly("lib/server/pickersBuilder.ts");
const page = readCodeOnly("app/cache-health/page.tsx");

const numFrom = (src, name) =>
  Number(
    Function(
      `"use strict"; return (${(src.match(new RegExp(`${name} = ([0-9_.* ]+);`)) ?? [])[1] ?? "0"});`
    )()
  );

const tier1Ms = numFrom(tiers, "TIER1_TTL_MS");
const tier2Ms = numFrom(tiers, "TIER2_TTL_MS");
const analysisCap = numFrom(universe, "ANALYSIS_UNIVERSE_CAP");
const tieredFn = grabFunction(queue, "readTieredHealth");
const markFn = grabFunction(queue, "markRefreshed");
const reconcileFn = grabFunction(queue, "reconcileToList");

if (!tier1Ms || !tier2Ms || !analysisCap || !tieredFn || !markFn || !reconcileFn) {
  console.error(
    `FAIL: could not extract the subject — TIER1_TTL_MS ${tier1Ms}, TIER2_TTL_MS ` +
      `${tier2Ms}, ANALYSIS_UNIVERSE_CAP ${analysisCap}, readTieredHealth ${!!tieredFn}, ` +
      `markRefreshed ${!!markFn}, reconcileToList ${!!reconcileFn}. This script ` +
      `would otherwise pass by measuring nothing.`
  );
  process.exit(1);
}

const MIN = 60_000;

// ── 1. The registry carries the tier policies, not one of them ─────────────
console.log("\n1. The price pool's policy column is the tier it actually holds to");

check(
  "pricePool's headline TTL is the SLOW tier, read from priceTiers",
  /ttlSeconds: TIER2_TTL_MS \/ 1000,/.test(queue) &&
    /fastTierTtlSeconds: TIER1_TTL_MS \/ 1000,/.test(queue),
  `${tier2Ms / MIN}m headline, ${tier1Ms / MIN}m fast — tier 2 is priceTtlMsFor's ` +
    `own default, including when the tier list is unreadable`
);
check(
  "the typed 15-minute policy is gone from the entry",
  !/pricePool: \{[\s\S]{0,800}?ttlSeconds: 60 \* 15,/.test(queue),
  "a policy column that did not move when the policy did is how #417's defect " +
    "was reacquired through a different door"
);
check(
  "the split is declared in the registry, not branched on in the page",
  /tieredPolicy: "price-tier-1",/.test(queue) &&
    !/dataset === "pricePool"/.test(page) &&
    !/"pricePool"/.test(page),
  "the next split policy should arrive by declaring it, exactly as " +
    "refreshWindow does"
);
check(
  "and the page shows both policies rather than one",
  /d\.tiers[\s\S]{0,300}?fmtDuration\(t\.ttlSeconds\)/.test(page),
  "a single correct number cannot be checked by eye against a two-policy " +
    "dataset, and this row spent weeks red because nobody could see which " +
    "policy produced it"
);

// ── 2. Each symbol judged against ITS OWN tier ─────────────────────────────
console.log("\n2. Each symbol is judged against its own tier's policy");

// THE FIXTURE. Every row exists to separate one thing from another, and three
// of them were added after a breakage run showed the first version could not
// tell a correct implementation from two broken ones.
//
//   A0  tier 1, score 0            -> never refreshed          tracked, not stale
//   A1  tier 1, refreshed  30m ago -> past its 15m policy      STALE
//   A2  tier 1, refreshed   5m ago -> inside it                fresh
//   A3  tier 1, refreshed 120m ago -> past BOTH cutoffs        STALE
//   B1  tier 2, refreshed  30m ago -> inside its 60m policy    fresh
//   B2  tier 2, refreshed  90m ago -> past it                  STALE
//   B3  tier 2, score 0            -> never refreshed          tracked, not stale
//
// B1 IS THE ONE THE FIX IS ABOUT: stale under the old single-15m rule, fresh
// under the new one. Without it both rules answer the same and the fixture
// proves nothing.
//
// A3 IS WHAT MAKES THE SUBTRACTION VISIBLE. The slow tier's count is derived as
// (everything past the slow cutoff) minus (the fast-tier symbols already
// counted there), and with no tier-1 symbol past the slow cutoff that
// subtraction is zero and a version omitting it passes.
//
// A0 IS WHAT MAKES THE SCORE-0 GUARD VISIBLE. Score 0 is excluded from the
// bulk ZCOUNT by its own bounds, so only a NEVER-REFRESHED TIER-1 symbol can
// catch a version that folds it into the stale count.
const now = 1_800_000_000_000;
const SCORES = {
  A0: 0,
  A1: now - 30 * MIN,
  A2: now - 5 * MIN,
  A3: now - 120 * MIN,
  B1: now - 30 * MIN,
  B2: now - 90 * MIN,
  B3: 0,
};
const ALL = Object.keys(SCORES);

globalThis.__TIER1 = ["A0", "A1", "A2", "A3"];
globalThis.__ZCARD = async () => ALL.length;
globalThis.__ZCOUNT = async (_key, min, max) =>
  ALL.filter((s) => SCORES[s] >= min && SCORES[s] <= max).length;
globalThis.__ZMSCORE = async (_key, members) =>
  members.map((m) => (m in SCORES ? SCORES[m] : null));

const tieredMod = await lift(
  `export ${tieredFn}`,
  `const queueKey = (d) => "msh:staleness:v1:" + d;
const readTier1 = async () => new Set(globalThis.__TIER1);
const redis = {
  zcard: (...a) => globalThis.__ZCARD(...a),
  zcount: (...a) => globalThis.__ZCOUNT(...a),
  zmscore: (...a) => globalThis.__ZMSCORE(...a),
};`
);

const split = await tieredMod.readTieredHealth(
  "pricePool",
  tier2Ms / 1000,
  tier1Ms / 1000,
  now
);
const fast = split?.tiers?.find((t) => t.label === "fast");
const rest = split?.tiers?.find((t) => t.label === "rest");

check(
  "a tier-2 symbol inside its own 60m policy is NOT counted stale",
  split?.stale === 3,
  `${split?.stale} stale (A1 and A3 past 15m, B2 past 60m) — the single-15m ` +
    `rule counted 4, adding B1 at 30 minutes old, which is the whole 542`
);
check(
  "the fast tier is judged at 15m and reported separately",
  fast?.tracked === 4 && fast?.stale === 2 && fast?.ttlSeconds === tier1Ms / 1000,
  `${fast?.stale} / ${fast?.tracked} @ ${fast?.ttlSeconds}s — a tier-1 symbol ` +
    `20 minutes stale must still be a fault, or this fix trades one wrong ` +
    `number for another`
);
check(
  "the slow tier is judged at 60m and does not re-count the fast tier",
  rest?.tracked === ALL.length - 4 && rest?.stale === 1 && rest?.ttlSeconds === tier2Ms / 1000,
  `${rest?.stale} / ${rest?.tracked} @ ${rest?.ttlSeconds}s — A3 is past the ` +
    `slow cutoff too and is already counted in the fast tier, so leaving it in ` +
    `the remainder would report it twice`
);
check(
  "a never-refreshed tier-1 symbol is tracked but not stale",
  fast?.tracked === 4 && fast?.stale === 2 && SCORES.A0 === 0,
  "A0 is in the fast tier at score 0. The bulk ZCOUNT excludes score 0 by its " +
    "own bounds, so only a tier-1 member can catch a version that folds " +
    "never-refreshed into the stale count and double-reports it against the " +
    "`never` column"
);

// AN UNREADABLE TIER LIST DEGRADES TO ALL-TIER-2, the lenient direction and the
// same answer priceTtlMsFor itself gives for an empty set. Degrading the other
// way would recreate the defect.
globalThis.__TIER1 = [];
const degraded = await tieredMod.readTieredHealth(
  "pricePool",
  tier2Ms / 1000,
  tier1Ms / 1000,
  now
);
check(
  "an empty tier-1 list judges everything at the slow policy",
  degraded?.stale === 2 && degraded?.tiers?.[0]?.tracked === 0,
  `${degraded?.stale} stale (A3 and B2, both past 60m) — priceTtlMsFor returns ` +
    `TIER2_TTL_MS for a symbol absent from the set, so the page must agree with ` +
    `the code it is reporting on`
);
globalThis.__TIER1 = ["A1", "A2"];

// ── 3. markRefreshed supplies the numerator and nothing else ───────────────
console.log("\n3. markRefreshed no longer writes the denominator");

const zaddCalls = [];
const markMod = await lift(
  markFn,
  `const queueKey = (d) => "msh:staleness:v1:" + d;
const deferKey = (d) => "msh:staleness-defer:v1:" + d;
const DATASETS = new Proxy({}, { get: (_t, k) => ({ coverage: globalThis.__COVERAGE[k] }) });
const redis = {
  pipeline: () => ({
    zadd: (...a) => globalThis.__ZADD(...a),
    zrem: () => {},
    exec: async () => [],
  }),
};`
);
globalThis.__ZADD = (...args) => zaddCalls.push(args);
globalThis.__COVERAGE = { dailyHistory: "registered", news: "observed-only" };

await markMod.markRefreshed("dailyHistory", ["AAA", "BBB"], now);
const registeredCall = zaddCalls.at(-1);
zaddCalls.length = 0;
await markMod.markRefreshed("news", ["CCC"], now);
const observedCall = zaddCalls.at(-1);

check(
  "a REGISTERED dataset updates existing members only",
  registeredCall?.[1]?.xx === true,
  "registerSymbols declares the denominator and markRefreshed supplies the " +
    "numerator — the contract this file documents forty lines above the bug"
);
check(
  "an OBSERVED-ONLY dataset still adds, because that IS its denominator",
  observedCall?.[1]?.xx === undefined && observedCall?.[1]?.member === "CCC",
  "news, sectorNews and screenerFundamentals have no registerSymbols caller; " +
    "`xx` everywhere would empty all three"
);
check(
  "the behaviour is driven by the coverage declaration, not a dataset name",
  !/dataset === "dailyHistory"/.test(queue) &&
    /DATASETS\[dataset\]\.coverage === "observed-only"/.test(queue),
  "the declaration already means exactly this and check-cache-health-page " +
    "already asserts it matches the tree"
);

// FLIP THE DECLARATION AND THE BEHAVIOUR FOLLOWS. This is what makes the
// assertion above about coupling rather than about one hard-coded pairing.
globalThis.__COVERAGE = { dailyHistory: "observed-only" };
zaddCalls.length = 0;
await markMod.markRefreshed("dailyHistory", ["AAA"], now);
check(
  "re-declaring a dataset observed-only flips it back to adding",
  zaddCalls.at(-1)?.[1]?.xx === undefined,
  "a name check would ignore the declaration and keep the old behaviour"
);

// ── 4. The reconcile is guarded, and only one caller may use it ────────────
console.log("\n4. The backlog is cleared only against a list that is really the universe");

const floor = Math.floor(analysisCap / 2);
const zremCalls = [];
const reconcileMod = await lift(
  `export ${reconcileFn}`,
  `const queueKey = (d) => "msh:staleness:v1:" + d;
const deferKey = (d) => "msh:staleness-defer:v1:" + d;
const ANALYSIS_UNIVERSE_CAP = ${analysisCap};
const AUTHORITATIVE_FLOOR = Math.floor(ANALYSIS_UNIVERSE_CAP / 2);
const redis = {
  zrange: (...a) => globalThis.__RZRANGE(...a),
  pipeline: () => ({ zrem: (...a) => globalThis.__RZREM(...a), exec: async () => [] }),
};`
);
globalThis.__RZREM = (...args) => zremCalls.push(args);

// Tracked = the authoritative list plus three symbols that were never in it --
// the shape the render path produced. Named so they are distinguishable from
// the universe members rather than being "the last three".
const authoritative = Array.from({ length: floor + 10 }, (_, i) => `U${i}`);
const strays = ["CRAWLED1", "CRAWLED2", "^GSPC"];
globalThis.__RZRANGE = async () => [...authoritative, ...strays];

zremCalls.length = 0;
await reconcileMod.reconcileToList("dailyHistory", authoritative);
const dropped = zremCalls.flatMap((c) => c.slice(1));
check(
  "symbols absent from the authoritative list are dropped, and only those",
  zremCalls.length === 2 &&
    strays.every((s) => dropped.includes(s)) &&
    !dropped.some((s) => s.startsWith("U")),
  `dropped ${strays.join(", ")} and nothing else — this is the ~2,130 that ` +
    `every /stock/* render added over months`
);
check(
  "the defer set is cleaned too",
  zremCalls.some((c) => String(c[0]).includes("staleness-defer")),
  "a deferral for a symbol nothing tracks any more is an orphan in a set only " +
    "claimStalest prunes"
);

// THE GUARD, IN THE FAILING DIRECTION IT ACTUALLY MATTERS. A truncated list
// must be refused: pruning against it SHRINKS the denominator, which makes
// every ratio on the page look better, which is the direction nobody
// investigates.
zremCalls.length = 0;
await reconcileMod.reconcileToList("dailyHistory", authoritative.slice(0, floor - 1));
check(
  "a list below the derived floor is refused outright",
  zremCalls.length === 0,
  `floor is ${floor} — half of ANALYSIS_UNIVERSE_CAP (${analysisCap}), derived ` +
    `rather than typed, so raising the cap raises the guard`
);
check(
  "the floor is derived from the cap, not written down",
  /const AUTHORITATIVE_FLOOR = Math\.floor\(ANALYSIS_UNIVERSE_CAP \/ 2\);/.test(queue),
  "a typed floor is right until the cap moves and then wrong in the " +
    "reassuring direction"
);

// A FAILED READ REMOVES NOTHING. Reading zero members and deleting everything
// absent from the list is the same code path as a wipe.
zremCalls.length = 0;
globalThis.__RZRANGE = async () => {
  throw new Error("upstash said no");
};
// CAUGHT HERE RATHER THAN LEFT TO REJECT. A throw escaping this function is
// itself a failure -- registerSymbols would swallow it and the caller would
// never learn the prune did not happen -- and an unhandled rejection kills the
// harness with a stack trace instead of a legible FAIL line.
let threw = false;
try {
  await reconcileMod.reconcileToList("dailyHistory", authoritative);
} catch {
  threw = true;
}
check(
  "a failed read of the tracked set removes nothing, and does not throw",
  zremCalls.length === 0 && !threw,
  "the prune is destructive and a read failure must not be able to drive it"
);

check(
  "exactly one caller is authoritative, and it is the daily-history one",
  (builder.match(/\{ authoritative: true \}/g) ?? []).length === 1 &&
    /registerSymbols\("dailyHistory", universe, \{ authoritative: true \}\)/.test(builder) &&
    /getDailyHistoryBulk\(universe,/.test(builder),
  "the list registered and the list refreshed are the same `universe` array " +
    "two lines apart, which is what makes the claim checkable rather than a " +
    "comment asserting itself"
);

// ── 5. The seam with #429 ──────────────────────────────────────────────────
console.log("\n5. readPastTtl is only asked about single-policy datasets");

// WHY THIS EXISTS, AND IT IS A COMPOSITION BUG RATHER THAN EITHER PR'S.
//
// #429 added readPastTtl, which derives its cutoff from DATASETS[x].ttlSeconds
// -- correct then, because every dataset had exactly one policy. This PR makes
// that field the SLOW tier for anything declaring tieredPolicy. A tiered
// dataset passed to readPastTtl would therefore have its fast-tier symbols
// judged four times too leniently and silently under-reported: the same defect
// readTieredHealth was written to fix, reappearing in a different reader.
//
// Neither PR is wrong on its own and both were green in isolation. The only
// place the pairing is visible is here, so it is asserted here.
const TIERED = Object.keys(
  Object.fromEntries(
    [...queue.matchAll(/^  (\w+): \{([\s\S]*?)^  \},$/gm)]
      .filter(([, , body]) => /tieredPolicy:/.test(body))
      .map(([, name]) => [name, true])
  )
);
const callSites = [
  ...readCodeOnly("app/api/jobs/warm-earnings/route.ts").matchAll(/readPastTtl\(\s*"(\w+)"/g),
].map((m) => m[1]);

check(
  "the registry really does declare a tiered dataset, so this is not vacuous",
  TIERED.length >= 1 && TIERED.includes("pricePool"),
  `tiered: ${TIERED.join(", ") || "none"} — an empty list would make the ` +
    `assertion below pass by having nothing to check`
);
check(
  "and at least one readPastTtl call site was found",
  callSites.length >= 1,
  `call sites: ${callSites.join(", ") || "none"} — a renamed function would ` +
    `otherwise leave this green while the seam reopened`
);
check(
  "no readPastTtl call names a tiered dataset",
  callSites.every((d) => !TIERED.includes(d)),
  `${callSites.join(", ")} against tiered ${TIERED.join(", ")} — the fix for a ` +
    `tiered caller is readTieredHealth's two-cutoff arithmetic, not this ` +
    `function's single one`
);

console.log(
  failures === 0
    ? "\nEach symbol is judged against its own policy, and the denominator is a population again.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
