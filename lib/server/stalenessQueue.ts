// One Redis sorted set per dataset, scored by last-refresh timestamp.
//
// Three consumers, one piece of bookkeeping (claude/cache-health-page-spec-2026-08-22.md):
//   * warm jobs claim the STALEST N instead of rotating blindly, so every FMP
//     call is spent on something that actually needed refreshing
//   * the cache health page reads coverage and staleness off the same sets with
//     O(1) aggregate commands, never a scan
//   * the byte meter (lib/server/fmpUsage.ts) sits beside it, bucketing spend
//
// A NOTE ON THE SPEC'S CITATION, because it matters for what this file is.
// The spec says "pricePool.ts already does exactly this". pricePool does the
// stalest-first BEHAVIOUR, but by `hmget`-ing every row of the universe and
// sorting in memory -- not from a sorted set. That is fine for a warm job that
// wants the rows anyway; it is exactly the scan the health page must not do.
// So this is new plumbing rather than a copy of pricePool's, and pricePool is a
// candidate to migrate onto it later rather than a template.
//
// WHY DEFERRALS GET THEIR OWN SET, which is the subtle part. The obvious way to
// defer a failing symbol is to push its score forward so it sorts to the back.
// That works for the queue and quietly corrupts the health page: the score IS
// the "last refreshed" reading, so a deferred symbol would report as freshly
// refreshed when nothing refreshed it. A delisted ticker would show green.
//
// So `score` only ever means "when this was last successfully refreshed", and
// deferral lives in a second, small sorted set scored by when the deferral
// expires. One extra Redis read per claim, and the health page keeps telling
// the truth -- including a deferred COUNT, which is itself the signal that a
// dataset has symbols nothing can refresh.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { JOBS, describeCron, type JobKey } from "./jobRuns";
import { EARNINGS_STALE_AFTER_SECONDS } from "./earningsFreshness";
import { TIER1_TTL_MS, TIER2_TTL_MS, readTier1 } from "./priceTiers";
import { ANALYSIS_UNIVERSE_CAP } from "./dynamicUniverseCache";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const QUEUE_PREFIX = "msh:staleness:v1";
const DEFER_PREFIX = "msh:staleness-defer:v1";
// When this dataset's queue was FIRST seeded.
//
// WHY A THIRD KEY. registerSymbols scores everything 0, so the instant a
// dataset is instrumented, every symbol in it reads "never refreshed". Rendering
// that as a fault is wrong -- nothing has had a chance to run yet -- but
// rendering it as permanently neutral is worse, because a dataset whose warm job
// is dead looks exactly the same and would stay neutral forever. That is the
// uninstrumented-job-reads-as-dead failure inverted, and this page exists to end
// it (claude/traps/absence-needs-the-producer-to-have-run.md).
//
// The score field cannot answer it: an all-zero set has no timestamp to age
// against. So the seed moment is recorded once, and the health page can say
// "seeded 4 minutes ago" (neutral) or "seeded 9 days ago and still nothing has
// refreshed" (fault) instead of guessing.
const SEEDED_PREFIX = "msh:staleness-seeded:v1";

/**
 * The datasets with real bookkeeping, and the TTL each is SUPPOSED to hold to.
 *
 * `ttlSeconds` is the policy the health page judges a row against, and it is
 * per dataset on purpose: a 30-day-old profile is healthy, a 30-day-old price
 * is a fault. A single global "stale = 24h" rule would report most of this page
 * wrong (spec, "What it shows").
 *
 * This registry is the ONLY place a dataset is declared. A dataset absent from
 * here is absent from the page -- which is why the page renders a registry
 * entry with no queue as "not instrumented" rather than skipping it. An
 * uninstrumented dataset that simply does not appear is indistinguishable from
 * a healthy one, and that is the exact failure this whole page exists to end
 * (claude/traps/absence-needs-the-producer-to-have-run.md).
 *
 * `coverage` IS THE SECOND HALF OF THAT SAME PROBLEM, and it cost us a green
 * panel that meant nothing. A dataset needs TWO different writers to report a
 * meaningful ratio:
 *
 *   registerSymbols(...)  declares the DENOMINATOR -- every symbol that ought
 *                         to be fresh, whether or not anything has refreshed it
 *   markRefreshed(...)    supplies the NUMERATOR
 *
 * `dailyHistory` had only the second. Its queue therefore contained exactly the
 * symbols something had recently written, so "24 / 24, within policy" meant "of
 * the 24 we happened to observe, all 24 are fresh" -- a ratio that cannot be
 * anything but green no matter how broken the dataset is, because every symbol
 * that failed is simply absent from the denominator.
 *
 * So the registry declares which kind each dataset is, the page renders
 * "observed-only" ones distinctly instead of showing an unearned ratio, and
 * scripts/check-cache-health-page.mjs asserts the declaration matches the tree
 * (a dataset marked "registered" must actually have a registerSymbols call). The
 * point is not to fix dailyHistory once -- that is done below -- but to make the
 * NEXT dataset added without a denominator impossible to mistake for healthy.
 */
