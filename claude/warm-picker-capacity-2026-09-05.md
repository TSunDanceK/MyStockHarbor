# The fourth abandon-on-capacity — and it did not look like the other three

## The brief's description was wrong in a way worth recording

> `warm-picker-universe` still carries `if (!hasFmpCapacity(...)) break;`

**It does not. There is no `break` on that path**, and looking for one is why
three previous fixes did not find it. The defect is the same; the spelling is
not.

`reserveFmpCallSlot()` waits up to `FMP_MAX_WAIT_MS` — a flat **20 seconds** —
and then *throws* `capacity-timeout`. The forced-refetch loop in
`getDailyHistoryBulk` catches that per symbol and falls back to the cached entry.
So the thing deciding to give up is a per-call constant with no relationship to
how much time the run has:

```
2026-09-04 07:02  warm-picker-universe, maxDuration 300s
  [pickers] build complete: universe 700, 700 records, 0 failed, 142414ms
  40 forced refetches threw and fell back. Reasons: capacity-timeout:40
```

**A run that finished in 142 seconds abandoned 40 symbols after 20 seconds each,
with ~158 seconds of its own function budget unused.** Identical reasoning to
#396, #406 and #416: an exhausted minute is a *pause*, and only the run's own
clock should end the work.

## Which fix was ported, and why that one

**#416 (stock data).** All three are the same
`waitFor…Budget(deadlineMs) → "ok" | "out-of-time"` contract, but #416's loop is
the one this loop resembles: *for each symbol in a bounded set, wait for room,
then do the work*. #396 sits inside a tiered refresh with per-tier accounting;
#406 inside a batched fetch whose batch size is itself derived from the budget.
Copying either would have imported machinery this loop has no use for — and a
fourth slightly different answer to "wait for budget" is exactly what these four
PRs exist to stop.

**The wait is before dispatch, not inside `reserveFmpCallSlot`.** Lowering the
deadline into the reservation would mean threading it through
`getDailyHistoryBulk → getDailyHistory → getDailyHistoryInner →
requestHistoryRows` — four signatures changed to teach the innermost one about a
caller's clock. Waiting first leaves the 20 seconds exactly as it is, as the
backstop it already was, and it rarely fires now because a task is only
dispatched once there is room.

## The budget, and the coupling it has to respect

`HISTORY_RUN_BUDGET_MS = 240_000` against `maxDuration = 300`.

**The failure mode this change could introduce is a wait that outlives its own
function** — the platform kills it and *nothing* is recorded: no run record, no
counters, no reason. That is strictly worse than abandoning, which at least
reports what it gave up on. `check-capacity-waits.mjs` asserts the coupling with
both numbers read from source, and it fails if either moves toward the other.

The 60-second tail covers what the build does after history: the indicator pass
over 700 symbols, the payload write, the chart-hash write and 36
`revalidatePath` calls. The observed run did *everything* in 142s.

And the budget is what makes full coverage possible at all:

```
240s x (200 safe - 40 headroom)/min  =  640 fetches available
analysed universe                    =  700 symbols
```

A flat 20-second per-call ceiling could not reach that; 640 < 700, so it still
does not promise to — which is what the new counters are for.

**Headroom is 40, the smallest of the five modules** (fundamentals 60, price pool
60, stock data 90, earnings 90). The forced refetch runs at 07:02 UTC: outside
the market window, so warm-price-pool is returning `market-closed` and spending
nothing, and ahead of warm-earnings at 07:15. Reserving 90 would idle a third of
the budget against jobs that are not running.

## What it recovers — stated as a prediction, not a result

The brief asks for before/after on capacity-timeouts and the 429 rate. **I can
state the before and the mechanism; the after is the owner's to observe**, and
saying otherwise would be inventing a measurement.

| | before (2026-09-04 07:02) | expected |
|---|---|---|
| `capacity-timeout` | **40** | ~0 — a task now waits on the run's clock, and the 20s backstop only fires for a symbol with no cached entry |
| `forcedRefetchFailures` | 40, all capacity | whatever is left is *real* (http-429, network, parse) |
| run duration | 142s | **longer** — 700 fetches at 160/min usable is ~4.4 minutes of work that was previously being truncated |
| symbols refetched | 660 of 700 | up to 700, bounded by the 640-fetch budget |

**Waiting makes the run longer, and that is the trade, not a side effect.** The
142-second run was fast *because* it gave up. If the 429 rate does not fall, that
is the signal that waiting moved contention rather than removing it — which is
why `historyRanOutOfTime` and `historyDeferredOutOfTime` are on the run record
separately from `forcedRefetchFailures`. Folded together they read identically,
and they want opposite responses: a per-call timeout is a defect, a run that
spent its 240 seconds is the policy working.

## The scan found a fifth site the brief did not know about

Deriving the job list by scanning `app/api/jobs/` and following the `lib/server`
modules those routes import (21 files) turned up
**`pricePool.ts:fetchMoverBuckets`** carrying the negated shape.

It is a **genuine exception** and it is exempted by name with its reason rather
than regexed away: three calls total regardless of universe size, a best-effort
enrichment of the tier-1 signal, in a job that runs every five minutes. "Remaining
work" there is at most two optional calls the next run retries in five minutes.
Waiting a run budget for them would push `warmPricePool` past its own cron tick.

The exemption is keyed by **enclosing function, not line number** — an exemption
keyed by line silently transfers to whatever code arrives at that line next — and
a separate assertion fails if it ever stops matching anything, so it cannot
outlive its reason.

## The detector was wrong first, and the way it was wrong is the point

The first draft matched `if (!(await hasFmpCapacity(...))) break|return` — the
give-up keyword *adjacent* to the test. Calibration killed it: rewriting the site
to set a flag and `return` three lines later walked straight past the regex, and
the check stayed green while the defect was back in the file.

**The rule is now the negated test itself.** Every legitimate use in this
codebase is *positive* and sits inside a `waitFor…Budget` loop —
`if (await hasFmpCapacity(n, headroom)) return "ok"` — because the question there
is "may I proceed", asked repeatedly. Asking "am I out of room" and branching on
yes is the abandon, whatever the branch then does.

Four fixtures, two that must fire and two that must not, run rather than assumed.
