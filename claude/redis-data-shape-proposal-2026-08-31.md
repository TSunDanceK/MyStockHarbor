# Redis data-shape changes: findings and recommendation (2026-08-31)

Tasks 5 and 6 of the Redis command budget work. Both were flagged up front as
needing judgement rather than mechanical application, and both turn out to
deserve a decision before code. This is that write-up.

**Recommendation in one line each:**

- **Task 5 (fundamentals -> one hash): do not ship.** The saving is ~0.4% of a
  bad day's commands and it silently trades a per-symbol expiry for a
  whole-hash one, which converts "no data, show --" into "stale data, shown as
  current" for exactly the symbols most likely to be wrong.
- **Task 6 (per-symbol ZINCRBY -> one EVAL): worth doing, ready to implement.**
  A single Lua script preserves the atomicity the v2 rewrite exists to protect
  and takes ~700 commands per call to 1. Held back only because the task said to
  propose first.

---

## Task 5 — one hash instead of 755 keys for fundamentals

### What is there now

`lib/server/fundamentalsCache.ts` writes one `SET` per symbol behind a pipeline:

| Site | Volume | Cadence | Commands/day |
|---|---|---|---|
| `warmFundamentals` write loop | up to ~755 (one per symbol with any data) | hourly, `22 * * * *` | ~18,000 |
| `cacheScreenerFundamentals` | up to `SCREENER_LIMIT` = 1,000 | daily, `50 6 * * *` | ~1,000 |

A hash version — chunked `HSET` plus one `EXPIRE`, the `pricePool.ts` pattern —
would be roughly 20 commands per warm run instead of 755. **Ceiling on the
saving: ~18,500 commands/day.**

### Why that is smaller than it looks

**The read path is already one command.** `readCachedFundamentalsBulk` and the
three readers beside it use `redis.mget(...keys)`, and Upstash bills an MGET as
one command however many keys it carries. There is no read-side saving available
here — unlike Task 4, where the pipeline of 700 GETs was 700 billed commands.
The entire benefit is write-side.

For scale: Friday's incident was ~4.6M commands. ~18,500/day is about **0.4%** of
that. #377 (the pickers single-flight hole) and #378 (chunked history MGETs)
address the items measured in millions and hundreds of thousands.

### The risk, specifically

Not "hashes are scary" — one concrete regression.

Today each row carries its own 26h TTL (`FUND_TTL_SECONDS`). A symbol that stops
being written disappears on its own. In a single hash, every write resets one
TTL for the whole hash, so nothing individually expires — and the write loop
skips symbols with no data:

```ts
if (!q && !p && !sc) continue;
```

...and only iterates the current universe. **So the rows that would persist
forever are precisely the ones that stopped being covered**: delisted names,
symbols dropped from the universe, anything that fell out of rotation. Readers
return whatever is in the map and callers render it, so the failure mode is a
stale market cap or P/E displayed as current, indefinitely, instead of the `--`
that appears today. That is a correctness regression bought with a performance
gain, which is the wrong direction for the trade.

It is fixable — the row already carries `updatedAt`, so the read path could
filter on age and reproduce the old expiry explicitly. But that is new logic on
a hot read path, replacing something Redis was doing correctly for free.

### The migration is a two-deploy change

Old per-symbol keys and the new hash coexist for `FUND_TTL_SECONDS` (26h) after
the deploy. During that window reads must try the hash **and** fall back to the
per-symbol MGET, which is *more* commands than today, and a second deploy has to
land afterwards to remove the fallback. A follow-up that must happen for the
change to pay off is a follow-up that can be forgotten.

### If it is done anyway

Do the two halves separately, and the screener half first. `cacheScreenerFundamentals`
rewrites a full 1,000-row snapshot from one FMP call every day, so a hash there
has a trivial eviction story — delete and rewrite — with no per-symbol expiry
semantics to lose. The per-symbol fundamentals cache is the one that accumulates
and therefore the one that needs the `updatedAt` age guard.

On its own though, the screener half saves ~1,000 commands/day, which does not
justify a migration.

---

## Task 6 — per-symbol ZINCRBY in dynamicUniverseCache

### What is there now

`addToDynamicUniverse` pipelines one `ZINCRBY` per symbol (~700), because
ZINCRBY takes a single member. Six call sites:

- `pickersBuilder.ts` (two)
- `bullFlagsBuilder.ts`, `playsBuilder.ts`, `descendingTrianglesBuilder.ts`
- `app/api/market/route.ts`

The five builders alone are **~3,500 commands per full build cycle**, plus
market-route admissions on top.

### Are the atomic increments needed?

Yes, and the file says why: v1 did a read-modify-write and concurrent builders
overwrote each other's counts. ZINCRBY is what fixed that. The score is a
cumulative popularity signal that drives the `ZRANGE` ranking and the overflow
prune, so it is not incidental.

The `seen` set being one bulk `ZADD` does **not** generalise to it. `lastSeen` is
an absolute overwrite — last writer wins is the correct semantics for a
timestamp. A count is the opposite: last writer wins is exactly the bug v2
removed. So "make the score a bulk ZADD too" would reintroduce v1's defect.

### Recommendation: one EVAL

A single Lua script looping the increments preserves the semantics exactly and
costs one command:

```lua
for i = 1, #ARGV, 2 do
  redis.call('ZINCRBY', KEYS[1], ARGV[i], ARGV[i + 1])
end
```

**~700 commands -> 1**, per call, at six call sites.

Verified on the installed client: `redis.eval` and `redis.evalsha` are both
available on `@upstash/redis` (instance methods — a `Redis.prototype.eval` check
reports `undefined` and is misleading).

Two implementation notes for whoever picks this up:

1. **Chunk the members** (~500 per EVAL). A single ARGV carrying 1,400 entries is
   a large request body, and the existing code is already comfortable chunking.
2. **Keep the fail-open catch.** The current handler treats a failed bump as a
   ranking-accuracy loss, not a correctness one, and that stays true.

This one is low-risk: no data shape changes, no migration, no coexistence
window, and the read path is untouched. It is written up rather than
implemented only because the task asked for a proposal first.