export const DATASETS = {
  fundamentals: {
    label: "Fundamentals (market cap, P/E)",
    ttlSeconds: 60 * 60 * 26,
    job: "warm-fundamentals",
    coverage: "registered",
  },
  profile: {
    label: "Profile (industry, sector)",
    ttlSeconds: 60 * 60 * 24 * 30,
    job: "warm-fundamentals",
    qualifier: "effectively static, 30d is healthy",
    coverage: "registered",
  },
  screenerFundamentals: {
    label: "Screener fundamentals",
    ttlSeconds: 60 * 60 * 30,
    job: "warm-screener-fundamentals",
    // OBSERVED-ONLY: markRefreshed with no registerSymbols caller. Its ratio is
    // a self-selecting denominator and the page must not render it as coverage.
    coverage: "observed-only",
  },
  stockData: {
    label: "Stock data (valuation, dividends, analysts)",
    // Matches TTL_SECONDS in stockDataCache. The job refreshes
    // REFRESH_SLICE_SIZE symbols per run, so its lap is the longest in the
    // system -- ~5h at today's universe and ~20h at 3,000 -- which is exactly
    // why it needed a per-symbol denominator: a lap that quietly stops
    // completing looks identical to one that is merely slow.
    ttlSeconds: 60 * 60 * 26,
    job: "warm-stock-data",
    coverage: "registered",
  },
  pricePool: {
    label: "Price pool",
    // THE SLOW TIER'S POLICY, and it was a typed `60 * 15` -- the FAST tier's.
    //
    // #420 split this dataset in two: ~200 tier-1 symbols refresh every 15
    // minutes and the remaining ~560 every 60 (priceTtlMsFor). This registry
    // kept the single 15-minute number, so the page judged every tier-2 symbol
    // against a policy four times tighter than the one its own warm job holds
    // it to -- which makes a healthy tier-2 symbol read as past TTL for 45
    // minutes in every hour.
    //
    // Observed 2026-09-11 15:38 UTC, WITH THE MARKET OPEN, so the
    // refreshWindow branch below does not explain it: `342 / 884`, `542 past
    // TTL`, "61% of observed symbols past their own TTL". 542 against a tier-2
    // population of roughly that size is the whole reading.
    //
    // This is the #417 defect reacquired through a different door -- a healthy
    // dataset reading as broken every day -- and the door was a policy column
    // that did not move when the policy did.
    //
    // TIER 2 IS THE HEADLINE because tier 2 is the DEFAULT: priceTtlMsFor
    // returns TIER2_TTL_MS for any symbol not in the tier-1 set, including
    // when the tier list is unreadable. The page shows the split beside it;
    // the status logic reads this field and now judges each symbol against its
    // own tier, so a tier-1 symbol that goes 20 minutes without a refresh is
    // still a fault.
    ttlSeconds: TIER2_TTL_MS / 1000,
    fastTierTtlSeconds: TIER1_TTL_MS / 1000,
    tieredPolicy: "price-tier-1",
    job: "warm-price-pool",
    coverage: "registered",
    // THE ONLY DATASET WHOSE REFRESHES ARE GATED ON THE MARKET BEING OPEN, and
    // saying so here is what stops the health page calling it broken for
    // fifteen hours a day.
    //
    // warmPricePool returns early with { skipped: true, reason: "market-closed" }
    // outside the buffered window, so from 21:01 UTC until 12:00 the next
    // morning -- and all weekend -- nothing refreshes, and a 15-minute policy
    // means 100% of the universe is past its TTL within the first quarter hour.
    // Observed 2026-09-04 07:26 UTC: `0 / 886`, `886 past its TTL`, red, "100%
    // of observed symbols past their own TTL". Every word of that is correct
    // and the colour is wrong.
    //
    // This is the same defect as `quarterlyRefreshes: 0` before #416 in a
    // different place: a page that cannot tell IDLE-BECAUSE-CORRECT from BROKEN
    // reports the more alarming of the two, every night, until the alarm is
    // ignored -- and then the one night it means something, it is ignored too.
    //
    // DECLARED IN THE REGISTRY rather than as `if (d.dataset === "pricePool")`
    // in the page, for the reason `coverage` is: the next gated dataset should
    // get this by declaring it, not by somebody remembering to edit a condition
    // in a JSX file.
    refreshWindow: "market-hours",
  },
  dailyHistory: {
    label: "Daily history",
    // 26h, NOT the 50h Redis TTL. These are two different questions: the Redis
    // TTL is how long a bar stays usable, this is how long before its age is a
    // FAULT. 26h means one missed morning warm shows amber the next day, while
    // the data itself is still there -- which is the point of the 50h TTL. Set
    // to the cache TTL, a failure would only become visible once the data had
    // already gone.
    ttlSeconds: 60 * 60 * 26,
    job: "warm-picker-universe",
    qualifier: "forced refetch",
    coverage: "registered",
  },
  earnings: {
    label: "Earnings",
    // DERIVED, and it was a typed `60 * 60 * 24 * 7`.
    //
    // 7 days was the only number in this table with no argument behind it, and
    // it was wrong against the dataset's own cache rule by a factor of
    // thirteen. computeEarningsTtlSeconds holds a symbol's rows for up to 95
    // days between reports, markRefreshed only fires when the job refetches,
    // and the job only refetches once the key has expired -- so a correctly
    // cached symbol at rest was reported as past its TTL for 94 days in every
    // 95. Observed 2026-09-11: `12 / 349`, `337 past their TTL`, "96% of
    // observed symbols past their own TTL". Every word of that was correct and
    // none of it was a fault.
    //
    // This is the pricePool disease in a second dataset -- a page that cannot
    // tell IDLE-BECAUSE-CORRECT from BROKEN, reporting the more alarming of the
    // two every single day. See lib/server/earningsFreshness.ts for the full
    // trace, the three terms this number is made of, and what moved to the
    // job's run record to keep a same-day signal.
    ttlSeconds: EARNINGS_STALE_AFTER_SECONDS,
    job: "warm-earnings",
    qualifier: "refetched on key expiry, not on a clock",
    coverage: "registered",
  },
  news: {
    label: "Stock news",
    // 24h, against a 1h refresh interval. A symbol nobody views does not
    // refresh and is SUPPOSED to go stale, so this is not "a warm was missed" --
    // it is "nothing has looked at this in a day", which is the honest reading
    // for a view-driven dataset.
    ttlSeconds: 60 * 60 * 24,
    population: "on-demand",
    qualifier: "first view populates, later views read Redis",
    // OBSERVED-ONLY, and for a stronger reason than screenerFundamentals: there
    // is no registerSymbols caller because there is no universe to register.
    // The denominator is "symbols someone has viewed", which is self-selecting
    // by construction, so a ratio over it must not be rendered as coverage.
    coverage: "observed-only",
  },
  sectorNews: {
    label: "Sector news",
    ttlSeconds: 60 * 60 * 24,
    population: "on-demand",
    qualifier: "first view populates, no earnings pin",
    coverage: "observed-only",
  },
} as const satisfies Record<
  string,
  {
    label: string;
    ttlSeconds: number;
    /** Anything true of this dataset that the schedule does not say. */
    qualifier?: string;
    coverage: "registered" | "observed-only";
    /**
     * Set when this dataset's warm job refuses to run outside the buffered US
     * trading window. Absent means "refreshes whenever its cron fires", which
     * is every other dataset here.
     *
     * The page reads it to decide whether being past TTL is a FAULT or the
     * expected state. It is deliberately not a boolean: "market-hours" names
     * the gate (isActiveMarketWindow) so a second kind of window later has
     * somewhere to go that is not a second boolean.
     */
    refreshWindow?: "market-hours";
    /**
     * Set when this dataset's symbols are judged against TWO policies rather
     * than one, naming the fast-tier membership list.
     *
     * DECLARED IN THE REGISTRY for the same reason refreshWindow is: the next
     * split policy should arrive by declaring it, not by somebody remembering
     * to edit a condition. Named rather than boolean so a second tiering later
     * has somewhere to go.
     *
     * `ttlSeconds` is then the SLOW tier (the default, per priceTtlMsFor) and
     * `fastTierTtlSeconds` the fast one. Both are required together; a dataset
     * with one and not the other will not type-check.
     */
    tieredPolicy?: "price-tier-1";
    fastTierTtlSeconds?: number;
  } & (
    | { tieredPolicy: "price-tier-1"; fastTierTtlSeconds: number }
    | { tieredPolicy?: never; fastTierTtlSeconds?: never }
  ) & (
    | {
        /** The warm job that maintains this dataset. Its cadence is READ FROM
         * THE REGISTRY, never retyped here -- see describeCron in jobRuns.ts for
         * what happened the last time this table carried its own copy. */
        job: JobKey;
        population?: never;
      }
    | {
        /** NO JOB, AND NOT AN OMISSION. A lazily populated dataset has no cron
         * by design -- warming 755 symbols of news hourly would dwarf every
         * other consumer on the FMP account. Spelled as its own variant rather
         * than an optional `job`, so the page cannot print a blank cadence and
         * nobody is tempted to invent a job name that does not exist to satisfy
         * the type. */
        population: "on-demand";
        job?: never;
      }
  )
