// BETA, COMPUTED FROM BARS ALREADY IN REDIS — the worked example.
//
// ── WHAT THIS ANSWERS ────────────────────────────────────────────────────
// The read-only probe (2026-09-21) established that computing beta in-house is
// near-free: `^GSPC` daily bars are already cached by /markets/spx, the stock's
// own bars are already cached by /stock/[symbol], and beta is a covariance over
// two series the site already holds. What it could NOT do is produce a number:
// the agent sandbox has no Upstash credentials and every bars provider is
// refused at the gateway.
//
// So this runs on the relay, where the credentials are, and prints the number.
//
// ── THE DECISION IT FEEDS ────────────────────────────────────────────────
// Beta is currently HIDDEN on CompanyProfile.tsx (HIDDEN_PROFILE_ROWS,
// 2026-09-21) on the grounds that it is a vendor-computed statistic over a
// window the vendor chooses, not a filed figure. Un-hiding it means presenting
// OUR beta where FMP's used to be, and that is only honest if the two are
// close enough to be the same claim.
//
// THE CONVENTION GAP IS THE POINT, NOT A CAVEAT. MAX_CACHED_HISTORY_DAYS caps
// the cache at 1,400 CALENDAR days (~3.8 years), so a 5-year weekly beta --
// the common vendor convention, and most likely FMP's -- CANNOT be computed
// from this cache at all. What can is a ~2-year daily beta. Those are different
// statistics, not two estimates of one statistic, and a daily beta is typically
// the noisier and often the higher of the two. This prints several windows so
// the spread is visible rather than asserted.
//
// ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────
// It does not fetch FMP's beta for comparison. The relay carries Upstash
// secrets only -- see the `_comment` in data/static-profile.json, which records
// that adding FMP_API_KEY to Actions secrets is the one step that would unblock
// it. The comparison value has to come from the owner or from a key-bearing
// environment. Printing a made-up one would defeat the entire purpose of the run.
//
// READ-ONLY. It issues GETs and nothing else. The `write-` prefix on its task
// name is about credential ACCESS, not about writing: see the routing docblock
// at the top of scripts/relay-run.mjs.
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";

const redis = Redis.fromEnv();

