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
const SIGNAL_KEYS = ["pickerSymbols", "searchedSymbols", "moverSymbols", "universe"];
const universe = Array.from({ length: 500 }, (_, i) => `SYM${i}`);
const selected = tiers.selectTier1({
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
  pickerSymbols: [],
  searchedSymbols: universe,
  moverSymbols: [],
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
    pickerSymbols: ["NOTOURS"],
    searchedSymbols: ["NOTOURS"],
    moverSymbols: ["NOTOURS"],
    universe,
  }).length === 0,
  "otherwise a search box hands a stranger the power to add a symbol the site " +
    "does not display to every run"
);

// ── 3. The TTLs mean what the page says they mean ───────────────────────────
console.log("\n3. The two policies, and what happens when the tier is unknown");

const tier1 = new Set(["FAST"]);
const now = 1_000_000_000;
check(
  "tier 1 is 15 minutes and tier 2 is 30",
  tiers.TIER1_TTL_MS === 15 * 60_000 && tiers.TIER2_TTL_MS === 30 * 60_000,
  `${tiers.TIER1_TTL_MS / 60_000} / ${tiers.TIER2_TTL_MS / 60_000} minutes — 30 rather ` +
    `than 60 because an hour-old change is visibly wrong beside any other source`
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
check(
  "31 minutes is due for both",
  tiers.isPriceDue(now - 31 * 60_000, "FAST", tier1, now) &&
    tiers.isPriceDue(now - 31 * 60_000, "SLOW", tier1, now),
  ""
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
const capMax = Number((poolCode.match(/PRICE_MAX_PER_RUN\s*=\s*(\d+)/) ?? [])[1]);
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
const TARGET_UNIVERSE = 3000; // the size this design was costed at
check(
  "the pre-open buffer can re-price the whole costed universe before the open",
  repriceable >= TARGET_UNIVERSE,
  `${preOpenRuns} runs x ${capMax}/run = ${repriceable} symbols in the ` +
    `${hours.PRE_OPEN_BUFFER_MINUTES}-minute buffer, against a ${TARGET_UNIVERSE}-symbol ` +
    `target — anything left over opens the session showing yesterday's % change`
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
  /deferredByCap/.test(poolCode) && /quoteFailures/.test(poolCode) && /capacityStopped/.test(poolCode),
  "due <= priceCap with deferredByCap 0 means the TTLs are the real policy; a " +
    "persistent deferral means the cap is, and the TTLs are aspirational"
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