>;

/**
 * "warm-price-pool, every 5 min" -- composed, never stored.
 *
 * A dataset with no job says so plainly. The alternative -- printing an empty
 * cadence, or naming a cron that does not exist -- would make a lazily
 * populated dataset look like a broken scheduled one on the health page, which
 * is the same class of mistake as the stale prose this function replaced.
 */
export function datasetNote(def: {
  job?: JobKey;
  population?: "on-demand";
  qualifier?: string;
}): string {
  const base = def.job
    ? `${def.job}, ${describeCron(JOBS[def.job].cron)}`
    : "no cron — populated on first view";
  return def.qualifier ? `${base} — ${def.qualifier}` : base;
}

export type DatasetKey = keyof typeof DATASETS;

const queueKey = (dataset: DatasetKey) => `${QUEUE_PREFIX}:${dataset}`;
const deferKey = (dataset: DatasetKey) => `${DEFER_PREFIX}:${dataset}`;
const seededKey = (dataset: DatasetKey) => `${SEEDED_PREFIX}:${dataset}`;

/**
 * Record that these symbols were just successfully refreshed.
 *
 * Also clears any deferral: a symbol that just worked is not failing any more.
 * Fails open and silent -- this is bookkeeping beside the real work, and a warm
 * job must never fail because its progress note did.
 */
