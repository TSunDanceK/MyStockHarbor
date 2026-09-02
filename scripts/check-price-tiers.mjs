// The price freshness tiers, and the market-hours gate that pays for them.
//
// WHY THIS EXISTS. #392 fixed FMP's rate limit and cost price freshness doing
// it: over half the universe ended up past its own 15-minute policy while every
// job still reported a clean run. The replacement policy is only as good as
// three properties that are all invisible when they break --
//
//   * the market-hours gate is DERIVED from Eastern local time, not written out
//     as a UTC hour range. A UTC range is right for eight months a year and
//     silently an hour wrong for the other four, in the direction that skips the
//     first hour of trading. This repo has already shipped that bug once
//     (historyCache.ts:68, hardcoded -05:00).
//   * tier 1 is selected by ATTENTION, never by market cap. Cap ordering would
//     put a $3.7T name nobody has opened in the fast tier and leave the $3.3B
//     name people are reading in the slow one, and because cap barely moves it
//     would be a frozen list wearing a heuristic's clothes.
//   * the pre-open buffer is long enough to re-price the whole universe before
//     the bell. Every symbol is past its TTL after the overnight gap, so the
//     first runs of the day carry the entire universe; if the buffer is too
//     short the opening bell finds rows still showing a % change computed
//     against the WRONG previous close, which looks plausible and stays wrong
//     all session.
//
// None of the three throws when broken. The first two are asserted by RUNNING
// the shipped functions rather than grepping for them -- a regex cannot tell a
// cap that is applied from one that is merely declared
// (claude/traps/a-regex-over-source-has-no-scope.md) -- and the third is
// arithmetic over the real constants.
//
//   node scripts/check-price-tiers.mjs
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