// ── CONSTANTS LIFTED FROM THE SHIPPED SOURCE, NOT TRANSCRIBED ────────────
// A probe carrying its own copy of the key prefix measures the probe. If the
// prefix moves (it is on v7 already), this must fail loudly rather than read a
// key that no longer exists and report "no cached bars".
const constant = (src, n) => (readCodeOnly(src).match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const HISTORY_PREFIX = constant("lib/server/historyCache.ts", "REDIS_HISTORY_PREFIX");
const MAX_DAYS = Number(
  (readCodeOnly("lib/server/historyCache.ts").match(/MAX_CACHED_HISTORY_DAYS = (\d+)/) ?? [])[1]
);
if (!HISTORY_PREFIX) { console.error("FATAL: could not read REDIS_HISTORY_PREFIX from source"); process.exit(2); }
if (!MAX_DAYS) { console.error("FATAL: could not read MAX_CACHED_HISTORY_DAYS from source"); process.exit(2); }

const SYMBOL = (process.env.BETA_SYMBOL || "MU").trim().toUpperCase();
// THE BENCHMARK THE SITE ALREADY CACHES. /markets/spx calls
// getDailyHistory("^GSPC"), and stalenessQueue.ts names it explicitly as a
// member of the daily-history denominator. Not a new fetch.
const BENCH = (process.env.BETA_BENCH || "^GSPC").trim().toUpperCase();

const key = (s) => `${HISTORY_PREFIX}:${s}`;

const [stockEntry, benchEntry] = await Promise.all([
  redis.get(key(SYMBOL)),
  redis.get(key(BENCH)),
]);

const barsOf = (e) => (Array.isArray(e?.daily) ? e.daily : []);
const stockBars = barsOf(stockEntry);
const benchBars = barsOf(benchEntry);

console.log("=".repeat(92));
console.log(`BETA WORKED EXAMPLE — ${SYMBOL} against ${BENCH}`);
console.log(`cache ceiling MAX_CACHED_HISTORY_DAYS=${MAX_DAYS} calendar days (~${(MAX_DAYS / 365).toFixed(1)}y)`);
console.log("=".repeat(92));
console.log(`${SYMBOL}: ${stockBars.length} cached bars${stockBars.length ? ` (${stockBars[0].date} .. ${stockBars[stockBars.length - 1].date})` : ""}`);
console.log(`${BENCH}: ${benchBars.length} cached bars${benchBars.length ? ` (${benchBars[0].date} .. ${benchBars[benchBars.length - 1].date})` : ""}`);

// AN ABSENT BENCHMARK IS A RESULT, NOT A CRASH. The whole cost argument rests
// on ^GSPC already being cached; if it is not, that is the finding.
if (!stockBars.length || !benchBars.length) {
  console.log("");
  console.log("REFUSED: one or both series is not in the cache. No beta computed.");
  console.log(!benchBars.length
    ? `  ${BENCH} absent means the "no new fetch" premise does not hold as stated — it holds only while /markets/spx has been rendered recently enough to keep the entry inside its 50h TTL.`
    : `  ${SYMBOL} absent means nothing has rendered /stock/${SYMBOL} inside the TTL.`);
  process.exit(0);
}

// ── ALIGNMENT IS THE STEP THAT GOES WRONG SILENTLY ───────────────────────
// Two series indexed by position rather than by DATE will regress Tuesday's
// stock return against Wednesday's index return the moment one series has a
// bar the other lacks — a half-day shift that produces a plausible beta and no
// error. A holiday either venue observes alone is enough. So the join is on
// the date string, and the count that survives it is reported.
const closeByDate = (bars) => {
  const m = new Map();
  for (const b of bars) {
    if (!b || typeof b.date !== "string") continue;
    const c = Number(b.close);
    // A ZERO CLOSE IS NOT A PRICE. historyCache's own comment records zero
    // closes written before its typeof allowlist landed; one of them makes the
    // adjacent return -100% and then +infinity.
    if (!Number.isFinite(c) || c <= 0) continue;
    m.set(b.date, c);
  }
  return m;
};

const sMap = closeByDate(stockBars);
const bMap = closeByDate(benchBars);
const common = [...sMap.keys()].filter((d) => bMap.has(d)).sort();

console.log(`common trading dates with a usable close on both: ${common.length}`);
if (common.length < 40) {
  console.log("REFUSED: too few overlapping dates to regress.");
  process.exit(0);
}

/** Simple returns over consecutive COMMON dates. */
function returns(dates, map) {
  const out = [];
  for (let i = 1; i < dates.length; i++) {
    const prev = map.get(dates[i - 1]);
    const cur = map.get(dates[i]);
    out.push(cur / prev - 1);
  }
  return out;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/**
 * Beta, and the numbers needed to judge it.
 *
 * SAMPLE (n-1) FOR BOTH covariance and variance. The choice cancels in the
 * ratio — (n-1) over (n-1) is the same beta as n over n — so it is stated for
 * the reader's benefit rather than because it moves the answer. It DOES move
 * the reported volatilities and R-squared, which is why it is named.
 */
function regress(rs, rb) {
  const n = rs.length;
  const ms = mean(rs);
  const mb = mean(rb);
  let cov = 0, varB = 0, varS = 0;
  for (let i = 0; i < n; i++) {
    const ds = rs[i] - ms;
    const db = rb[i] - mb;
    cov += ds * db;
    varB += db * db;
    varS += ds * ds;
  }
  cov /= (n - 1); varB /= (n - 1); varS /= (n - 1);
  const beta = cov / varB;
  const corr = cov / Math.sqrt(varS * varB);
  return {
    n, beta, corr, r2: corr * corr,
    // Annualised, 252 trading days. A beta with no idea of the underlying
    // volatilities is hard to sanity-check.
    volStock: Math.sqrt(varS * 252), volBench: Math.sqrt(varB * 252),
    alphaDaily: ms - beta * mb,
  };
}

/** The last `days` calendar days of the common series. */
const windowFrom = (dates, days) => {
  const last = dates[dates.length - 1];
  const cut = new Date(Date.parse(last) - days * 86400000).toISOString().slice(0, 10);
  return dates.filter((d) => d >= cut);
};

const WINDOWS = [
  { label: "full cached window", days: MAX_DAYS },
  { label: "2 years (daily)", days: 730 },
  { label: "1 year (daily)", days: 365 },
];

console.log("");
console.log("── DAILY-RETURN BETA, BY WINDOW ──────────────────────────────────────────");
console.log("window                 from        to          n     beta    corr    R^2    volS   volB");
const results = [];
for (const w of WINDOWS) {
  const dates = windowFrom(common, w.days);
  if (dates.length < 40) { console.log(`${w.label.padEnd(22)} too few dates (${dates.length})`); continue; }
  const r = regress(returns(dates, sMap), returns(dates, bMap));
  results.push({ ...w, ...r, from: dates[0], to: dates[dates.length - 1] });
  console.log(
    `${w.label.padEnd(22)} ${dates[0]}  ${dates[dates.length - 1]}  ${String(r.n).padStart(4)}  ` +
    `${r.beta.toFixed(3).padStart(6)}  ${r.corr.toFixed(3).padStart(5)}  ${r.r2.toFixed(3).padStart(5)}  ` +
    `${(r.volStock * 100).toFixed(1).padStart(5)}% ${(r.volBench * 100).toFixed(1).padStart(5)}%`
  );
}

// ── THE WEEKLY LEG, AND WHY IT CANNOT BE THE FIVE-YEAR ONE ───────────────
// Sampled every 5th common trading date (a ~weekly series) over the whole
// cache. It is here to show how far the number moves with the SAMPLING
// FREQUENCY alone, holding the span fixed -- which is half of the gap between
// ours and a vendor's. The other half is the span, and that half cannot be
// closed from this cache at any frequency.
console.log("");
console.log("── WEEKLY-SAMPLED BETA over the same cached span ─────────────────────────");
{
  const weekly = common.filter((_, i) => i % 5 === 0);
  if (weekly.length >= 40) {
    const r = regress(returns(weekly, sMap), returns(weekly, bMap));
    console.log(
      `every 5th trading day  ${weekly[0]}  ${weekly[weekly.length - 1]}  ${String(r.n).padStart(4)}  ` +
      `${r.beta.toFixed(3).padStart(6)}  ${r.corr.toFixed(3).padStart(5)}  ${r.r2.toFixed(3).padStart(5)}`
    );
    const daily = results.find((x) => x.label === "full cached window");
    if (daily) {
      console.log(`  same span, daily vs weekly: ${daily.beta.toFixed(3)} vs ${r.beta.toFixed(3)} ` +
        `(${(Math.abs(r.beta - daily.beta) / daily.beta * 100).toFixed(1)}% apart on sampling frequency alone)`);
    }
  } else {
    console.log(`too few weekly points (${weekly.length})`);
  }
}

const spanYears = (Date.parse(common[common.length - 1]) - Date.parse(common[0])) / (365.25 * 86400000);
console.log("");
console.log("── WHAT THIS IS, AND IS NOT ──────────────────────────────────────────────");
console.log(`This is a DAILY-return beta over ${spanYears.toFixed(2)} years of cached bars.`);
console.log(`It is NOT a 5-year weekly beta and cannot be made into one from this cache:`);
console.log(`  5 years needs 1,826 calendar days; MAX_CACHED_HISTORY_DAYS is ${MAX_DAYS}.`);
console.log(`FMP's published MU beta is NOT fetched here — the relay holds Upstash secrets only.`);
console.log(`Compare by hand before deciding whether Beta is un-hidden on CompanyProfile.`);
console.log("");
console.log("JSON " + JSON.stringify({
  symbol: SYMBOL, bench: BENCH,
  maxCachedHistoryDays: MAX_DAYS,
  commonDates: common.length,
  spanYears: Number(spanYears.toFixed(2)),
  windows: results.map((r) => ({
    label: r.label, from: r.from, to: r.to, n: r.n,
    beta: Number(r.beta.toFixed(4)), corr: Number(r.corr.toFixed(4)), r2: Number(r.r2.toFixed(4)),
  })),
}));