export async function markRefreshed(
  dataset: DatasetKey,
  symbols: string[],
  atMs = Date.now()
): Promise<void> {
  if (!redis || !symbols.length) return;
  try {
    const members = symbols.map((s) => ({ score: atMs, member: s }));
    const p = redis.pipeline();
    // ───────────────────────────────────────────────────────────────────────
    // `xx` ON A REGISTERED DATASET: UPDATE THE SCORE, NEVER ADD THE MEMBER.
    //
    // THE CONTRACT THIS FILE ALREADY DOCUMENTS, forty lines above, in the
    // comment on DATASETS:
    //
    //     registerSymbols(...)  declares the DENOMINATOR
    //     markRefreshed(...)    supplies the NUMERATOR
    //
    // A bare zadd adds absent members, so markRefreshed was writing the
    // denominator too -- and for `dailyHistory` that is not theoretical. Its
    // only markRefreshed caller is writeHistoryEntry, reached from
    // getDailyHistory, which is called by /stock/[symbol], its /earnings and
    // /news sub-pages, /api/history, the dashboard, the insight snapshots and
    // /markets/spx. So EVERY SYMBOL ANYONE OR ANY CRAWLER EVER LOOKED AT joined
    // the daily-history denominator permanently, `^GSPC` included.
    //
    // THE EVIDENCE THAT THIS IS THE DOMINANT CAUSE, from the page's own
    // numbers on 2026-09-11 rather than from reasoning about it:
    //
    //     dailyHistory   763 / 2892     registered from the universe + renders
    //     fundamentals   759 /  884     registered from the universe
    //     pricePool      342 /  884     registered from the universe
    //
    // All three are registered `nx` from the same rotating universe and none of
    // them removes a symbol that leaves it, so universe churn inflates all
    // three at the SAME rate. Two sit at 884 against an observed universe of
    // ~762 -- about 122 of churn residue, ~16%. The third is at 2,892. Churn
    // therefore accounts for roughly 122 of dailyHistory's 2,130 excess and the
    // second writer accounts for the rest: about 94% of it. The growth rate
    // agrees -- 842 in six days is ~140 new distinct symbols a day, which is
    // crawler-shaped traffic across /stock/* and is not a 20%-per-day turnover
    // of a 700-symbol universe that somehow left the other two datasets alone.
    //
    // WHY NOT APPLIED TO EVERY DATASET. screenerFundamentals, news and
    // sectorNews are declared `coverage: "observed-only"` precisely because
    // they have no registerSymbols caller -- markRefreshed adding members IS
    // their denominator, and `xx` would empty them. So the behaviour is driven
    // off the declaration that already means exactly this, and
    // check-cache-health-page.mjs already asserts that declaration matches the
    // tree.
    const addsMembers = DATASETS[dataset].coverage === "observed-only";
    // Upstash's zadd takes (key, ...members); chunked so one enormous warm run
    // cannot build a single oversized command.
    for (let i = 0; i < members.length; i += 500) {
      const slice = members.slice(i, i + 500);
      if (addsMembers) p.zadd(queueKey(dataset), slice[0], ...slice.slice(1));
      else p.zadd(queueKey(dataset), { xx: true }, slice[0], ...slice.slice(1));
    }
    p.zrem(deferKey(dataset), ...symbols);
    await p.exec();
  } catch {
    // bookkeeping -- never throws into the caller
  }
}

/**
 * Register symbols that belong to this dataset but have never been refreshed.
 *
 * Scored 0 so they sort to the very front of the queue and count as stale
 * everywhere. `nx` so this can be called with the whole universe on every run
 * without ever overwriting a real refresh time with 0.
 *
 * This is what makes COVERAGE meaningful: without it the set only ever contains
 * symbols that already succeeded, so a dataset missing half the universe would
 * report 100% fresh on the half it has.
 */