async function load(relPath, patch = (x) => x) {
  const src = patch(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

// The real modules. priceTiers needs its Redis construction stubbed out; every
// function asserted below is pure and never reaches it.
const hours = await load("lib/server/marketHours.ts");
const tiers = await load("lib/server/priceTiers.ts", (src) =>
  src
    .replace(/import \{ Redis \} from "@upstash\/redis";/, "")
    .replace(/import \{ PAGE_READ_CACHE \} from ".\/redisCacheMode";/, "")
    .replace(/const redis =[\s\S]*?: null;/, "const redis = null;")
);

// ── 1. The gate is derived from Eastern local time ──────────────────────────
console.log("\n1. Market-hours gating exists and is derived, not typed out");

const poolSrc = readCodeOnly("lib/server/pricePool.ts");
check(
  "warmPricePool refuses to run outside the active window",
  /isActiveMarketWindow\(/.test(poolSrc) && /reason:\s*"market-closed"/.test(poolSrc),
  "without this the cron re-fetches a price that cannot have moved for two " +
    "thirds of every day, which is the saving the 15-minute tier is spent from"
);

const hoursSrc = readCodeOnly("lib/server/marketHours.ts");
check(
  'the Eastern reading comes from Intl timeZone: "America/New_York"',
  /timeZone:\s*"America\/New_York"/.test(hoursSrc),
  "Intl is what applies the DST rule; nothing else here knows when it changes"
);
// The specific defect this repo already shipped: a fixed offset standing in for
// a timezone. -05:00 is EST, correct only from November to March.
check(
  "no fixed UTC offset anywhere in the module",
  !/[-+]0[45]:00/.test(hoursSrc),
  "getNextMondayOpenUtcMsFromEastern hardcoded -05:00 and ran an hour late for " +
    "the ~8 months a year New York is on EDT (historyCache.ts:68)"
);

// The bounds must be COMPUTED from the session and the buffers. A literal
// `8 * 60 + 30` would be the same number today and would not follow if either
// input moved.
check(
  "the window bounds are computed from the session times and the buffers",
  /ACTIVE_WINDOW_START_MINUTES_ET\s*=\s*\n?\s*REGULAR_OPEN_MINUTES_ET\s*-\s*PRE_OPEN_BUFFER_MINUTES/.test(hoursSrc) &&
    /ACTIVE_WINDOW_END_MINUTES_ET\s*=\s*\n?\s*REGULAR_CLOSE_MINUTES_ET\s*\+\s*POST_CLOSE_BUFFER_MINUTES/.test(hoursSrc),
  "a literal here is right until someone changes a buffer, and then wrong with " +
    "nothing to say so"
);

// Run it in both DST seasons at the same UTC instant. This is the assertion a
// UTC hour range cannot pass: 13:45 UTC is inside the session in July and
// nearly an hour before the open in January.
const julyOpen = new Date("2026-07-15T13:45:00Z"); // 09:45 EDT — trading
const janOpen = new Date("2026-01-14T13:45:00Z"); //  08:45 EST — pre-open buffer
const janLate = new Date("2026-01-14T20:45:00Z"); //  15:45 EST — trading
const julyLate = new Date("2026-07-15T20:45:00Z"); // 16:45 EDT — post-close buffer
check(
  "13:45 UTC is mid-session in July but only pre-open in January",
  hours.isRegularSessionOpen(julyOpen) && !hours.isRegularSessionOpen(janOpen),
  "the same UTC clock time is a different session position in the two halves " +
    "of the year — this is the assertion a UTC range fails"
);
check(
  "20:45 UTC is mid-session in January but past the close in July",
  hours.isRegularSessionOpen(janLate) && !hours.isRegularSessionOpen(julyLate),
  "the other end of the same drift"
);
check(
  "both are still inside the buffered window either season",
  [julyOpen, janOpen, janLate, julyLate].every((d) => hours.isActiveMarketWindow(d)),
  "the buffers are what make the gate tolerant of the shift rather than brittle"
);
check(
  "weekends and the small hours are out",
  !hours.isActiveMarketWindow(new Date("2026-07-18T15:00:00Z")) && // Saturday
    !hours.isActiveMarketWindow(new Date("2026-07-15T06:00:00Z")), // 02:00 ET
  "Saturday 11:00 ET and Wednesday 02:00 ET"
);

// ── 2. Tier 1 is attention, never market cap ────────────────────────────────
console.log("\n2. Tier 1 membership is attention, not market cap");

const tiersSrc = readCodeOnly("lib/server/priceTiers.ts");
const targetsSrc = readCodeOnly("lib/server/warmTargets.ts");
check(
  "no market-cap field is read anywhere in the selection path",
  !/marketCap/i.test(tiersSrc) && !/marketCap/i.test(targetsSrc),
  "a live picker list showed FSLY at $3.33B directly above MSFT at $3.72T — " +
    "cap says nothing about who is looking"
);

// Run the real selector. The signals are named after what they are, so a future
// edit that swaps one for a cap-ranked list has to rename a parameter to do it.
const SIGNAL_KEYS = [
  "presetSymbols",
  "dollarVolumeRanked",
  "moverSymbols",
  "searchedSymbols",
  "pickerSymbols",
  "universe",
];
const universe = Array.from({ length: 500 }, (_, i) => `SYM${i}`);
const NO_SIGNALS = {
  presetSymbols: [],
  dollarVolumeRanked: [],
  moverSymbols: [],
  searchedSymbols: [],
  pickerSymbols: [],
};
const selected = tiers.selectTier1({
  ...NO_SIGNALS,
  pickerSymbols: ["SYM1", "SYM2", "sym2"],
  searchedSymbols: ["SYM3"],
  moverSymbols: ["SYM4"],
  universe,
});
check(
  "selectTier1 takes exactly the attention signals, by name",
  SIGNAL_KEYS.every((k) => new RegExp(`\\b${k}\\b`).test(tiersSrc)),
  SIGNAL_KEYS.join(", ")
);
check(
  "it unions the signals and de-duplicates case-insensitively",
  selected.length === 4 && new Set(selected).size === 4,
  `${selected.join(", ")} — "sym2" and "SYM2" are one symbol`
);

// The search cap is the one input a stranger can move: public, unauthenticated,
// rate-limited only per IP. Uncapped it would promote the universe.
const flood = tiers.selectTier1({
  ...NO_SIGNALS,
  searchedSymbols: universe,
  universe,
});
check(
  "search promotions are capped, so a flood cannot promote the universe",
  flood.length === tiers.TIER1_SEARCH_PROMOTION_CAP,
  `${flood.length} promoted from 500 searched, cap ${tiers.TIER1_SEARCH_PROMOTION_CAP}`
);
check(
  "a symbol outside the warm universe is never admitted",
  tiers.selectTier1({
    ...NO_SIGNALS,
    presetSymbols: ["NOTOURS"],
    dollarVolumeRanked: ["NOTOURS"],
    moverSymbols: ["NOTOURS"],
    searchedSymbols: ["NOTOURS"],
    pickerSymbols: ["NOTOURS"],
    universe,
  }).length === 0,
  "otherwise a search box hands a stranger the power to add a symbol the site " +
    "does not display to every run"
);

// ── 2b. The base works on a site with no visitors ───────────────────────────
console.log("\n2b. Tier 1 is non-empty with every traffic-fed signal empty");

// THE ACTUAL DEFECT THIS SECTION EXISTS FOR. readAboveFold records a row when a
// PAGE RENDERS and readSearchDemand needs three distinct searchers, so on a
// site with no traffic both are empty and tier 1 used to collapse to the mover
// buckets alone -- the design measured attention without checking any existed.
// Asserted by RUNNING the selector with those two inputs empty, which is the
// only way to tell a base that works from one that merely looks present.
const preset = ["SYM0", "SYM1", "SYM2"];
const noTraffic = tiers.selectTier1({
  presetSymbols: preset,
  dollarVolumeRanked: ["SYM10", "SYM11"],
  moverSymbols: ["SYM20"],
  searchedSymbols: [],
  pickerSymbols: [],
  universe,
});
check(
  "no traffic at all still yields a tier 1",
  noTraffic.length === 6,
  `${noTraffic.length} symbols from preset + dollar volume + movers, with both ` +
    `traffic-fed signals empty`
);
check(
  "the hand-curated preset alone is enough",
  tiers.selectTier1({ ...NO_SIGNALS, presetSymbols: preset, universe }).length === 3,
  "PRESET_UNIVERSE is a hand-typed array in the bundle -- it cannot fail to " +
    "load, cannot be empty, and needs no visitor, Redis read or FMP call, which " +
    "is the property the traffic-fed design did not have"
);
// WITH THE LAYER NON-EMPTY. The first version of this asserted the ordering on
// `noTraffic`, whose searched and picker lists are both empty -- so swapping the
// base and the layer changed nothing and the assertion could not fail. An
// ordering test needs both sides populated to mean anything.
const withTraffic = tiers.selectTier1({
  presetSymbols: preset,
  dollarVolumeRanked: ["SYM10"],
  moverSymbols: ["SYM20"],
  searchedSymbols: ["SYM30", "SYM31"],
  pickerSymbols: ["SYM40"],
  universe,
});
check(
  "the base is ordered ahead of the layer, so a cap sheds traffic signals first",
  withTraffic.slice(0, preset.length).join(",") === preset.join(",") &&
    withTraffic.indexOf("SYM20") < withTraffic.indexOf("SYM30"),
  `${withTraffic.join(",")} — the reverse would let a quiet week shrink the fast tier`
);

// A selector whose whole purpose is "never return nothing" must not be the
// thing that returns nothing by throwing. A throw here does not degrade tier 1
// -- it propagates out of getWarmTargetSymbols and takes the work list for all
// three warm jobs with it.
let threw = null;
try {
  tiers.selectTier1({ universe });
} catch (err) {
  threw = err;
}
check(
  "a signal set missing fields entirely degrades rather than throwing",
  threw === null,
  threw ? `threw ${threw.message}` : "returns whatever it can build"
);

// ── 2c. Dollar volume, and specifically not market cap ──────────────────────
console.log("\n2c. The base ranks by dollar volume, and cold rows are unknown");

const rank = (rows) =>
  tiers.rankByDollarVolume(new Map(Object.entries(rows)), ["BIG", "MID", "COLD", "QUIET"]);

// The FSLY/MSFT case, in miniature: MID is a fraction of BIG's price but trades
// far more of it. Cap ordering puts BIG first; dollar volume does not.
const ranked = rank({
  BIG: { price: 1000, volume: 1_000 },      //   1,000,000 traded
  MID: { price: 10, volume: 5_000_000 },    //  50,000,000 traded
  QUIET: { price: 50, volume: 2_000 },      //     100,000 traded
  COLD: { price: null, volume: null },      //  no row yet
});
check(
  "a cheap heavily-traded name outranks an expensive quiet one",
  ranked[0] === "MID" && ranked.indexOf("BIG") < ranked.indexOf("QUIET"),
  `${ranked.join(" > ")} — a $3B name can out-trade a sleepy $50B utility, which ` +
    `is why this is not market cap`
);
check(
  "a symbol with no pool row is left OUT of the ranking, not sorted last",
  !ranked.includes("COLD"),
  "ranking it last asserts it is quiet when the truth is nobody has asked yet; " +
    "isPriceDue already treats a row-less symbol as DUE, so it gets a price on " +
    "the next run whatever tier it is in — the exposure is one run"
);
// VARY THE UNIVERSE ORDER, NOT THE MAP ORDER. Two earlier versions of this
// could not fail. The first used symbols absent from the universe it passed, so
// both rankings came back EMPTY and it compared "" to "". The second varied the
// Map's insertion order — but rankByDollarVolume iterates the UNIVERSE ARRAY,
// so the Map's order never reaches the sort and the result was identical with
// the tie-break deleted.
//
// The universe array is the thing that actually varies: getWarmTargetSymbols
// builds it as Array.from(new Set([...displayed, ...universeSymbols])), whose
// order shifts between pickers builds. Without a tie-break, two symbols with
// equal dollar volume swap places when that order shifts, and near the
// TIER1_DOLLAR_VOLUME_CAP boundary that decides which of them is in the fast
// tier — a membership change with no cause anyone could point to.
const tieRows = new Map([
  ["BIG", { price: 1, volume: 100 }],
  ["MID", { price: 10, volume: 10 }],
]);
const forward = tiers.rankByDollarVolume(tieRows, ["BIG", "MID"]);
const reversed = tiers.rankByDollarVolume(tieRows, ["MID", "BIG"]);
check(
  "the ranking is deterministic, so tier 1 does not flicker between runs",
  forward.length === 2 && forward.join(",") === reversed.join(","),
  `${forward.join(",")} vs ${reversed.join(",")} — both are 100 dollars traded, so ` +
    `without a tie-break the two universe orders give two answers and the fast ` +
    `tier's membership changes for no visible reason`
);

// ── 3. The TTLs mean what the page says they mean ───────────────────────────
console.log("\n3. The two policies, and what happens when the tier is unknown");

const tier1 = new Set(["FAST"]);
const now = 1_000_000_000;
check(
  "the fast tier is 15 minutes and the tail is slower",
  tiers.TIER1_TTL_MS === 15 * 60_000 && tiers.TIER2_TTL_MS > tiers.TIER1_TTL_MS,
  `${tiers.TIER1_TTL_MS / 60_000} / ${tiers.TIER2_TTL_MS / 60_000} minutes — the tail's ` +
    `exact value is decided by the fit assertion below, not pinned here`
);

// THE POLICY MUST FIT THE UNIVERSE THE CAPS ALLOW, AND THAT IS WHAT COUPLES
// THIS CONSTANT TO THE GROWTH STEP.
//
// The tail was briefly 60, sized for 3,000 symbols where 15/30 needs ~7,000
// calls/hour against a usable ceiling of ~6,720. That arithmetic is right and
// the constraint does not exist yet: production on 2026-09-02 reached
// deferredByCap 0 within four runs at 762 symbols, so the TTLs are already the
// binding policy and there is spare capacity. Moving the tail to 60 now would
// halve the freshness of ~332 symbols to buy headroom nothing is asking for.
//
// So this is computed against ANALYSIS_UNIVERSE_CAP rather than against a typed
// 3,000. Today it passes comfortably at 30; the moment someone raises that cap
// toward 3,000 without also moving TIER2_TTL_MS, it fails. The pairing the
// comment in priceTiers.ts promises is enforced here rather than remembered.
//
// The basis is the ANALYSED cap, not the analysed + dynamic sum the pre-open
// buffer uses. Those answer different questions: the buffer is worst-case work
// inside one window, where the sum is the honest bound; this is a SUSTAINED
// rate over a universe whose two pools overlap heavily. The observed warm union
// is 762 against a 700 cap, ~9% above it, which the 80% ceiling absorbs.
const TARGET_FAST = 500;
const analysedCap = Number(
  (readCodeOnly("lib/server/dynamicUniverseCache.ts").match(
    /ANALYSIS_UNIVERSE_CAP = (\d+)/
  ) ?? [])[1]
);
if (!analysedCap) {
  console.error("FAIL: could not read ANALYSIS_UNIVERSE_CAP — measuring nothing.");
  process.exit(1);
}
const fastCount = Math.min(TARGET_FAST, analysedCap);
const callsPerHour =
  fastCount / (tiers.TIER1_TTL_MS / 3_600_000) +
  (analysedCap - fastCount) / (tiers.TIER2_TTL_MS / 3_600_000);
const usablePerHour = 140 * 60;
check(
  "the two policies fit inside the usable call rate at the universe the caps allow",
  callsPerHour <= usablePerHour * 0.8,
  `${Math.round(callsPerHour)} calls/hour at a cap of ${analysedCap} against ` +
    `${usablePerHour} usable — the 80% ceiling leaves room for history, earnings and ` +
    `fundamentals. Raising the cap toward 3,000 breaks this at a 30-minute tail ` +
    `(7,000/hour) and passes at 60 (4,500), which is what makes the TTL and the ` +
    `growth step land together`
);
check(
  "a symbol not in tier 1 falls to the SLOWER policy, never to 'never'",
  tiers.priceTtlMsFor("ANY", new Set()) === tiers.TIER2_TTL_MS,
  "an unreadable or empty tier list must degrade to 30 minutes for everyone, " +
    "which is the failure mode readTier1 fails open into"
);
check(
  "16 minutes is due for tier 1 and not yet for tier 2",
  tiers.isPriceDue(now - 16 * 60_000, "FAST", tier1, now) &&
    !tiers.isPriceDue(now - 16 * 60_000, "SLOW", tier1, now),
  "the whole point of the split"
);
// Written against the CONSTANT rather than against a typed 31/61, so the pair
// keeps testing the boundary wherever the tail sits. Hard-coding the minutes is
// how a test comes to assert the policy the code used to have.
const tailMin = tiers.TIER2_TTL_MS / 60_000;
check(
  `just under the tail's ${tailMin} minutes is due for tier 1 only`,
  tiers.isPriceDue(now - (tailMin - 1) * 60_000, "FAST", tier1, now) &&
    !tiers.isPriceDue(now - (tailMin - 1) * 60_000, "SLOW", tier1, now),
  `${tailMin - 1} minutes — past the 15-minute fast policy, inside the tail's`
);
check(
  "just over it is due for both",
  tiers.isPriceDue(now - (tailMin + 1) * 60_000, "FAST", tier1, now) &&
    tiers.isPriceDue(now - (tailMin + 1) * 60_000, "SLOW", tier1, now),
  `${tailMin + 1} minutes`
);
check(
  "a never-fetched symbol is due, not fresh",
  tiers.isPriceDue(undefined, "SLOW", tier1, now) && tiers.isPriceDue(0, "SLOW", tier1, now),
  "absent and zero must not read as a recent refresh " +
    "(claude/traps/absence-needs-the-producer-to-have-run.md)"
);

// ── 4. The opening-bell rollover ────────────────────────────────────────────
console.log("\n4. The % change rolls over before the bell, not after it");

const poolCode = poolSrc;
// PRICE_MAX_PER_RUN IS EVALUATED, NOT READ AS A LITERAL, because it is no
// longer one. It was a typed 220 carrying the comment "bound a single run's
// length (~<1 min even paced)" -- a constraint #396 removed when the loop
// started spanning minute buckets, so the bound was sized for a run that no
// longer exists and capped a four-minute one at a quarter of its reach. It is
// now (FMP_SAFE_CALLS_PER_MINUTE - FMP_MIN_HEADROOM_CALLS) x the run budget in
// minutes. Pulling the numbers out of that expression and multiplying them here
// would be a second opinion about the same quantity; evaluating it is not.
const capExprSrc = (poolCode.match(
  /const PRICE_MAX_PER_RUN = Math\.floor\(([\s\S]*?)\);/
) ?? [])[1];
const safePerMin = Number(
  (readCodeOnly("lib/server/historyCache.ts").match(
    /FMP_SAFE_CALLS_PER_MINUTE = (\d+)/
  ) ?? [])[1]
);
const headroom = Number((poolCode.match(/FMP_MIN_HEADROOM_CALLS = (\d+)/) ?? [])[1]);
const runBudgetMs = Number(
  (poolCode.match(/PRICE_RUN_BUDGET_MS = ([0-9_]+)/) ?? [])[1]?.replace(/_/g, "")
);
const capMax =
  capExprSrc && safePerMin && headroom && runBudgetMs
    ? Function(
        `"use strict";
         const FMP_SAFE_CALLS_PER_MINUTE = ${safePerMin};
         const FMP_MIN_HEADROOM_CALLS = ${headroom};
         const USABLE_CALLS_PER_MINUTE = FMP_SAFE_CALLS_PER_MINUTE - FMP_MIN_HEADROOM_CALLS;
         const PRICE_RUN_BUDGET_MS = ${runBudgetMs};
         return Math.floor(${capExprSrc});`
      )()
    : NaN;
const cronSrc = readCodeOnly("lib/server/jobRuns.ts");
const cron = (cronSrc.match(/"warm-price-pool":[^}]*cron:\s*"([^"]+)"/) ?? [])[1];
const everyMinutes = Number((String(cron).match(/^\*\/(\d+)/) ?? [])[1]);

if (!capMax || !everyMinutes) {
  console.error(
    `FAIL: could not read PRICE_MAX_PER_RUN (${capMax}) or the warm-price-pool ` +
      `cron (${cron}) — this section would otherwise pass by measuring nothing.`
  );
  process.exit(1);
}

// After the overnight gap every symbol is past its TTL at once, so the runs
// inside the pre-open buffer carry the entire universe. Whatever they do not
// reach opens the session showing a % change computed against the wrong
// previous close.
const preOpenRuns = Math.floor(hours.PRE_OPEN_BUFFER_MINUTES / everyMinutes);
const repriceable = preOpenRuns * capMax;

// THE TARGET IS READ FROM THE CONSTANTS, NOT TYPED.
//
// It was `const TARGET_UNIVERSE = 3000; // the size this design was costed at`.
// preOpenRuns and capMax were derived from real constants and this one was not,
// so the assertion was only ever as true as a literal nobody would think to
// update -- and the failure it guards is silent. Past the coverage the buffer
// can manage, symbols open the session showing a % change computed against the
// wrong previous close, and the check went on passing.
//
// The real bound on what warm-price-pool is handed is getWarmTargetSymbols:
// the symbols a pickers build analysed, UNIONED with the rolling dynamic
// universe. Those are two separately-capped pools, so the worst case is their
// sum -- which is why the live figure is 759 against a 700 analysis cap, and
// why using either one alone would understate it.
const universeSrc = readCodeOnly("lib/server/dynamicUniverseCache.ts");
const analysisCap = Number(
  (universeSrc.match(/ANALYSIS_UNIVERSE_CAP = (\d+)/) ?? [])[1]
);
const dynamicCap = Number(
  (universeSrc.match(/MAX_DYNAMIC_UNIVERSE_SIZE = (\d+)/) ?? [])[1]
);
if (!analysisCap || !dynamicCap) {
  console.error(
    `FAIL: could not read ANALYSIS_UNIVERSE_CAP (${analysisCap}) or ` +
      `MAX_DYNAMIC_UNIVERSE_SIZE (${dynamicCap}) — the buffer assertion would ` +
      `otherwise compare against NaN and pass by measuring nothing.`
  );
  process.exit(1);
}
const targetUniverse = analysisCap + dynamicCap;

check(
  "the pre-open buffer can re-price the largest universe the caps allow",
  repriceable >= targetUniverse,
  `${preOpenRuns} runs x ${capMax}/run = ${repriceable} symbols in the ` +
    `${hours.PRE_OPEN_BUFFER_MINUTES}-minute buffer, against a worst case of ` +
    `${analysisCap} analysed + ${dynamicCap} dynamic = ${targetUniverse} — anything ` +
    `left over opens the session showing yesterday's % change, silently`
);

// The four builders must all read the shared constant. Raising three of four
// leaves them disagreeing about how big the universe is, and each still reads
// as correct on its own -- the symptom is a pattern page missing names the
// screener shows, not an error.
const BUILDERS = [
  "lib/server/bullFlagsBuilder.ts",
  "lib/server/descendingTrianglesBuilder.ts",
  "lib/server/playsBuilder.ts",
  "lib/server/pickersBuilder.ts",
];
const localCaps = BUILDERS.filter((f) =>
  /const UNIVERSE_CAP = \d+/.test(readCodeOnly(f))
);
check(
  "no builder re-declares the universe cap as its own literal",
  localCaps.length === 0,
  localCaps.length
    ? `${localCaps.join(", ")} still hard-code it`
    : `all ${BUILDERS.length} read ANALYSIS_UNIVERSE_CAP`
);
// dynamicUniverseCache is the deliberate exception and must STAY separate: it
// prunes destructively where the builders only slice, and it is one input to a
// build rather than the whole of it. Asserting it keeps its own number stops a
// future tidy-up from merging two different quantities into one.
check(
  "the dynamic-universe retention cap is still its own separate constant",
  /const MAX_DYNAMIC_UNIVERSE_SIZE = \d+/.test(universeSrc),
  "it PRUNES (ZREM, destroying score history) where the builders only slice, " +
    "and it is one input to a pickers build alongside PRESET_UNIVERSE and the " +
    "search promotions — folding it in would be one constant changing two things"
);

// ── 5. Degradation matches the policy, and the page says so ─────────────────
console.log("\n5. When the cap binds, and what the reader is told");

check(
  "the due set is ordered by tier before staleness",
  /const tierDelta = Number\(tier1\.has\(b\)\) - Number\(tier1\.has\(a\)\);\s*\n\s*if \(tierDelta\) return tierDelta;/.test(
    poolCode
  ),
  "sorting by raw timestamp would favour tier 2 forever — it is ALLOWED to be " +
    "twice as old, so it always looks staler and would crowd tier 1 out of " +
    "every capped run"
);
check(
  "a run records what it deferred rather than leaving the worst case assumed",
  /deferredByCap/.test(poolCode) && /quoteFailures/.test(poolCode) && /outOfTime/.test(poolCode),
  "due <= priceCap with deferredByCap 0 means the TTLs are the real policy; a " +
    "persistent deferral means the cap is, and the TTLs are aspirational"
);

// ── 6. The run outlives the minute bucket ──────────────────────────────────
console.log("\n6. A single exhausted minute pauses the run, it does not end it");

// The defect this section exists for: `break` on hasFmpCapacity stopped the
// loop at 140 calls -- the minute's ceiling -- while the function held 300
// seconds of maxDuration. Four of every five minutes went unused, and four
// consecutive production runs refreshed 128-136 against a cap of 190.
check(
  "the refresh loop never abandons the run on an exhausted minute bucket",
  !/if \(!\(await hasFmpCapacity\([^)]*\)\)\) \{\s*\n\s*\w+ = true;\s*\n\s*break;/.test(poolCode) &&
    /waitForPriceBudget\(runDeadlineMs\)/.test(poolCode),
  "the bucket refills sixty seconds later and the run is still alive to use it"
);
check(
  "waiting is bounded by the run's own clock, not by the minute",
  /return "out-of-time"/.test(poolCode) && /Date\.now\(\) >= runDeadlineMs/.test(poolCode),
  "an unbounded wait would run past maxDuration and be killed mid-write, " +
    "discarding everything the run had already fetched"
);

const budgetMs = Number((poolCode.match(/PRICE_RUN_BUDGET_MS\s*=\s*([0-9_]+)/) ?? [])[1]?.replace(/_/g, ""));
const routeSrc = readCodeOnly("app/api/jobs/warm-price-pool/route.ts");
const maxDurationS = Number((routeSrc.match(/maxDuration\s*=\s*(\d+)/) ?? [])[1]);
check(
  "the working budget leaves room under maxDuration for the write tail",
  budgetMs > 0 && maxDurationS > 0 && budgetMs <= (maxDurationS - 30) * 1000,
  `${budgetMs / 1000}s budget against a ${maxDurationS}s maxDuration — a run that ` +
    `spends all of it has nothing left for the HSET, the staleness bookkeeping ` +
    `and the response, and would be killed mid-write`
);
check(
  "a refreshed row is stamped when the quote landed, not when the run started",
  /ts: quote \? quoteAt/.test(poolCode),
  "a run may now span four minutes; stamping the run start would make a symbol " +
    "look four minutes old the instant it was written and re-select it early"
);

// ── 7. The cap covers the FAST tier, not just the slow one ─────────────────
console.log("\n7. The per-run cap is derived from the real tier mix");

// Arithmetic over the real constants, not a grep for the formula. The old
// derivation was ceil(universe / runsPerTier2Window()) -- the whole universe
// priced as if it were all on the 30-minute policy -- which produced a cap of
// 127 against a fast tier needing 139.
const cronForCap = (readCodeOnly("lib/server/jobRuns.ts").match(
  /"warm-price-pool":[^}]*cron:\s*"([^"]+)"/
) ?? [])[1];
const everyMin = Number((String(cronForCap).match(/^\*\/(\d+)/) ?? [])[1]);
const runsT1 = Math.max(1, Math.floor(tiers.TIER1_TTL_MS / (everyMin * 60_000)));
const runsT2 = Math.max(1, Math.floor(tiers.TIER2_TTL_MS / (everyMin * 60_000)));

