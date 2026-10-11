# The SEC manifest omits PRESET_UNIVERSE, so JPM and C are not covered

**Date:** 2026-09-14
**Status:** FIXED. The manifest is seeded from `PRESET_UNIVERSE ∪ readDynamicUniverse()`,
**uncapped** — see §4 for the decision and why neither side yields.
**Severity:** product. `/stock/JPM/earnings` can never be populated by the cron.
**Origin:** mine, in `app/api/jobs/sec-daily-index/route.ts` as shipped in #454.

## 1. The finding

`app/api/jobs/sec-daily-index/route.ts:268` seeds the manifest from the dynamic
pool **alone**:

```ts
const universe = (await readDynamicUniverse())
  .slice(0, ANALYSIS_UNIVERSE_CAP)
  .map((e) => e.symbol);
```

Every other consumer of the analysis universe unions that pool with
`PRESET_UNIVERSE` first. `lib/server/sectorUniverse.ts:90`:

```ts
new Set([...PRESET_UNIVERSE, ...dynamic].map(cleanSymbol).filter(Boolean))
```

and `pickersBuilder` does the same — its own comment reads "the universe falls
back to `readDynamicUniverse()` + `PRESET_UNIVERSE`".

`PRESET_UNIVERSE` is 100 symbols, described in its own header as "the ~100
largest US companies by market cap … mega-caps **guaranteed a slot**". It
contains JPM, C, BAC and GS. **The SEC job is the only consumer that drops that
guarantee**, and nothing anywhere records a reason: there is no mention of
`PRESET` in the route, in `secManifest.ts`, in the pipeline spec, or in the
build brief.

## 2. How it surfaced, and why nothing caught it

The window fixture (frozen dump universe, 700 symbols) matched **291** symbols
over 20260908-11; the live run (manifest universe, 696 symbols) matched **281**.
The deltas ran opposite ways — ten more symbols, four fewer queued — which is
only possible if neither set contains the other.

Decomposed against the live matched-symbol list: **JPM and C are absent from the
live 281, and they are 562 of the 567 extra rows** (369 + 193). The other ~10
fixture-only symbols carry five rows between them. MER-PK, GS and BMO are
present live with identical row counts (143 / 141 / 117) and were never part of
the gap — the structured-note hypothesis was right about the *shape* and wrong
about the *names*.

Three things this rules out:

- **Not a CIK resolution failure.** JPM and C are not in `symbolsWithoutCik`,
  which still reads BK, EA, EQR, WBS.
- **Not "they filed nothing".** The fixture proves both filed heavily in the
  window — JPM 369 rows, C 193.
- **Not a cap collision.** The manifest holds 696 against a cap of 700, so
  nothing was truncated to make room.

**Nothing raises an error, by construction.** `seedManifest` adds exactly what
it is given; a symbol that is never passed in has no entry, and a symbol with no
entry can never be matched by `intersect()` against the daily index. The cron
then runs green forever while that stock's earnings page stays empty. There is
no counter, no warning, and no check that asserts the preset names are present.

## 3. Why JPM and C specifically, when GS survived

`readDynamicUniverse` filters on `ENTRY_MAX_AGE_MS = 14 days`:

```ts
.filter((entry) => now - entry.lastSeen <= ENTRY_MAX_AGE_MS)
```

The pool is a rolling, score-ranked set: a symbol stays only while a builder
keeps surfacing it. GS happens to be in the pool on its own merits today; JPM
and C are not. **That is not a stable property** — which name is missing will
change week to week, so this is not a two-symbol problem with a two-symbol fix.
Any of the 100 preset names can be absent on any given day.

## 4. The decision: uncap the manifest. Neither side yields.

The obvious change was to union the preset list in and keep the cap:

```ts
[...PRESET_UNIVERSE, ...dynamic].slice(0, ANALYSIS_UNIVERSE_CAP)
```

**That is wrong**, and the reason is why this was reported rather than fixed
blind. The dynamic pool already returns 696 against a cap of 700, so unioning
100 preset names and then slicing would evict up to 96 dynamic symbols — trading
a silent gap for a silent eviction, and one that moves every time the pool
reorders.

The decision taken instead: **seed from the union with no slice at all.**

### Two different costs, which the cap conflates

`ANALYSIS_UNIVERSE_CAP` bounds what gets **analysed** — a history fetch and a
pass through the indicator stack per symbol, real upstream spend that scales
linearly. It is doing its job for the consumers that analyse and is **left
alone**.