export async function registerSymbols(
  dataset: DatasetKey,
  symbols: string[],
  options: { authoritative?: boolean } = {}
): Promise<void> {
  if (!redis || !symbols.length) return;
  try {
    if (options.authoritative) await reconcileToList(dataset, symbols);
    const p = redis.pipeline();
    for (let i = 0; i < symbols.length; i += 500) {
      const slice = symbols.slice(i, i + 500).map((s) => ({ score: 0, member: s }));
      p.zadd(queueKey(dataset), { nx: true }, slice[0], ...slice.slice(1));
    }
    // `nx` so this records the FIRST seed and never moves. A timestamp that
    // refreshed on every run would reset the clock the health page ages
    // against, and a permanently-young seed is a permanently-neutral status --
    // exactly the reading this key exists to prevent.
    p.set(seededKey(dataset), Date.now(), { nx: true });
    await p.exec();
  } catch {
    // bookkeeping -- never throws into the caller
  }
}

/**
 * The smallest list this file will accept as a whole universe.
 *
 * DERIVED, NOT TYPED. The reconcile below deletes every tracked symbol absent
 * from its argument, so a caller that hands it a truncated list would silently
 * shrink a denominator -- and a shrinking denominator makes every ratio on
 * /cache-health look BETTER, which is the direction nobody investigates. Half
 * the analysis cap is a floor no real universe has ever been near and every
 * partial one would be well under.
 *
 * Same shape as writeTier1's "NEVER WRITE AN EMPTY LIST": the guard is against
 * the caller's own bad day, not against a bug in this function.
 */
const AUTHORITATIVE_FLOOR = Math.floor(ANALYSIS_UNIVERSE_CAP / 2);

/**
 * Remove tracked symbols that are absent from the caller's authoritative list.
 *
 * WHY THIS IS NEEDED AT ALL, given `xx` on markRefreshed stops the bleeding:
 * `xx` stops NEW members arriving, it does not remove the ones already there.
 * dailyHistory is carrying ~2,130 symbols that were never universe members,
 * and left alone they would age one by one into the `stale` column -- so
 * fixing the cause without clearing the backlog would make that row look WORSE
 * for months while being more correct. Both halves or neither.
 *
 * OPT-IN, AND ONLY ONE CALLER USES IT. Four other sites call registerSymbols
 * with what their comments describe as the whole universe, and pruning those
 * too would make every denominator mean "currently maintained", which is the
 * better definition. It is not done here because "the comment says it is the
 * whole universe" is not the same as proving it for a job that refreshes a
 * slice per run, and a wrong prune fails in the reassuring direction. The
 * dailyHistory caller is the one where the list is provably the same `universe`
 * array that is then handed to getDailyHistoryBulk two lines later.
 *
 * DEFER ENTRIES GO TOO, matching deregisterSymbols: a deferral for a symbol
 * nothing tracks any more is an orphan in a set that only claimStalest prunes.
 */
async function reconcileToList(dataset: DatasetKey, symbols: string[]): Promise<void> {
  if (!redis) return;
  const keep = new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean));
  if (keep.size < AUTHORITATIVE_FLOOR) {
    console.warn(
      `[staleness] refusing to reconcile ${dataset}: ${keep.size} symbols is below ` +
        `the ${AUTHORITATIVE_FLOOR} floor, so this list is a partial one and ` +
        `pruning against it would shrink the denominator rather than correct it`
    );
    return;
  }
  try {
    const tracked = ((await redis.zrange<string[]>(queueKey(dataset), 0, -1)) ?? []).map(String);
    const drop = tracked.filter((sym) => !keep.has(sym.toUpperCase()));
    if (!drop.length) return;
    const p = redis.pipeline();
    for (let i = 0; i < drop.length; i += 500) {
      const slice = drop.slice(i, i + 500);
      p.zrem(queueKey(dataset), ...slice);
      p.zrem(deferKey(dataset), ...slice);
    }
    await p.exec();
    // LOUD, because a silent prune is indistinguishable from a silent wipe.
    console.log(
      `[staleness] ${dataset}: reconciled to ${keep.size} authoritative symbols, ` +
        `dropped ${drop.length} no longer maintained (${drop.slice(0, 10).join(", ")}` +
        `${drop.length > 10 ? ", ..." : ""})`
    );
  } catch {
    // bookkeeping -- never throws into the caller
  }
}

/**
 * Defer a symbol that failed, so it stops holding the front of the queue.
 *
 * THE RULE THIS IMPLEMENTS (spec, queue rule 1): a delisted ticker that always
 * fails is permanently the stalest thing in the set, so "do the stalest first"
 * silently becomes "retry the broken ones forever" and the genuinely stale tail
 * is never reached. Same treatment #337 gave profiles with no industry: mark,
 * come back in a week.
 *
 * Deliberately does NOT touch the refresh score. The symbol stays as stale as
 * it truly is, and the health page keeps reporting it as such.
 */
export async function deferSymbol(
  dataset: DatasetKey,
  symbol: string,
  seconds = 60 * 60 * 24 * 7
): Promise<void> {
  if (!redis || !symbol) return;
  try {
    await redis.zadd(deferKey(dataset), { score: Date.now() + seconds * 1000, member: symbol });
  } catch {
    // bookkeeping -- never throws into the caller
  }
}

