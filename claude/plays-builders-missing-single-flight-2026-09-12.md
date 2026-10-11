# The plays builders never got the #377/#378 single-flight fix

Found 2026-09-12, tracing whether the 48-regenerations/day ISR ceiling on the
plays pages is a real bound. **It is not, on a cold cache.**

## The August failure shape

The 2026-08-27/28 outage had a specific mechanism: *"Every cache was empty… A
request that loses the lock only short-circuits if a cached payload exists… every
concurrent request falls through and runs its own full build."* That was
`pickersBuilder`, and #377/#378 fixed it by adding `waitForPickersPayload()` — a
lock loser with nothing cached **waits for the winner to publish** instead of
building its own copy.

## All three plays builders still have the pre-fix shape

`playsBuilder.ts:1064`, `bullFlagsBuilder.ts:1058`, `descendingTrianglesBuilder.ts:1092`
are near-identical:

```ts
const lockToken = await acquirePlaysLock();

if (!lockToken) {
  const fallbackCached = cached ?? (await readPlaysCache());
  if (fallbackCached?.data && !debugSymbol) {
    return fallbackCached;        // short-circuits ONLY if something is cached
  }
  // no wait, no throw — falls through
}

const data = await buildPlaysPayload(origin, forceRefresh, debugSymbol);
```

All three **do** take an NX lock, which is why this does not look like the August
bug at a glance. The missing piece is the wait. `pickersBuilder` references
`waitForPickersPayload` five times; **all three plays builders contain zero
wait-for-winner of any kind.** The fix was never ported.

## Consequence

Each plays build reads ~700 symbols one at a time. Per regeneration that is ~700
history GETs plus **~4,200 billed write commands of bandwidth instrumentation**
alone (6 per single-symbol read — `redisBandwidth.ts:209–218` via
`historyCache.ts:1152`), before any FMP fetch a cold history cache would trigger.

- **Warm cache:** the lock loser returns cached data. The 1-hour
  `PLAYS_REDIS_TTL_SECONDS` outlives the 30-minute `revalidate`, so this is the
  normal case.
- **Cold cache:** every concurrent request runs its own full build. N simultaneous
  requests cost N × 4,200 writes, not 4,200.

## Correction, same day: the ISR window was never the bound

An earlier revision of this document said the exposure was bounded at 48
regenerations/day/page by `revalidate = 1800`. **It is not bounded by that at
all.** All three pages call the builder with `cacheOnly: true`
(`app/plays/page.tsx:55` and siblings), which returns 503 on a miss and **never
builds**. So an ISR regeneration cannot reach the lock, the build, or the wait.

The builds happen in `app/api/plays/route.ts` and its two siblings — all
`force-dynamic`, all fetched by the page on mount. There is **no ISR window
limiting them**: every visitor's mount-time fetch against a cold cache is a
candidate builder. The `force=1` path has been gated behind
`EARNINGS_BACKFILL_KEY` plus a per-IP lockout since 2026-07-20, so the
*deliberate* expensive path is closed; the *accidental* one, N concurrent
ordinary requests on a cold cache, was not.

This is the third unit this same quantity has been attached to in one day — per
pickers build, then per ISR regeneration, now per API request — which makes the
document recording that error an instance of it. See
`claude/traps/a-derived-quantity-attached-to-the-wrong-event.md`, and read its
rule as applying to this file too: **name the event and check it, every time the
number is reused.**

The cold-cache window is reachable: a deploy empties the in-memory memo, and a key
version bump, an eviction, or a lapsed TTL empties Redis. A deploy plus a traffic
burst is sufficient — which is the combination that took the site down in August.

**The ISR ceiling is only a ceiling while the lock holds.** Any cost figure
derived from 48 regenerations/day (e.g. the ~$36/month instrumentation ceiling)
assumes a cache miss produces one rebuild, and that assumption is currently false.

## Priority

Ahead of the instrumentation cost itself. Reducing the per-regeneration write cost
lowers the multiplier; porting the wait bounds the multiplicand. The second is
what failed in August.

Two fixes, and they are independent:

1. **Port `waitForPickersPayload`'s shape to all three builders.** The precedent,
   budget and fall-through policy are already written in `pickersBuilder.ts:1175–1220`.
2. **Accumulate the meter in process and flush once per handler** rather than per
   read, which cuts ~4,200 writes per regeneration to ~6.

Neither has been applied. This document records the finding only.

## Why it went unnoticed for twelve days

Recorded separately as
`claude/traps/a-defect-found-in-one-file-lives-in-its-siblings.md`: #377/#378
diagnosed the mechanism correctly and fixed the file the bug was found in, and
nothing searched for the same shape in three near-identical siblings. All three
take an NX lock, so a review scanning for "is there a lock" finds one in every
file; the lock was never the missing piece. One `grep` for `waitFor` across
`lib/server/*Builder.ts` is the whole check.