// The live split from the first tier-1 build: 415 of 759.
const LIVE_TIER1 = 415;
const LIVE_UNIVERSE = 759;
const capFor = (t1, total) =>
  Math.ceil(t1 / runsT1) + Math.ceil((total - t1) / runsT2);
const needed = capFor(LIVE_TIER1, LIVE_UNIVERSE);
const fastAlone = Math.ceil(LIVE_TIER1 / runsT1);

check(
  "the derived cap covers the fast tier's own requirement",
  needed >= fastAlone,
  `ceil(${LIVE_TIER1}/${runsT1}) + ceil(${LIVE_UNIVERSE - LIVE_TIER1}/${runsT2}) = ${needed}/run ` +
    `against ${fastAlone} the 15-minute tier needs alone — the old ` +
    `ceil(${LIVE_UNIVERSE}/${runsT2}) = ${Math.ceil(LIVE_UNIVERSE / runsT2)} was BELOW it`
);
check(
  "and still fits inside the per-run ceiling",
  needed <= capMax,
  `${needed} <= PRICE_MAX_PER_RUN ${capMax}`
);
check(
  "the per-run ceiling is derived from the run budget and the usable call rate",
  /USABLE_CALLS_PER_MINUTE \* \(PRICE_RUN_BUDGET_MS \/ 60_000\)/.test(poolCode) &&
    capMax === Math.floor((safePerMin - headroom) * (runBudgetMs / 60_000)),
  `(${safePerMin} - ${headroom}) x ${runBudgetMs / 60_000} min = ${capMax} — a typed ` +
    `number here goes stale the moment the run budget or the guard moves, which is ` +
    `exactly how 220 came to describe a one-minute run that no longer existed`
);
// Scoped to the capNeeded EXPRESSION. Grepping the whole file matched the
// exported runsPerTier1Window DEFINITION and passed even with the derivation
// reverted to the tier-2-only formula — a check that could not fail, which is
// the thing this file exists to avoid (claude/traps/a-regex-over-source-has-no-scope.md).
const capExpr = (poolCode.match(/const capNeeded =[\s\S]*?;/) ?? [])[0];
if (!capExpr) {
  console.error("FAIL: could not extract the capNeeded expression — measuring nothing.");
  process.exit(1);
}
check(
  "the cap expression sums both tiers rather than pricing everything as tier 2",
  /runsPerTier1Window\(\)/.test(capExpr) && /runsPerTier2Window\(\)/.test(capExpr),
  "one tier's cadence cannot stand in for a mixed population"
);