/**
 * Remove symbols from EVERY dataset's queue and defer set.
 *
 * WHY THIS DID NOT EXIST. The only ZREM in this file clears a deferral, so
 * `tracked = ZCARD(queueKey)` only ever grew. An evicted symbol stayed a member
 * of all eight queues forever and was counted permanently stale in every
 * /cache-health denominator -- so removing a dead ticker made the health page
 * WORSE, which is a fine reason nobody did it.
 *
 * Across all datasets rather than one, deliberately. A symbol removed from the
 * site is removed from the site; leaving it in six queues and out of two is a
 * state nothing else in this file can express and nothing downstream expects.
 */
export async function deregisterSymbols(symbols: string[]): Promise<void> {
  if (!redis || !symbols.length) return;
  const members = symbols.filter(Boolean);
  if (!members.length) return;
  try {
    const p = redis.pipeline();
    for (const dataset of Object.keys(DATASETS) as DatasetKey[]) {
      p.zrem(queueKey(dataset), ...members);
      p.zrem(deferKey(dataset), ...members);
    }
    await p.exec();
  } catch {
    // bookkeeping -- never throws into the caller
  }
}

/**
 * The symbols currently deferred for a dataset.
 *
 * EXISTS BECAUSE NOT EVERY CONSUMER USES claimStalest. The price pool picks its
 * own work by TTL rather than by asking this queue for the stalest N, so the
 * deferral it now writes would have been write-only -- a symbol parked in a set
 * nothing reads is not deferred, it is just recorded as deferred, which is
 * worse than no deferral at all because it looks handled.
 *
 * Expired entries are filtered by SCORE rather than trusted to have been
 * cleaned: claimStalest prunes them as a side effect of its own read, and a
 * dataset that never calls claimStalest never prunes. A deferral that outlives
 * its own expiry is an eviction wearing a smaller name.
 */
export async function readDeferred(dataset: DatasetKey): Promise<Set<string>> {
  if (!redis) return new Set();
  try {
    const now = Date.now();
    const live = await redis.zrange<string[]>(deferKey(dataset), now, "+inf", {
      byScore: true,
    });
    return new Set(Array.isArray(live) ? live : []);
  } catch {
    // fail open -- a failed read means nothing is skipped, which is the
    // pre-deferral behaviour rather than a stall.
    return new Set();
  }
}

/**
 * The symbols whose last refresh is older than this dataset's own policy.
 *
 * THE LIST BEHIND THE NUMBER. readDatasetHealth already returns `stale` as a
 * ZCOUNT, and a count is enough to colour a row but not enough to compare two
 * beliefs: "337 past TTL" and "6 due" differ by 331, and 331 is satisfied by
 * any 331 symbols. warm-earnings needs to know WHICH, so it can say whether the
 * symbols the page is worried about are ones it has queued or ones it has never
 * heard of. Those are different faults and only one of them is real.
 *
 * SAME BOUNDS AS `stale`, deliberately: score in [1, cutoff], so the
 * never-refreshed (score 0) are excluded here exactly as they are there and the
 * two can be compared without one silently containing the other.
 *
 * RETURNS null ON FAILURE, NOT []. This is the whole reason it is not written
 * inline at the call site. An empty array from a failed read means "nothing is
 * rotting", which is the absence-reads-as-health defect this series keeps
 * finding -- and here it would land on the one signal whose job is to notice
 * rot. `null` makes the caller choose, and warm-earnings records the null
 * rather than a zero.
 *
 * BOUNDED by `limit` so this can never become a scan on a dataset whose
 * denominator has run away. A truncated list still detects a fault; it only
 * understates how big one is, and the caller has `stale` from
 * readDatasetHealth for the true count.
 *
 * SINGLE-POLICY DATASETS ONLY, and that is a real limitation rather than a
 * caveat. `ttlSeconds` is now the SLOW tier for a dataset that declares
 * `tieredPolicy`, so calling this for one would judge its fast-tier symbols
 * four times too leniently and quietly under-report them -- the same
 * one-policy-for-a-two-policy-dataset defect readTieredHealth exists to fix,
 * one layer up. Its only caller today is warm-earnings, which is not tiered,
 * and scripts/check-cache-health-accuracy.mjs asserts that every call site
 * names an untiered dataset so this stays true by check rather than by luck.
 */
export async function readPastTtl(
  dataset: DatasetKey,
  limit = 1000
): Promise<string[] | null> {
  if (!redis) return null;
  try {
    const cutoff = Date.now() - DATASETS[dataset].ttlSeconds * 1000;
    if (cutoff < 1) return [];
    const rows = await redis.zrange<string[]>(queueKey(dataset), 1, cutoff, {
      byScore: true,
      offset: 0,
      count: Math.max(1, limit),
    });
    return Array.isArray(rows) ? rows.map(String) : null;
  } catch {
    return null;
  }
}

