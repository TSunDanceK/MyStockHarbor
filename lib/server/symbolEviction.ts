// Removing a symbol from the site, and knowing what "removing" has to touch.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE DETECTION SIGNAL, AND WHY ABSENCE ALONE IS NOT ONE.
//
// The obvious signal is absence from the daily company-screener response: the
// call is already made, so it costs nothing, and probe Q5 confirmed WFM (taken
// private) reads isActivelyTrading: false. But the screener URL already filters
// `isActivelyTrading=true` AND takes only the top SCREENER_LIMIT rows by market
// cap -- so a symbol is absent from it for TWO completely different reasons:
//
//   it was delisted                       -> evict
//   it fell below the market-cap cut-off  -> absolutely do not evict
//
// Nothing in the response distinguishes them, and the second is the common
// case: at limit 3000 the floor is ~$2B, so every live small-cap in the
// universe is "absent" every single day. Absence alone would evict the entire
// tail of the universe.
//
// SO THE RULE IS ABSENCE **AND** A LIVE QUOTE FAILURE, CORROBORATED ACROSS
// DAYS. A symbol that has fallen below the cap still quotes fine; a delisted
// one does not. pricePool's failStreak (#403) is exactly that second signal and
// already exists, which is why this builds on it rather than adding a probe.
//
// EVICTION IS DESTRUCTIVE AND MUST NOT TURN ON ONE READING. pruneUniverse ZREMs
// the score, so an evicted symbol restarts from zero and has to earn its way
// back. One bad screener response, one FMP outage, one deploy in the middle of
// a run -- any of those produce a single day of both signals. Corroboration is
// counted in DISTINCT UTC DAYS rather than in consecutive runs, because a
// per-run counter is satisfied by one bad hour.
// ─────────────────────────────────────────────────────────────────────────────

import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { PRESET_UNIVERSE } from "./presetUniverse";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

/** Distinct days on which both signals must agree before anything is removed. */
export const EVICTION_CORROBORATION_DAYS = 3;
/** The pricePool failure streak that counts as "does not quote". */
export const EVICTION_MIN_FAIL_STREAK = 3;

// HOW RECENT THAT STREAK HAS TO BE, AND WHY IT IS NOT OPTIONAL.
//
// For any symbol below the screener's market-cap floor, `absent` is true EVERY
// DAY by construction -- the header above says so -- and clearAbsence only
// fires for symbols PRESENT in the response, so it never fires for them. The
// only live gate on evicting a small-cap is therefore the failure streak, and
// an UNDATED streak is evidence forever:
//
//   an FMP incident inflates failStreak across the universe (fixed upstream by
//   classifying refusals, but a 200-with-empty-body still counts)
//     -> the deferral then stops the symbol being retried for up to 24h
//     -> so the inflated streak is STILL IN THE ROW when tomorrow's sweep reads
//        it, and the sweep books another absence day
//     -> three such days inside ABSENCE_TTL_SECONDS evicts a live small-cap,
//        and pruneUniverse ZREMs its score so it restarts from zero.
//
// http-429 occurred on three consecutive days, 08-30 to 09-01. This is not a
// hypothetical chain.
//
// 48h rather than 24: the deferral cap is 24h, so a symbol can legitimately go
// a full day without being asked. A window at exactly the cap would race it.
export const EVICTION_FAIL_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const ABSENCE_KEY_PREFIX = "msh:evict:absent:v1:";
// Longer than the corroboration window so a streak can accumulate, short enough
// that a symbol which reappears stops counting rather than carrying old days
// forward forever. A gap resets the evidence, which is the intent: the rule is
// "absent on N days recently", not "absent on N days ever".
const ABSENCE_TTL_SECONDS = 10 * 24 * 60 * 60;

const EVICTED_KEY = "msh:evict:log:v1";