// ── 8. The picker signal is what rendered ──────────────────────────────────
console.log("\n8. Tier 1's picker signal is bounded by what renders");

const tiersCode = readCodeOnly("lib/server/priceTiers.ts");
const pagePickerSrc = readCodeOnly("app/components/PickerResultPage.tsx");
const targetsCode = readCodeOnly("lib/server/warmTargets.ts");

// Scoped to deriveTier1's own body, NOT to the whole file. warmTargets still
// reads signalRecords legitimately — it is the right source for "which symbols
// do the warm jobs maintain data for", which is a different question from
// "which are worth a 15-minute price". Asserting over the file would forbid the
// correct use along with the wrong one.
const deriveBody = (targetsCode.match(
  /async function deriveTier1\([\s\S]*?\n\}/
) ?? [])[0];
if (!deriveBody) {
  console.error("FAIL: could not extract deriveTier1 from warmTargets.ts — measuring nothing.");
  process.exit(1);
}
check(
  "the flat payload slice is gone from the tier derivation",
  !/TIER1_PICKER_CAP/.test(tiersCode) && !/signalRecords/.test(deriveBody),
  "signalRecords is pushed in universe-iteration order and never sorted " +
    "(pickersBuilder.ts:3567), so slicing it ranked symbols by position in an " +
    "analysis loop — a stable ordering dressed as a signal, the same thing " +
    "this file refuses market cap for"
);
check(
  "the page records exactly its own above-the-fold slice",
  /recordAboveFold\(\s*config\.href,\s*seoEntries\.slice\(0, initialVisibleCount\)/.test(
    pagePickerSrc
  ),
  "everything past initialVisibleCount is behind Show more, so it was never " +
    "rendered to anyone"
);
check(
  "and the union is read back by the checked route registry",
  /readAboveFold\(PICKER_ROUTES\)/.test(targetsCode),
  "PICKER_ROUTES is asserted against the pages that actually exist " +
    "(scripts/check-picker-routes.mjs), so the read cannot silently miss one"
);

// The recorder's own slice cap must not be the thing that truncates a page.
const declaredMaxItems = [
  ...fs
    .readdirSync(path.join(ROOT, "app"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      const file = path.join(ROOT, "app", d.name, "page.tsx");
      if (!fs.existsSync(file)) return [];
      const m = fs.readFileSync(file, "utf8").match(/maxItems:\s*(\d+)/);
      return m ? [Number(m[1])] : [];
    }),
];
const foldCap = Number((tiersCode.match(/FOLD_MAX_ROWS_PER_ROUTE = (\d+)/) ?? [])[1]);
check(
  "the recorder's row cap is at least the largest maxItems any page declares",
  declaredMaxItems.length > 0 && foldCap >= Math.max(...declaredMaxItems),
  `cap ${foldCap} against a largest declared maxItems of ${Math.max(...declaredMaxItems)} ` +
    `across ${declaredMaxItems.length} picker pages — a lower cap would silently ` +
    `under-record the pages that show most`
);

const footerSrc = readCodeOnly("app/components/ScanFooter.tsx");
const pageSrc = readCodeOnly("app/components/PickerResultPage.tsx");
check(
  "the footer prints a price window, not just the build time",
  /priceLabel/.test(footerSrc) && /formatPriceWindow/.test(pageSrc),
  "one timestamp implied every row shared an age; with a 15/30 split rows in " +
    "one table are up to twice apart"
);
check(
  "and says so when the market is shut",
  /market closed/.test(pageSrc) && /isRegularSessionOpen/.test(pageSrc),
  "at 22:00 a bare timestamp cannot be told from a live quote; on Sunday the " +
    "price is 60 hours old and still correct — the label is what makes it honest"
);

console.log(
  failures === 0
    ? "\nAll price-tier and market-hours assertions hold.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