/**
 * The `limit` stalest symbols that are not currently deferred.
 *
 * Reads a slack window (limit + deferred count) rather than exactly `limit`, so
 * a run whose front is entirely deferred still returns real work instead of a
 * short list. Bounded: the window is capped so this can never become a scan.
 *
 * Returns [] on any failure, which degrades the caller to whatever ordering it
 * used before rather than stopping it.
 */
export async function claimStalest(
  dataset: DatasetKey,
  limit: number
): Promise<string[]> {
  if (!redis || limit <= 0) return [];
  try {
    const now = Date.now();
    // Drop expired deferrals first, so the defer set cannot grow without bound
    // and a symbol whose week is up returns to contention.
    await redis.zremrangebyscore(deferKey(dataset), 0, now);

    const deferred = new Set(
      ((await redis.zrange<string[]>(deferKey(dataset), 0, -1)) ?? []).map(String)
    );

    // Slack for the deferred entries, hard-capped so this stays O(window).
    const window = Math.min(limit + deferred.size + 25, limit * 4 + 100);
    const candidates = ((await redis.zrange<string[]>(queueKey(dataset), 0, window - 1)) ?? []).map(
      String
    );

    const out: string[] = [];
    for (const sym of candidates) {
      if (out.length >= limit) break;
      if (deferred.has(sym)) continue;
      out.push(sym);
    }
    return out;
  } catch {
    return [];
  }
}

export type DatasetHealth = {
  dataset: DatasetKey;
  label: string;
  ttlSeconds: number;
  note: string;
  /** Symbols tracked in this dataset's queue. 0 means NOT INSTRUMENTED. */
  tracked: number;
  /** Tracked symbols whose last refresh is older than this dataset's own TTL. */
  stale: number;
  /** Tracked symbols never refreshed at all (score 0). */
  never: number;
  /** Currently deferred after repeated failure. */
  deferred: number;
  /** Oldest refresh timestamp among tracked symbols, ms. Null if none. */
  oldestMs: number | null;
  /**
   * When this dataset's queue was first seeded, ms. Null for a queue seeded
   * before this key existed -- which is a real state and is reported as such,
   * not silently treated as "just now".
   */
  seededAtMs: number | null;
  instrumented: boolean;
  /**
   * True when refreshes are gated on the market being open, so "past its TTL"
   * outside that window is the expected state rather than a failure. See the
   * note on pricePool in DATASETS.
   */
  marketHoursOnly: boolean;
  /**
   * FALSE when this dataset has no registerSymbols caller, so `tracked` counts
   * only the symbols something happened to refresh. `stale / tracked` is then a
   * ratio of a set to itself and cannot express a coverage failure at all. The
   * page must render this state distinctly rather than showing the number.
   */
  coverageEstablished: boolean;
  /**
   * The per-tier breakdown, for a dataset whose symbols are judged against more
   * than one policy. Null for every single-policy dataset, which is all of them
   * but the price pool.
   *
   * `stale` above is the SUM of these, so the page's status logic needs no
   * knowledge of tiering at all -- it reads one number that is now correct
   * instead of one that was computed against the wrong policy for two thirds of
   * the population. This field exists so the page can SHOW the split, which is
   * the half of the fix that makes the number checkable by eye.
   */
  tiers: DatasetTier[] | null;
};

export type DatasetTier = {
  label: string;
  ttlSeconds: number;
  /** Tracked symbols in this tier. */
  tracked: number;
  /** Of those, past THIS tier's policy (never-refreshed excluded). */
  stale: number;
};

/**
 * Split a tiered dataset's staleness by tier, judging each symbol against its
 * own policy.
 *
 * TWO COMMANDS, NOT A SCAN, which is the constraint this whole file is shaped
 * by. The naive version reads every member's score; this reads:
 *
 *   ZCOUNT over the SLOW cutoff   -- everything past the slow policy, both tiers
 *   ZMSCORE over the tier-1 list  -- exact scores for the ~200 fast symbols
 *
 * and derives the rest by subtraction, because {past the slow cutoff} is a
 * subset of {past the fast cutoff} and the fast tier's exact scores are known.
 * Tier 1 is capped at presets + 100, so the second command's size is bounded by
 * a constant rather than by the universe.
 *
 * AN UNREADABLE TIER LIST DEGRADES TO ALL-TIER-2, which is exactly what
 * priceTtlMsFor itself does with an empty set. The page then judges everything
 * at 60 minutes -- the lenient direction, and the same answer the code under
 * test would give. Degrading the other way would recreate the bug being fixed.
 */