/**
 * Should this symbol be removed?
 *
 * PURE, so the invariant check can RUN it. "Eviction requires corroboration"
 * is a claim about behaviour over inputs, and a regex cannot tell a threshold
 * that is applied from one that is declared.
 */
export function shouldEvict(
  absenceDays: number,
  failStreak: number,
  failAt: number | undefined,
  nowMs: number
): boolean {
  if (absenceDays < EVICTION_CORROBORATION_DAYS) return false;
  if (failStreak < EVICTION_MIN_FAIL_STREAK) return false;
  // THE STREAK MUST BE ABOUT TODAY. A row parked yesterday still carries
  // yesterday's streak, and "was failing 24 hours ago and has not been asked
  // since" is not evidence that a symbol is delisted.
  if (!failAt || !Number.isFinite(failAt)) return false;
  return nowMs - failAt <= EVICTION_FAIL_MAX_AGE_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PRESET LIST CANNOT BE EVICTED, ONLY HAND-EDITED.
//
// PRESET_UNIVERSE's ~100 mega-caps reach this rule like anything else:
//
//   pickersBuilder.ts  fillSlots(PRESET_UNIVERSE, PRESET_UNIVERSE.length)
//     -> universe -> signalRecords -> getWarmTargetSymbols()
//     -> warm-screener-fundamentals  universe.filter(s => !present.has(s))
//
// but evictSymbol deletes Redis keys, and PRESET_UNIVERSE is a hardcoded
// TypeScript array in the bundle. There is no key to delete. So evicting one
// removes its caches, the next pickers build re-injects the same ticker from
// the array, it re-fails, three days later it is evicted again -- an
// evict -> reinject -> refail loop that never resolves, filling the eviction
// log with one ticker while the actual remedy (edit the file, redeploy) is
// something no human is ever told about.
//
// This is not hypothetical for THIS list: META is in it, and FB -> META is
// exactly the rename case that would trigger the rule.
//
// SO A DEAD PRESET SYMBOL IS AN ALARM, NOT AN EVICTION. The action a person
// has to take is a hand edit, so the output has to be a message addressed to a
// person -- and it has to arrive ONCE, because a message that repeats daily is
// the same log-filling churn in a different colour, and gets muted the same way.
//
// The exemption is deliberately wide: every preset symbol, not just the ones a
// rename could explain. If a curated mega-cap stops quoting for three days,
// somebody should look at it by hand whatever the cause.
export const PRESET_SYMBOLS: ReadonlySet<string> = new Set(
  PRESET_UNIVERSE.map((s) => s.trim().toUpperCase())
);

/** keep: no case to answer. evict: remove it. hand-edit: a person must. */
export type EvictionAction = "keep" | "evict" | "hand-edit";

/**
 * What should happen to this symbol?
 *
 * PURE, and it takes the preset set as an argument DEFAULTED to the real one,
 * so the invariant check can both run it against a fabricated set and run it
 * against the shipped list -- "META is exempt" is a claim about the array's
 * contents as much as about this branch, and a check that injects its own set
 * proves only half of it.
 *
 * Normalised on the way in. The pool stores symbols as the screener returns
 * them; if one ever arrives lower-cased or padded, a raw `has` would miss the
 * exemption and evict a preset name -- the exact outcome this exists to
 * prevent, arrived at through a formatting difference.
 */
export function evictionAction(
  symbol: string,
  absenceDays: number,
  failStreak: number,
  failAt: number | undefined,
  nowMs: number,
  presets: ReadonlySet<string> = PRESET_SYMBOLS
): EvictionAction {
  if (!shouldEvict(absenceDays, failStreak, failAt, nowMs)) return "keep";
  return presets.has(String(symbol ?? "").trim().toUpperCase()) ? "hand-edit" : "evict";
}

const PRESET_ALARM_KEY_PREFIX = "msh:evict:preset-alarm:v1:";
// LONG ENOUGH TO BE "ONCE", SHORT ENOUGH NOT TO BE "NEVER AGAIN". A permanent
// marker means one missed log line is the only warning that will ever exist;
// a daily one is the churn this replaces. A month is the compromise, and the
// run record below carries the symbol EVERY day regardless -- the state is
// always visible, it is only the shouting that is rationed.
const PRESET_ALARM_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Claim the right to shout about this symbol. True at most once a month.
 *
 * SET NX is the whole mechanism: the claim and the test are one round trip, so
 * two runs overlapping cannot both win it. Fails CLOSED (returns false) with no
 * Redis or on an error -- an alarm that cannot be de-duplicated is the loop,
 * and the run record still names the symbol either way.
 */
export async function claimPresetHandEditAlarm(
  symbol: string,
  nowMs = Date.now()
): Promise<boolean> {
  if (!redis || !symbol) return false;
  try {
    const res = await redis.set(`${PRESET_ALARM_KEY_PREFIX}${symbol}`, dayStamp(nowMs), {
      ex: PRESET_ALARM_TTL_SECONDS,
      nx: true,
    });
    return res === "OK";
  } catch {
    return false;
  }
}

// A run whose deferrals were suppressed wholesale, or which spent most of its
// attempts being refused, produced streaks that describe FMP rather than any
// ticker. 10% of the universe parked at once is the same statement: delistings
// arrive one at a time.
export const POOL_DEGRADED_DEFER_SHARE = 0.1;
export const POOL_DEGRADED_REFUSAL_SHARE = 0.2;

// EMPTIES, AND WHY THIS THRESHOLD IS NOT THE CIRCUIT BREAKER'S.
//
// pricePool's PRICE_EMPTY_RATE_ABORT is 0.5 and this is 0.2, and the two are
// allowed to differ because they answer different questions:
//
//   the breaker, at 50%   "the world is obviously broken" -- withholds an
//                         ACTION inside ONE RUN. Set high because discarding a
//                         run's deferrals is itself destructive of real
//                         evidence, so it should only fire when the run is
//                         beyond doubt.
//   this gate, at 20%     "these streaks are not evidence" -- refuses to act
//                         on a WHOLE SESSION. Set at the refusal threshold
//                         because it is the same judgement about the same
//                         session, and a run that came back empty a fifth of
//                         the time is no more trustworthy than one refused a
//                         fifth of the time.
//
// THE GAP BETWEEN THEM WAS ACCIDENTAL AND IT WAS THE ROUND-1 EVICTION CHAIN,
// UNCOVERED. A run at 21-50% empties is not suppressed by the breaker, so its
// deferrals apply and its streaks stick; and it was not caught here, because
// `empties` was in the type and in the stored record and NOTHING READ IT --
// the same "declared, so it looks checked" pattern as `at`, one field over in
// the same signature. Three such days is an evicted live symbol.
export const POOL_DEGRADED_EMPTY_SHARE = 0.2;

// HOW OLD THE SESSION RECORD MAY BE.
//
// `at` was in the parameter type and nothing read it -- a field in a signature
// that nothing checks is a field that LOOKS checked. The session-health key
// carries a 36h TTL, so if warm-price-pool dies for 30 hours the key is still
// live and a 30-hour-old session reads as a clean bill of health for today.
//
// 24h: below the key's own TTL so this is the binding limit rather than a
// second opinion about it, and below EVICTION_FAIL_MAX_AGE_MS (48h) so the gate
// can never be more permissive than the evidence rule it protects.
export const POOL_HEALTH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Is the last real price-pool session too degraded for its streaks to be
 * evidence?
 *
 * READS THE SESSION-HEALTH RECORD, NOT THE JOB RECORD, and that is the whole
 * fix. warm-screener-fundamentals runs at 06:50 UTC = 02:50 ET, when
 * warmPricePool's market-hours gate returns early with
 * { ok: true, skipped: true, reason: "market-closed" } and none of the fields
 * below. jobRuns keeps ONE key per job -- "this is not a history" -- so the
 * last job record at sweep time is ALWAYS that skip. Every condition here
 * would have read a null and passed:
 *
 *   deferSuppressed  null -> not === true                        -> pass
 *   deferredSymbols  null -> ?? 0 -> 0 > targets * 0.1 is false   -> pass
 *   priceAttempts    null -> ?? 0 -> `attempts > 0` is FALSE, so the
 *                                    refusal test is skipped entirely
 *
 * `targets` survived only because the route records it from symbols.length
 * independently of the result -- which is why the assertion tying the gate to
 * that field name passed while the gate itself did nothing.
 *
 * THE GENERAL DEFECT WAS FAILING OPEN ON A MISSING FIELD. `numOf(k) ?? 0`
 * followed by `if (x > 0)` makes absent data read as healthy. Every field is
 * now REQUIRED: absence is a reason to skip, never a pass. In a PR series about
 * absence being mistaken for health, of all places.
 *
 * Returns the REASON rather than a boolean, so a skipped day says which
 * condition stopped it.
 *
 * PURE over the record, so the invariant check can RUN it against a realistic
 * market-closed shape rather than a fixture with every field populated.
 */
export function poolLooksDegraded(
  health: {
    /** Read, not decorative -- see POOL_HEALTH_MAX_AGE_MS. */
    at?: unknown;
    priceAttempts?: unknown;
    quotesRefused?: unknown;
    /** Read, not decorative -- see POOL_DEGRADED_EMPTY_SHARE. */
    empties?: unknown;
    deferredSymbols?: unknown;
    deferSuppressed?: unknown;
  } | null,
  universeSize: number,
  nowMs: number = Date.now()
): string | null {
  // NO RECORD IS NOT A CLEAN BILL. On a Monday the last session was Friday and
  // the 36h TTL has expired it, which is correct: EVICTION_FAIL_MAX_AGE_MS is
  // 48h, so Friday's streaks could not evict anything anyway.
  if (!health) return "no-session-run";

  // THE LAST FAIL-OPEN IN THIS FUNCTION, removed. The call site guarantees a
  // positive size today, which made `universeSize > 0 &&` dead code that read
  // as a guard -- the exact shape that made two earlier drafts of this function
  // inert. If it is ever not positive, that is a broken universe read and a
  // reason to skip, not to proceed.
  if (!Number.isFinite(universeSize) || universeSize <= 0) return "no-universe";

  // The record must be about TODAY'S session, not merely present.
  const at = typeof health.at === "number" && Number.isFinite(health.at) ? health.at : null;
  if (at === null) return "incomplete-record";
  if (nowMs - at > POOL_HEALTH_MAX_AGE_MS) return "stale-session-record";

  if (health.deferSuppressed === true) return "defer-suppressed";

  const numOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const attempts = numOf(health.priceAttempts);
  const refused = numOf(health.quotesRefused);
  const empties = numOf(health.empties);
  const deferredSymbols = numOf(health.deferredSymbols);
  // REQUIRED, NOT DEFAULTED. A record that reached here without these is a
  // shape nothing writes today, which makes it a reason to distrust the record
  // rather than to trust the run. `empties` joins them because it is READ now:
  // a field whose absence is tolerated is a field whose absence passes.
  if (attempts === null || refused === null || empties === null || deferredSymbols === null) {
    return "incomplete-record";
  }
  if (typeof health.deferSuppressed !== "boolean") return "incomplete-record";

  if (deferredSymbols > universeSize * POOL_DEGRADED_DEFER_SHARE) return "many-deferred";
  // A session that attempted nothing has no evidence in it either way.
  if (attempts <= 0) return "no-attempts";
  if (refused > attempts * POOL_DEGRADED_REFUSAL_SHARE) return "many-refused";
  // Same shape as the refusal check above, deliberately: a session that came
  // back empty a fifth of the time is no more evidence about tickers than one
  // refused a fifth of the time, and the band between this and the run-level
  // breaker at 50% is exactly where the eviction chain lived.
  if (empties > attempts * POOL_DEGRADED_EMPTY_SHARE) return "many-empty";

  return null;
}

function dayStamp(nowMs: number) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Record that a symbol was missing from today's screener response.
 *
 * Idempotent per day: the stored value is a set of day stamps, so a job that
 * runs twice cannot manufacture corroboration out of one day's evidence. That
 * is the whole reason this is not an INCR.
 */
export async function recordAbsence(symbol: string, nowMs = Date.now()): Promise<number> {
  if (!redis || !symbol) return 0;
  const key = `${ABSENCE_KEY_PREFIX}${symbol}`;
  try {
    const stored = (await redis.get<string[]>(key)) ?? [];
    const days = new Set(Array.isArray(stored) ? stored : []);
    days.add(dayStamp(nowMs));
    const list = Array.from(days).sort().slice(-EVICTION_CORROBORATION_DAYS * 2);
    await redis.set(key, list, { ex: ABSENCE_TTL_SECONDS });
    return list.length;
  } catch {
    return 0;
  }
}

/** Clear the evidence. Called the moment a symbol reappears in the screener. */
export async function clearAbsence(symbols: string[]): Promise<void> {
  if (!redis || !symbols.length) return;
  try {
    for (let i = 0; i < symbols.length; i += 500) {
      const group = symbols.slice(i, i + 500);
      const p = redis.pipeline();
      for (const s of group) p.del(`${ABSENCE_KEY_PREFIX}${s}`);
      await p.exec();
    }
  } catch {
    // fail open -- stale evidence expires on its own, and shouldEvict still
    // needs the quote-failure half before anything is removed.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WHAT REMOVAL HAS TO TOUCH.
//
// DERIVED FROM THE CODE, NOT HAND-TYPED. Every entry below is a prefix that
// some module builds a PER-SYMBOL key from, and scripts/check-symbol-eviction.mjs
// re-derives that set by scanning for `${SOMETHING_PREFIX}${symbol}` shapes and
// fails if any is missing here. A hand-typed list goes stale the first time a
// key is added, and the symptom is a symbol that was "removed" still costing
// storage and still answering reads.
//
// `sep` is not decoration: the codebase writes both `${PREFIX}${symbol}` and
// `${PREFIX}:${symbol}`, and a wrong separator deletes nothing while looking
// like it deleted something.
export type PerSymbolKey = { prefix: string; sep: "" | ":" };

export const PER_SYMBOL_KEYS: PerSymbolKey[] = [
  { prefix: "msh:history:v7", sep: ":" },
  { prefix: "msh:history-lock:v1", sep: ":" },
  { prefix: "msh:stockdata:v1:", sep: "" },
  { prefix: "msh:pickers:fundamentals:v1:", sep: "" },
  { prefix: "msh:pickers:profile:v1:", sep: "" },
  { prefix: "msh:pickers:profile-noindustry:v1:", sep: "" },
  { prefix: "msh:pickers:screener-fundamentals:v1:", sep: "" },
  { prefix: "msh:pickers:earnings:v1:", sep: "" },
  { prefix: "msh:pickers:earnings:v1:due:", sep: "" },
  { prefix: "msh:news:v1:", sep: "" },
  { prefix: "msh:ai:stock-analysis:v2", sep: ":" },
  { prefix: "msh:earnings-quoted-symbol:v1", sep: ":" },
  { prefix: "msh:quote:v1", sep: ":" },
  // THIS MODULE'S OWN EVIDENCE KEY. Found by the derived scan, not by thinking
  // about it -- and it matters: leaving the absence record behind means a
  // symbol that is re-admitted later starts with days of stale evidence
  // already against it, and could be evicted again on its first bad quote.
  { prefix: "msh:evict:absent:v1:", sep: "" },
  // The hand-edit alarm marker. A preset symbol is never evicted, so this is
  // only reachable after somebody REMOVES the ticker from PRESET_UNIVERSE --
  // at which point it is an ordinary symbol and its marker should go with the
  // rest of its state, or a later re-admission starts with the alarm already
  // claimed and silently un-warnable.
  { prefix: "msh:evict:preset-alarm:v1:", sep: "" },
];

// THE TWO HASHES ARE THE ACTUAL LEAK. Their fields carry no TTL and the
// key-level expiry is reset on every run, so a dead field is immortal. There is
// no `hdel` anywhere else in this codebase -- these are the first two.
export const PER_SYMBOL_HASHES = ["msh:price-pool:v1", "msh:picker-charts:v1"];

// The sorted sets a symbol is a member of. Unlike the string keys these have no
// TTL of their own either, and an evicted symbol left in a staleness queue is
// counted permanently stale in every /cache-health denominator.
export const PER_SYMBOL_ZSETS = [
  "msh:dynamic-universe:v2:score",
  "msh:dynamic-universe:v2:seen",
];

/**
 * WHY EXPLICIT DELETION RATHER THAN LETTING THE TTLs LAPSE.
 *
 * Every string key above carries a TTL, so a cheaper design would delete only
 * the two hashes and the sorted sets -- the things that never self-clean -- and
 * let the rest expire. That is a real option and it is not the one taken, for
 * two reasons:
 *
 *   * VOLUME MAKES IT MOOT. Evictions are a handful of symbols a year, not a
 *     bulk operation. Thirteen DELs times a few symbols is not a cost worth
 *     designing around, and "fewer commands" is only a virtue when the commands
 *     are many.
 *   * "WAS THIS SYMBOL REMOVED" HAS TO BE ANSWERABLE. With partial cleanup the
 *     answer is "yes, but some of its data is still there for up to 50 hours",
 *     which is the kind of half-state that turns one confusing bug report into
 *     an afternoon. A complete delete plus a log entry is one fact.
 *
 * Returns what it touched rather than void, so the caller can record it.
 */
export async function evictSymbol(
  symbol: string,
  nowMs = Date.now()
): Promise<{ keys: number; hashes: number; zsets: number }> {
  const out = { keys: 0, hashes: 0, zsets: 0 };
  if (!redis || !symbol) return out;

  try {
    const p = redis.pipeline();
    for (const { prefix, sep } of PER_SYMBOL_KEYS) p.del(`${prefix}${sep}${symbol}`);
    for (const hash of PER_SYMBOL_HASHES) p.hdel(hash, symbol);
    for (const zset of PER_SYMBOL_ZSETS) p.zrem(zset, symbol);
    // COUNTED FROM WHAT THE PIPELINE ACTUALLY DID, not from the length of the
    // list we sent. Reporting PER_SYMBOL_KEYS.length claims 14 deletions when
    // 14 keys were absent -- which makes an eviction that removed nothing
    // indistinguishable from one that removed everything, in the one record
    // anybody would consult to find out.
    const results = (await p.exec()) as unknown[];
    const counted = results.map((r) => (typeof r === "number" ? r : r ? 1 : 0));
    let i = 0;
    for (const _ of PER_SYMBOL_KEYS) out.keys += counted[i++] ?? 0;
    for (const _ of PER_SYMBOL_HASHES) out.hashes += counted[i++] ?? 0;
    for (const _ of PER_SYMBOL_ZSETS) out.zsets += counted[i++] ?? 0;

    // AN AUDIT ENTRY, NOT A TOMBSTONE. It records that this happened and when,
    // so a symbol vanishing from the site has an answer. It deliberately does
    // NOT gate re-admission: if the symbol comes back and the screener returns
    // it, discovery should admit it like any other.
    await redis.zadd(EVICTED_KEY, { score: nowMs, member: symbol });
  } catch {
    // fail open -- a failed eviction costs storage, not correctness, and the
    // evidence is still on file for the next run to retry.
  }

  return out;
}
