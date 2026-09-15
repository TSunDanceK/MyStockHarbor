# The manifest has no population path, and one backfill will not give it one

**Date:** 2026-09-14
**Status:** OPEN. Precondition for step 3 and for the standing-66 clear.
**Related:** `claude/sec-manifest-misses-preset-universe-2026-09-14.md`,
`claude/standing-needsreverify-66-2026-09-14.md`

## 1. The cron has never fired

Verified against the tree rather than taken on trust:

```
$ git show a17c1a6:vercel.json | grep -c sec-daily-index
0
$ git show origin/main:vercel.json | grep -A2 sec-daily-index
      "path": "/api/jobs/sec-daily-index",
      "schedule": "0 4 * * *"
```

`a17c1a6` is the base of #454. **The cron entry arrived with that merge.** First
firing is 04:00 UTC / 05:00 BST on 2026-09-15, walking `master.20260914.idx`.

Every run to date was **manual, from a browser against the preview, writing to
production Redis** — Preview and Production share the Upstash credentials. That
is why the watermark carried between runs, and why `from`/`to` was made
inspection-only after one of them rewound production.

**Consequence for the sweep:** tomorrow's is the first automated write. The
standing-66 count is measured off *that*, not off any reading taken so far.

## 1a. It ran — and it inherited the universe defect

**04:00:16 UTC 2026-09-15, HTTP 200, branch `main`,
`dpl_B6UF7eCd8tcqMDefpVvQ997vnTQw`.** First automated run.

**It logged nothing.** Every other warm job prints a summary — the same window
carries `[warm-stock-data] {"ok":true,"universe":759,"refreshed":40,…}` — while
`sec-daily-index` emitted zero lines. Its summary went to `recordJobRun` (behind
`CACHE_HEALTH_KEY`) and to a response body the cron caller discards, so **there
is no way to tell what the first real run did.**

A daily job returning 200 while doing nothing is indistinguishable from one
working. That is the failure this pipeline is built against, and it was
unobservable on its own first run. Fixed: the summary now goes to the platform
log in the house format, and the two refusal paths log as well — a silent 503
looks like the job never fired. Asserted in §17d of
`scripts/check-sec-daily-index.mjs`.

Expected values for that run, from the watermark: `datesConsidered 1`,
`parsed 1`, date `20260914` (a Monday), `redisCommands 3`, `watermarkMoved true`,
watermark → `20260914`. **Unverified** — the run predates the logging.

**And it ran with the pre-#455 universe.** `warm-stock-data` in the same window
reads `universe 696`, so #455 was still unmerged and the run seeded from the
dynamic pool alone. **JPM, C, AAPL, NVDA and the rest of the preset block still
have no manifest entry.** Expected rather than new, but recorded here rather than
assumed away: the first cron inherited the defect. **The first run to cover the
presets is the one after #455 merges**, not this one.

## 2. The real gap: nothing fills `contentHash`

`seedManifest` creates an entry with `needsReverify: false` and
`contentHash: null`. **Only a filing event fills it.** So:

- A symbol admitted to the dynamic universe in September that does not file
  until November carries an **empty picker row for two months**.
- Nothing reports it. No counter, no warning — the identical silent shape as the
  `PRESET_UNIVERSE` defect, and as the "absent symbol never matches the index"
  defect before it. This is the third instance of the same failure mode in this
  pipeline.
- **630 of 696 entries have never been queued at all.**

### A one-off backfill does not close this

`readDynamicUniverse` ages entries out after 14 days (`ENTRY_MAX_AGE_MS`) and
re-ranks by score, and `pruneUniverse` trims to
`MAX_DYNAMIC_UNIVERSE_SIZE`. **Admissions are continuous.** A script run once
fills the entries that exist the day it runs and leaves every later admission in
exactly the state it was written to fix. The gap reopens the next time the pool
reorders.

So what step 3 needs is a **standing mechanism** that keeps finding
`contentHash === null` universe symbols, not a backfill with an end.

### Not the same budget as the re-read

`SEC_REREAD_DRAIN_PER_RUN` (150/run) governs symbols with a *filing event*.
`SEC_COLD_FETCH_DRAIN_PER_RUN` (25/run) governs *off-universe, on-request*
fetches — build brief §4's cold path. Neither covers "in the universe, never
fetched". That population path needs its own allowance, sized against the same
parse measurements, and separated for the same reason the other two are: an
unbounded source must not be able to starve a bounded one.

## 3. Why this blocks the standing-66 clear

The clear-not-drain decision rests on a stated precondition:

> Step 3 must have an initial-population path that fetches every universe symbol
> whose `contentHash` is `null`, independent of `needsReverify`. It must have one
> regardless of this decision: **630 of the 696 have never been queued either.**

That precondition is now this document. Until the standing path exists, clearing
the 66 moves them from one unserved state to another — still correct, still not
a loss, but not yet the routing-to-the-right-path the decision claims.

## 4. Order

1. First automated cron run (2026-09-15 04:00 UTC) — measure the sweep count.
2. Step 3, including the standing population path above.
3. The standing-66 sweep, its count re-measured.
4. `listing-venue-diff` dispatch.
5. Step 8 / the cold path — see
   `claude/cold-path-and-coverage-decisions-2026-09-14.md`.
