import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

// The site-wide rolling universe: which tickers MyStockHarbor currently cares
// about. Fed by the market route's discovery map and by search demand; read by
// pickersBuilder, the three plays builders, and the earnings warm job.
//
// WHY v2 IS A ZSET (and v1 was broken)
// ------------------------------------
// v1 stored the whole universe as a JSON array in ONE Redis string key, and
// addToDynamicUniverse was a read-modify-write: GET the blob, merge in JS, SET
// it back. Four builders (pickers, plays, bull-flags, descending-triangles) plus
// the warm cron can run concurrently, and every one of them calls this on every
// build. Interleaved writes silently lost score increments -- last writer won,
// and everything the other writers had just counted disappeared.
//
// That made `score` unreliable, which matters far more than it sounds: score is
// what decides which symbols survive the 700 cap and, in the planned rotation
// work, the order the scan wheel turns in. A wheel driven by a lossy counter
// turns in the wrong order.
//
// Sorted sets fix this at the storage layer rather than with a lock:
//   * ZINCRBY is atomic -- concurrent increments all land, none are lost.
//   * Pruning by age is ZREMRANGEBYSCORE on the `seen` set: one command,
//     no read-modify-write.
//   * Trimming to the cap is ZREMRANGEBYRANK on the `score` set: same.
//   * "The N stalest symbols" -- the primitive the rotation wheel needs -- is
//     a single ZRANGE on `seen`. See readStalestUniverseSlice below.
// And a write is now one small command instead of rewriting a 700-element blob.
//
// TWO SETS, NOT ONE
// -----------------
// A sorted set carries exactly one number per member, and we need two that move
// independently: cumulative score (how much we care) and lastSeen (how recently
// it appeared). So:
//   msh:dynamic-universe:v2:score -> member=symbol, score=cumulative score
//   msh:dynamic-universe:v2:seen  -> member=symbol, score=lastSeen ms epoch
// They are kept in step by always adding to both and always removing from both.
//
// PUBLIC API IS UNCHANGED ON PURPOSE
// ----------------------------------
// readDynamicUniverse() and addToDynamicUniverse() keep their exact previous
// names, signatures and return shape, so none of the five call sites needed
// editing -- four of which are 30-116KB builder files. Only this file changed.
// Every caller does `.map(entry => entry.symbol)` and nothing reads `.score`,
// `.sources` or `.lastSeen` (verified across app/ and lib/), so the internal
// representation was free to change.

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const LEGACY_KEY = "msh:dynamic-universe:v1";
const SCORE_KEY = "msh:dynamic-universe:v2:score";

/**
 * Increment many members of one sorted set in a single command.
 *
 * The boost is uniform per call, so it is passed once as ARGV[1] and the
 * members follow -- half the payload of interleaving pairs, and one less thing
 * to get out of step.
 */
const ZINCRBY_MANY_LUA = `
local boost = ARGV[1]
for i = 2, #ARGV do
  redis.call('ZINCRBY', KEYS[1], boost, ARGV[i])
end
return #ARGV - 1
`;

/**
 * Members per EVAL. The command count is already 1 per chunk rather than 1 per
 * symbol, so this is not about billing -- it bounds the request body, since a
 * single ARGV carrying the whole universe is a large POST for no benefit.
 */
const ZINCRBY_EVAL_CHUNK = 500;