async function readTieredHealth(
  dataset: DatasetKey,
  slowTtlSeconds: number,
  fastTtlSeconds: number,
  nowMs: number
): Promise<{ stale: number; tiers: DatasetTier[] } | null> {
  if (!redis) return null;
  try {
    const fastMembers = Array.from(await readTier1());
    const slowCutoff = nowMs - slowTtlSeconds * 1000;
    const fastCutoff = nowMs - fastTtlSeconds * 1000;

    const [trackedRaw, pastSlowAll] = await Promise.all([
      redis.zcard(queueKey(dataset)),
      redis.zcount(queueKey(dataset), 1, slowCutoff),
    ]);
    const tracked = Number(trackedRaw) || 0;

    let fastTracked = 0;
    let fastStale = 0;
    let fastPastSlow = 0;
    // Chunked for the same request-size reason as every other bulk command in
    // this file, even though the tier-1 cap makes one chunk the normal case.
    for (let i = 0; i < fastMembers.length; i += 500) {
      const slice = fastMembers.slice(i, i + 500);
      if (!slice.length) continue;
      // Awaited in the loop on purpose: bounded by the tier-1 cap, and one
      // request per chunk is the point everywhere else in this codebase.
      const scores = (await redis.zmscore(queueKey(dataset), slice)) as
        | (number | null)[]
        | null;
      if (!Array.isArray(scores)) continue;
      for (const raw of scores) {
        if (raw === null || raw === undefined) continue;
        const score = Number(raw);
        if (!Number.isFinite(score)) continue;
        fastTracked++;
        // Score 0 is NEVER-REFRESHED and is counted separately everywhere else
        // on this page; folding it in here would double-report it against the
        // `never` column beside it.
        if (score < 1) continue;
        if (score <= fastCutoff) fastStale++;
        if (score <= slowCutoff) fastPastSlow++;
      }
    }

    const slowTracked = Math.max(0, tracked - fastTracked);
    const slowStale = Math.max(0, (Number(pastSlowAll) || 0) - fastPastSlow);

    return {
      stale: fastStale + slowStale,
      tiers: [
        { label: "fast", ttlSeconds: fastTtlSeconds, tracked: fastTracked, stale: fastStale },
        { label: "rest", ttlSeconds: slowTtlSeconds, tracked: slowTracked, stale: slowStale },
      ],
    };
  } catch {
    // Fail open to the single-policy reading. It is the number this page showed
    // before, so a failure here is a regression to the old behaviour rather
    // than a blank row.
    return null;
  }
}

/**
 * Aggregates for one dataset. Four O(log n) commands, no scan, no per-symbol
 * read -- the whole reason the queue exists in this shape.
 */
export async function readDatasetHealth(dataset: DatasetKey): Promise<DatasetHealth> {
  const def = DATASETS[dataset];
  const base: DatasetHealth = {
    dataset,
    label: def.label,
    ttlSeconds: def.ttlSeconds,
    note: datasetNote(def),
    tracked: 0,
    stale: 0,
    never: 0,
    deferred: 0,
    oldestMs: null,
    seededAtMs: null,
    instrumented: false,
    coverageEstablished: def.coverage === "registered",
    marketHoursOnly:
      "refreshWindow" in def && def.refreshWindow === "market-hours",
    tiers: null,
  };
  if (!redis) return base;

  try {
    const nowMs = Date.now();
    const cutoff = nowMs - def.ttlSeconds * 1000;
    const [tracked, stale, never, deferred, oldest, seeded] = await Promise.all([
      redis.zcard(queueKey(dataset)),
      // `1` excludes the never-refreshed (score 0) so the two counts do not
      // double-report the same symbols; `never` carries those separately.
      redis.zcount(queueKey(dataset), 1, cutoff),
      redis.zcount(queueKey(dataset), 0, 0),
      redis.zcard(deferKey(dataset)),
      redis.zrange<(string | number)[]>(queueKey(dataset), 0, 0, { withScores: true }),
      redis.get<number | string | null>(seededKey(dataset)),
    ]);

    const oldestScore = Array.isArray(oldest) && oldest.length >= 2 ? Number(oldest[1]) : null;
    const trackedN = Number(tracked) || 0;

    // JUDGED PER TIER WHERE THE REGISTRY SAYS SO. `stale` above came from one
    // ZCOUNT against one cutoff, which is the right answer for eight of the
    // nine datasets and was wrong for two thirds of the ninth.
    const tiered =
      "tieredPolicy" in def && def.tieredPolicy && typeof def.fastTierTtlSeconds === "number"
        ? await readTieredHealth(dataset, def.ttlSeconds, def.fastTierTtlSeconds, nowMs)
        : null;

    return {
      ...base,
      tracked: trackedN,
      stale: tiered ? tiered.stale : Number(stale) || 0,
      tiers: tiered ? tiered.tiers : null,
      never: Number(never) || 0,
      deferred: Number(deferred) || 0,
      oldestMs: oldestScore && oldestScore > 0 ? oldestScore : null,
      seededAtMs: Number(seeded) > 0 ? Number(seeded) : null,
      instrumented: trackedN > 0,
    };
  } catch {
    return base;
  }
}

export async function readAllDatasetHealth(): Promise<DatasetHealth[]> {
  const keys = Object.keys(DATASETS) as DatasetKey[];
  return Promise.all(keys.map(readDatasetHealth));
}
