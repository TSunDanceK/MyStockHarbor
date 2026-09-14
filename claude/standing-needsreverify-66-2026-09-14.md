# The standing 66 — decision, and why it must not be swept yet

**Date:** 2026-09-14
**Branch:** `build/sec-fundamentals-2026-09-13`
**Status:** DECIDED (clear, not drain). **Execution is sequenced — see §4.**

## 1. The observation

66 manifest entries carry:

```
needsReverify: true      reverifyReason: null      enqueuedAt: null
```

Provenance is unknown. The first hypothesis — `reconcileCiks` — is **withdrawn**,
and correctly: `mapChangeThreshold(696)` is 7, so 66 CIK changes in one run would
have been *refused* with `suspectedMapShapeChange: true`, not applied. And
`seedManifest` builds entries through `emptyEntry`, which sets
`needsReverify: false`.

The likeliest remaining explanation is residue written by an earlier code version
during the 12–13 Sept build. That is an inference and is recorded as one.

**The `ceil(700 * EARNINGS_PEAK_DAY_SHARE) = 66` resemblance is a coincidence.**
No code path marks that many symbols. Noted only so nobody spends an afternoon on
it.

## 2. Why the shape is now diagnostic, and permanently so

As of `3f5332a`, **every** writer of `needsReverify = true` also writes both
`reverifyReason` and `enqueuedAt`. There are exactly four, and this is a derived
fact, not a claim — `grep -n "needsReverify = " lib/server/secManifest.ts
app/api/jobs/sec-daily-index/route.ts` returns four call sites:

| writer | reason set | timestamp set |
|---|---|---|
| `applyFilings` — amendment path | `"amendment"` | `??= Date.now()` |
| `applyFilings` — 8-K re-read-only path | `"unconfirmed"` | `??= Date.now()` |
| `applyFilings` — periodic path | `"periodic-report"` / `"unconfirmed"` | `??= Date.now()` |
| `reconcileCiks` — invalidation loop | `"cik-change"` | `= Date.now()` |

So `needsReverify && !reverifyReason && !enqueuedAt` **cannot be produced by
current code**. The 66 are a closed set that can only shrink, and any entry
matching that predicate later is by construction the same residue. This is what
makes a sweep safe: the predicate has no false-positive population.

## 3. The decision: CLEAR them, do not drain them

**Clear** — set `needsReverify = false`, leaving every other field untouched.

The reasoning is not "they are probably junk". It is that **at step 3's start the
manifest holds no fact set for any symbol at all.** Steps 1 and 2 make zero
`companyfacts` calls by design, so `contentHash` is `null` for all 696. "Needs
re-verify" is therefore trivially true of the entire universe, and the flag is
not distinguishing *stale* from *never fetched* — nothing has ever been fetched.

Given that, the 66 are not a work queue. They are 66 arbitrary symbols holding a
priority claim they cannot justify, and the effect of leaving them is precisely
backwards: with `reverifyReason: null` they fall back to `"unconfirmed"` and rank
last *within* the queue, yet still sit ahead of the 630 symbols that are not
queued at all. An arbitrary sixth of the universe would jump the cold-fetch
ordering for no recorded reason.

**Clearing does not discard work — but that rests on a precondition, stated
here rather than assumed.** Step 3 must have an initial-population path that
fetches every universe symbol whose `contentHash` is `null`, independent of
`needsReverify`. It must have one regardless of this decision: **630 of the 696
have never been queued either**, so if the re-read queue were the only way into
a fact set, nine tenths of the universe would never be fetched at all and the
page would be empty. The 66 are not a special case of that problem; they are
indistinguishable from the other 630 in every field that describes data, and
differ only in a flag whose provenance nobody can name.

(Note for whoever builds it: `SEC_COLD_FETCH_DRAIN_PER_RUN` is **not** that
path. It is the *off-universe*, fetched-on-request budget from build brief §4,
deliberately separate so a cold burst cannot starve the universe refresh. The
cold-start fill of the universe itself is step 3's own, and does not exist yet.)

So the sweep is conditional on that path existing when it lands — step 4 below
puts it after step 3 is designed and before its drain ships, which is exactly
when that can be checked rather than hoped for. If step 3 arrives *without* such
a path, the finding is that the design is wrong for 630 symbols, and the 66 are
the least of it.

Draining them instead would cost the same 66 fetches, produce the same data, and
additionally bake an unexplained priority into the first run of step 3 — the
single run where ordering is most visible and least understood.

**The sweep predicate, all four conjuncts required:**

```
needsReverify === true && !reverifyReason && !enqueuedAt && contentHash === null
```

The `contentHash === null` conjunct is not redundant even though it is true of
everything today. It is what keeps the sweep correct if it is ever re-run after
step 3 has populated fact sets: an entry that somehow held real facts *and* this
flag shape would be left queued rather than silently de-prioritised. Each cleared
symbol is logged by name — this is a one-time repair of state an earlier build
wrote, and a repair nobody can see afterwards is indistinguishable from a bug.

## 4. SEQUENCING — the sweep must NOT land before the replay

**The sweep changes `rereadQueued`, and `rereadQueued` is the acceptance reading
for the 4/A gate.**

The owner-run inspection-only replay of the measured window accepts on:

```
~193  (66 standing + 127)  -> the gate took, merge
~232  (66 standing + 166)  -> the gate did not take, stop
```

Both arms are built on the standing 66 still being present, because
`rereadQueued` counts the whole manifest rather than the window. Sweeping first
would move both numbers by 66 and destroy a test that has no other witness —
this morning's plain run walked two weekend dates, parsed nothing, and never
called `applyFilings`, so **no runtime reading of the gate exists yet.**

Order of operations, not negotiable:

1. Owner runs the inspection-only replay. Read `rereadQueued`.
2. Gate confirmed → merge step 2.
3. **Then** the sweep lands, as its own change, with the before/after count
   reported and the cleared symbols listed — and with step 3's cold-start
   population path confirmed present first, per §3.
4. Then step 3's drain ships, to a manifest whose every queued entry carries a
   reason and a timestamp.

The sweep is deliberately **not implemented on this branch.** Writing it now and
leaving it dormant would be one accidental call away from invalidating the
replay, and a flag guarding it would be one query parameter away from the same.

## 5. What this closes

The owner's requirement was: decide explicitly whether the 66 are cleared or
drained, record the decision, and **do not let the drain be the thing that
discovers them.** Decided: cleared. Recorded: here. The drain will not discover
them, because step 4 above puts the sweep in front of it — and if the sweep is
somehow skipped, §2's predicate means they are still identifiable by shape rather
than being lost in the queue.