function chunkMembers<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
const SEEN_KEY = "msh:dynamic-universe:v2:seen";

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO UNIVERSE CAPS, SIDE BY SIDE, BECAUSE THEY ARE NOT THE SAME NUMBER.
//
// Both are 700 today and they are different quantities. They live together so
// that whoever raises one has to read why the other did not move -- the four
// builders each carried their own hand-typed 700 with nothing comparing them,
// and raising three of four would have left them quietly disagreeing about how
// big the universe is, with the symptom being a pattern page missing names the
// screener shows rather than an error.
//
// ANALYSIS_UNIVERSE_CAP -- how many symbols a single build LOOKS AT.
//   Read by bullFlagsBuilder, descendingTrianglesBuilder, playsBuilder and
//   pickersBuilder. It SLICES, per build, non-destructively: lowering it loses
//   nothing, because the next build with a higher value sees the same
//   candidates again. Its cost is TIME -- every symbol is a history fetch and a
//   pass through the indicator stack. The thing that degrades linearly as it
//   grows is warm-stock-data, which uses a fixed 25-symbol slice per run, so
//   full coverage of valuation/dividend/analyst data stretches with it (~2.8h
//   at 416, ~4.7h at 700). REFRESH_SLICE_SIZE is the dial if that matters.
//
// MAX_DYNAMIC_UNIVERSE_SIZE -- how much of the rolling candidate pool is KEPT.
//   It PRUNES: pruneUniverse ZREMs everything past it from the sorted set, so
//   lowering it DESTROYS the accumulated score history of the symbols it drops
//   and they have to earn their way back from zero. Its cost is DATA, not time.
//
// They also sit on opposite sides of the same pipe: the dynamic universe is ONE
// INPUT to a pickers build, alongside PRESET_UNIVERSE (~100 mega-caps) and the
// popular-search promotions, and ANALYSIS_UNIVERSE_CAP bounds the UNION of all
// three. Folding them into one constant would assert that the pool and
// everything drawn from it are the same size, which they are not -- it is why
// the live warm-target universe is 759 against a 700 analysis cap, and why
// scripts/check-price-tiers.mjs sizes the pre-open buffer against their SUM.
// ─────────────────────────────────────────────────────────────────────────────
export const ANALYSIS_UNIVERSE_CAP = 700;

// EXPORTED so app/api/jobs/warm-earnings can derive the largest universe the
// caps allow -- the analysed cap UNIONED with this pool -- rather than reading
// it out of the source with a regex the way check-price-tiers has to.
export const MAX_DYNAMIC_UNIVERSE_SIZE = 700;
const ENTRY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type DynamicUniverseSource = "market" | "pickers" | "plays" | "search";

export type DynamicUniverseEntry = {
  symbol: string;
  score: number;
  /**
   * DEPRECATED and no longer persisted. Nothing in app/ or lib/ has ever read
   * this field, and under v1 only two of the four declared sources were ever
   * actually written ("market" from the four builders, "search" from the
   * popular-searches promotion) -- so it carried almost no information even
   * when it was stored. Recording it per symbol in a sorted-set world would
   * mean a third structure and another read-modify-write, which is exactly what
   * v2 exists to remove. Left optional rather than deleted so the type stays
   * source-compatible for any caller that references it.
   */
  sources?: DynamicUniverseSource[];
  lastSeen: number;
};

type LegacyEntry = {
  symbol?: unknown;
  score?: unknown;
  lastSeen?: unknown;
};

function normaliseSymbol(symbol: string) {
  return String(symbol).trim().toUpperCase();
}

function cleanSymbols(symbols: string[]) {
  return symbols.map(normaliseSymbol).filter(Boolean);
}

/**
 * Flat [member, score, member, score, ...] from a WITHSCORES ZRANGE into pairs.
 * Upstash returns members as-is and scores as numbers, but scores have been
 * observed as numeric strings depending on version, so coerce defensively.
 */
function pairsFromWithScores(raw: unknown): { member: string; score: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { member: string; score: number }[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const member = String(raw[i] ?? "").trim();
    const score = Number(raw[i + 1]);
    if (member && Number.isFinite(score)) out.push({ member, score });
  }
  return out;
}

/**
 * One-time migration from the v1 JSON blob.
 *
 * Without this the universe would reset to empty on deploy and have to rebuild
 * from scratch -- it would refill from the market discovery map within a build
 * or two, but every accumulated score would be lost, so the 700 cap would evict
 * effectively at random for a while.
 *
 * Safe to race: it writes ABSOLUTE scores with ZADD (not ZINCRBY), so two
 * concurrent seeds converge on the same values rather than double-counting.
 * Runs only while the v2 score set is empty, so it is a no-op forever after.
 */