The manifest bounds what gets **detected**, and detection is *one daily-index
request* whether it covers 700 filers or 10,000. The per-symbol cost that does
scale is the re-read, and that already has its own governor in
`SEC_REREAD_DRAIN_PER_RUN` — 150 a run against a measured peak inflow of 98 a
day. Applying the analysis cap here charged detection for a cost it does not
incur, and double-governed the one it does.

`claude/sec-pipeline-spec-2026-09-13.md` §7 already said so outright:

> **§1 already survives this.** The daily index is one request whether you track
> 700 filers or all ~10,000, so the correctness mechanism needs no change at all.

**The cap contradicted the spec this build follows** — which is the mechanism by
which it shipped. Nothing recorded a reason for it because there was no reason;
it was reached for by habit. The citation now sits at the seed call, and §17c
asserts it is still there.

### Size, stated rather than assumed

391 B/symbol, 266 KB at 696, ~305 KB with the presets unioned in, against
Upstash's 10 MB per-request ceiling. §17c asserts the worst case at 796 symbols
— measured at **461 KB, 4.5% of the ceiling** — so growth stays visible instead
of being asserted once and forgotten.

### The third input, established rather than assumed

`dynamicUniverseCache`'s header names **three** sources bounded by
`ANALYSIS_UNIVERSE_CAP`: `PRESET_UNIVERSE`, the dynamic pool, and the
popular-search promotions. The seed unions two — which is correct, because the
third flows through the second:

```ts
// pickersBuilder.ts:3311
await addToDynamicUniverse(popularSearchSymbols, "search", 1);
```

Promoted names are persisted into the shared pool, so `readDynamicUniverse()`
returns them. There is no separate list to union. §17c asserts that call still
exists, because the coverage depends on it.

**One residual, bounded and recorded rather than fixed silently.** A promoted
name "enters at zero and still has to earn a place by score like anything else",
and `pruneUniverse` trims the pool to `MAX_DYNAMIC_UNIVERSE_SIZE` by
`ZREMRANGEBYRANK` on the lowest scores. So a freshly-searched symbol (quota 30 a
build, threshold 3 distinct callers) can be pruned before this job reads the
pool. That is **rank competition, not structural omission** — unlike the preset
case, nothing promises it a slot — but spec §7a's "attention, not market cap"
argues those are exactly the symbols that deserve one. Open question, not a
silent decision either way.

### This repo already had this bug, one layer up

`pickersBuilder.ts:3314`:

> **NOT concat-then-slice.** That exact pattern is what sliced the mega-caps off
> (PRESET was appended after the big dynamic set, then the whole thing was cut
> to the cap, dropping AAPL/NVDA/… — only active movers like MU survived, which
> is why the biggest companies were missing from the All Stocks screener).

That is this defect, in the screener instead of the manifest. It is why
`pickersBuilder` fills explicit quotas, and it is the strongest argument against
the union-then-slice fix: not a hypothetical eviction, a repeat. §17c asserts
that warning is still present so it cannot be deleted while the pattern it warns
about is reachable.

### Supporting precedent for an unsliced union

`warm-earnings` already derives "the analysed cap UNIONED with this pool", and
the live warm-target universe is **759 against a 700 analysis cap**. An unsliced
union larger than the cap is established practice here, not a new idea.

The union is also **bounded, not unbounded**: `readDynamicUniverse`'s own
`ZRANGE` is `(0, MAX_DYNAMIC_UNIVERSE_SIZE - 1)`, so the pool read caps at 700
whatever the caller does. 796 is a genuine ceiling, not a snapshot.

### What did not change

`ANALYSIS_UNIVERSE_CAP` itself. Only the manifest was wrong to use it.

## 5. Bearing on the standing-66 sweep

The sweep's predicate is `needsReverify && enqueuedAt == null`, with
`assert count === 7` before clearing.

**That 7 was measured against a 696-symbol manifest, before the universe fix.**
It is now stale by construction: the next run seeds `PRESET_UNIVERSE ∪ dynamic`,
so JPM, C and any other preset name the pool had aged out get entries for the
first time. New entries arrive with `needsReverify: false` from `emptyEntry`, so
they should not add to the count — but that is a prediction, not a measurement,
and this is exactly the kind of prediction that has been wrong before in this
work.

**So: re-measure after the first post-fix run, and record the new figure here
before the sweep is written.** A count that moved because the universe grew must
not read as the sweep finding a surprise. Do not carry the literal 7 across the
universe change.

Unchanged and still verified: `reconcileDelistings` reads the **ticker map**,
not the universe, so a preset name absent from the dynamic pool was never at
risk of a false `delisted: true`.
