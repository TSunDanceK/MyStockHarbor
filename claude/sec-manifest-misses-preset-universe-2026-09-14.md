# The SEC manifest omits PRESET_UNIVERSE, so JPM and C are not covered

**Date:** 2026-09-14
**Status:** DIAGNOSED, NOT FIXED. The fix is not one line — see §4.
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

## 4. Why this is not a one-line fix, and is not being made blind

The obvious change is to union the preset list in, as the other consumers do:

```ts
[...PRESET_UNIVERSE, ...dynamic].slice(0, ANALYSIS_UNIVERSE_CAP)
```

That is wrong as written, and the reason matters. The dynamic pool already
returns 696 against a cap of 700. Unioning 100 preset names and then slicing to
700 would **evict up to 96 dynamic symbols** to make room — trading a silent
gap for a silent eviction, and one that moves every time the pool reorders.
`sectorUniverse` gets away with the same expression because it does not slice at
all; `pickersBuilder` has explicit slot logic (`fillSlots(PRESET_UNIVERSE,
PRESET_UNIVERSE.length)`) precisely to reserve those seats.

So the real questions, none of which should be answered by guessing:

1. **Is the cap the right bound here at all?** `ANALYSIS_UNIVERSE_CAP` bounds
   what gets *analysed* — a history fetch plus a pass through the indicator
   stack per symbol. The manifest is 417 KB at 696 symbols and costs three Redis
   commands a run regardless of size, so the constraint that set 700 does not
   obviously apply to it.
2. **If the cap stays, which side yields?** Reserving 100 seats for the presets
   means dropping the 100 lowest-scoring dynamic names, which is a deliberate
   product decision about coverage, not a refactor.
3. **Does `delisted` interact?** A preset name absent from the dynamic pool but
   present in the manifest from an earlier run would currently be seen as
   "absent from the ticker map"? No — `reconcileDelistings` reads the *ticker
   map*, not the universe, so it does not. Recorded because it was checked, not
   because it was obvious.

## 5. Bearing on the standing-66 sweep

The sweep's predicate is `needsReverify && enqueuedAt == null`, with
`assert count === 7` before clearing. **That count is measured against the
current 696-symbol manifest.** If the universe is corrected before the sweep
runs, entries appear or disappear and the assertion may legitimately read
something other than 7 — which would look like the sweep finding a surprise when
it is really the universe having changed underneath it.

Order accordingly: settle §4, then re-measure the count, then sweep. Do not
carry the literal 7 across a universe change.