async function seedFromLegacyIfEmpty() {
  if (!redis) return;

  try {
    const existing = await redis.zcard(SCORE_KEY);
    if (existing > 0) return;

    const legacy = await redis.get<LegacyEntry[]>(LEGACY_KEY);
    if (!Array.isArray(legacy) || !legacy.length) return;

    const now = Date.now();
    const scorePairs: { score: number; member: string }[] = [];
    const seenPairs: { score: number; member: string }[] = [];

    for (const entry of legacy) {
      const symbol = normaliseSymbol(String(entry?.symbol ?? ""));
      if (!symbol) continue;
      const score = Number(entry?.score);
      const lastSeen = Number(entry?.lastSeen);
      scorePairs.push({ member: symbol, score: Number.isFinite(score) ? score : 1 });
      seenPairs.push({ member: symbol, score: Number.isFinite(lastSeen) ? lastSeen : now });
    }

    if (!scorePairs.length) return;

    const [first, ...rest] = scorePairs;
    await redis.zadd(SCORE_KEY, first, ...rest);
    const [firstSeen, ...restSeen] = seenPairs;
    await redis.zadd(SEEN_KEY, firstSeen, ...restSeen);

    console.log(`[dynamic-universe] seeded v2 from v1 with ${scorePairs.length} symbols`);
  } catch (error) {
    // fail open -- a failed seed just means v2 starts empty and refills from
    // the next build's market discovery map.
    console.warn(
      "[dynamic-universe] legacy seed failed",
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Drop entries older than ENTRY_MAX_AGE_MS, then trim to MAX_DYNAMIC_UNIVERSE_SIZE
 * by score. Called on the WRITE path only: writes happen once per build, reads
 * happen on every page render, so pruning here keeps reads to a single ZRANGE.
 * Reads still filter by age themselves, so a stale entry can never leak out in
 * the window between prunes.
 */
async function pruneUniverse(nowMs: number) {
  if (!redis) return;

  // Age: `seen` is scored by timestamp, so everything expired is one contiguous
  // range at the bottom of it.
  const cutoff = nowMs - ENTRY_MAX_AGE_MS;
  try {
    const expired = await redis.zrange<string[]>(SEEN_KEY, 0, cutoff, { byScore: true });
    if (Array.isArray(expired) && expired.length) {
      await redis.zrem(SEEN_KEY, ...expired);
      await redis.zrem(SCORE_KEY, ...expired);
    }
  } catch {
    // fail open -- an unpruned entry is filtered on read anyway
  }

  // Cap: `score` is scored by score, so the symbols to evict are the lowest
  // ranks. Fetch them first so they can be removed from `seen` too, keeping the
  // two sets in step.
  try {
    const overflow = await redis.zrange<string[]>(
      SCORE_KEY,
      0,
      -(MAX_DYNAMIC_UNIVERSE_SIZE + 1)
    );
    if (Array.isArray(overflow) && overflow.length) {
      await redis.zrem(SCORE_KEY, ...overflow);
      await redis.zrem(SEEN_KEY, ...overflow);
    }
  } catch {
    // fail open -- the read path slices to the cap regardless
  }
}

/**
 * Top MAX_DYNAMIC_UNIVERSE_SIZE symbols by score, highest first, with anything
 * past ENTRY_MAX_AGE_MS filtered out. Same contract as v1.
 */
export async function readDynamicUniverse() {
  if (!redis) return [] as DynamicUniverseEntry[];

  try {
    await seedFromLegacyIfEmpty();

    const [scoreRaw, seenRaw] = await Promise.all([
      redis.zrange<(string | number)[]>(SCORE_KEY, 0, MAX_DYNAMIC_UNIVERSE_SIZE - 1, {
        rev: true,
        withScores: true,
      }),
      redis.zrange<(string | number)[]>(SEEN_KEY, 0, -1, { withScores: true }),
    ]);

    const seenBySymbol = new Map<string, number>();
    for (const { member, score } of pairsFromWithScores(seenRaw)) {
      seenBySymbol.set(member, score);
    }

    const now = Date.now();

    const entries = pairsFromWithScores(scoreRaw)
      .map(({ member, score }): DynamicUniverseEntry => ({
        symbol: member,
        score,
        // A symbol present in `score` but not `seen` shouldn't happen (both are
        // always written together) but would otherwise be filtered out below by
        // a lastSeen of 0, so treat it as seen now rather than silently drop it.
        lastSeen: seenBySymbol.get(member) ?? now,
      }))
      .filter((entry) => now - entry.lastSeen <= ENTRY_MAX_AGE_MS);

    if (entries.length) return entries;

    // SAFETY NET. An empty result here is indistinguishable from "the universe
    // is genuinely empty", but the far likelier cause on a fresh deploy is that
    // something about the v2 reads is wrong -- and an empty universe is not a
    // degraded site, it is picker pages losing most of their symbols. So rather
    // than trust an empty answer, fall back to reading v1 directly.
    //
    // Once v2 is populated this branch never runs. If it DOES keep running, the
    // warning below is the signal that v2 is not working and this should be
    // reverted -- do not let it sit quietly serving from v1 forever.
    return await readLegacyUniverseDirect();
  } catch {
    return await readLegacyUniverseDirect();
  }
}

/**
 * Read the v1 JSON blob with v1's exact semantics. Only ever reached when the
 * v2 sorted sets return nothing (or throw) -- see the safety net above.
 */
async function readLegacyUniverseDirect(): Promise<DynamicUniverseEntry[]> {
  if (!redis) return [];

  try {
    const legacy = await redis.get<LegacyEntry[]>(LEGACY_KEY);
    if (!Array.isArray(legacy) || !legacy.length) return [];

    const now = Date.now();
    const entries = legacy
      .map((entry): DynamicUniverseEntry | null => {
        const symbol = normaliseSymbol(String(entry?.symbol ?? ""));
        const score = Number(entry?.score);
        const lastSeen = Number(entry?.lastSeen);
        if (!symbol || !Number.isFinite(score) || !Number.isFinite(lastSeen)) return null;
        return { symbol, score, lastSeen };
      })
      .filter((entry): entry is DynamicUniverseEntry => entry !== null)
      .filter((entry) => now - entry.lastSeen <= ENTRY_MAX_AGE_MS)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_DYNAMIC_UNIVERSE_SIZE);

    if (entries.length) {
      console.warn(
        `[dynamic-universe] v2 returned nothing -- served ${entries.length} symbols from the v1 fallback. ` +
          `If this repeats, the v2 sorted sets are not working and the change should be reverted.`
      );
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * The N stalest symbols by lastSeen, oldest first -- one ZRANGE, no scan of the
 * whole universe.
 *
 * NOT WIRED UP YET. This is the primitive the planned scan-rotation wheel needs
 * (see claude/universe-architecture-audit-2026-08-06.md): price and stock-data
 * already rotate on their own staleness timestamps, but the picker scan itself
 * still takes the top N by score on every build rather than turning. Added here
 * because it is the whole reason `seen` is a sorted set rather than a field on
 * a blob, and it costs nothing until something calls it.
 */
export async function readStalestUniverseSlice(count: number): Promise<string[]> {
  if (!redis || count <= 0) return [];

  try {
    const raw = await redis.zrange<string[]>(SEEN_KEY, 0, count - 1);
    return Array.isArray(raw) ? raw.map((s) => String(s)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Remove symbols from the universe entirely — both sorted sets, kept in step.
 *
 * Added for reconciliation: the discovery candidate list can change shape (it
 * did on 2026-08-06, when the FMP screener was found to be returning 42.5%
 * mutual funds), and symbols admitted under an older, wrong candidate list need
 * evicting rather than waiting out the 14-day age window.
 *
 * Chunked because ZREM takes the members as arguments and a large eviction
 * would otherwise build one enormous command.
 */
export async function removeFromDynamicUniverse(symbols: string[]) {
  if (!redis) return 0;

  const cleaned = Array.from(new Set(cleanSymbols(symbols)));
  if (!cleaned.length) return 0;

  let removed = 0;
  for (let i = 0; i < cleaned.length; i += 200) {
    const group = cleaned.slice(i, i + 200);
    try {
      await redis.zrem(SCORE_KEY, ...group);
      await redis.zrem(SEEN_KEY, ...group);
      removed += group.length;
    } catch (error) {
      console.warn(
        "[dynamic-universe] remove failed",
        error instanceof Error ? error.message : error
      );
    }
  }

  return removed;
}

/**
 * Add or bump symbols. `source` is accepted for call-site compatibility but no
 * longer persisted -- see the note on DynamicUniverseEntry.sources.
 *
 * Every increment is atomic (ZINCRBY), so concurrent builders no longer
 * overwrite each other's counts the way the v1 read-modify-write did. That
 * property is unchanged by the move to EVAL -- the script issues the same
 * ZINCRBYs, it just issues them server-side as one billed command.
 */
export async function addToDynamicUniverse(
  symbols: string[],
  source: DynamicUniverseSource,
  scoreBoost = 1
) {
  void source;

  const cleaned = Array.from(new Set(cleanSymbols(symbols)));
  if (!cleaned.length || !redis) return;

  const now = Date.now();

  try {
    await seedFromLegacyIfEmpty();

    // ONE EVAL PER CHUNK, NOT ONE COMMAND PER SYMBOL.
    //
    // ZINCRBY takes a single member, so this was ~700 commands per call behind a
    // pipeline. The pipeline made it one round-trip, which is what the previous
    // comment was measuring -- but Upstash bills COMMANDS, not round-trips, and
    // this function is called from five builders plus the market route, so the
    // five builders alone were ~3,500 commands per build cycle.
    //
    // WHY NOT DROP THE PER-SYMBOL INCREMENTS ENTIRELY, given `seen` below is one
    // bulk ZADD. Because the two are not the same kind of value. lastSeen is an
    // absolute overwrite, so last-writer-wins is CORRECT for it. The score is a
    // cumulative count that ranks the universe -- read by the ZRANGE that picks
    // the top MAX_DYNAMIC_UNIVERSE_SIZE and by the overflow prune above -- and
    // for a count, last-writer-wins is precisely the v1 read-modify-write defect
    // that ZINCRBY was introduced to fix. A bulk ZADD here would reintroduce it.
    //
    // So the atomicity is kept and only the command count changes: the script
    // runs the same ZINCRBYs server-side, which is one billed command.
    for (const group of chunkMembers(cleaned, ZINCRBY_EVAL_CHUNK)) {
      await redis.eval(ZINCRBY_MANY_LUA, [SCORE_KEY], [String(scoreBoost), ...group]);
    }

    // lastSeen is an absolute overwrite, so the whole batch is one ZADD.
    const seenPairs = cleaned.map((symbol) => ({ member: symbol, score: now }));
    const [first, ...rest] = seenPairs;
    await redis.zadd(SEEN_KEY, first, ...rest);
  } catch (error) {
    // fail open, as v1 did -- a missed bump costs ranking accuracy, not
    // correctness, and the next build will bump again.
    console.warn(
      "[dynamic-universe] add failed",
      error instanceof Error ? error.message : error
    );
    return;
  }

  await pruneUniverse(now);
}

/** Diagnostics. Never throws. */
export async function statDynamicUniverse(): Promise<{
  scored: number | null;
  seen: number | null;
}> {
  if (!redis) return { scored: null, seen: null };
  try {
    const [scored, seen] = await Promise.all([
      redis.zcard(SCORE_KEY),
      redis.zcard(SEEN_KEY),
    ]);
    return {
      scored: typeof scored === "number" ? scored : null,
      seen: typeof seen === "number" ? seen : null,
    };
  } catch {
    return { scored: null, seen: null };
  }
}
