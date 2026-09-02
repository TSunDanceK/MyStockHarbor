# Upstash suspended the database (2026-08-27/28)

> **Provenance.** This is the repo mirror. The original lives in the Claude
> Project "My Stock Harbor Website", which a Claude Code session cannot read —
> so this file was **reconstructed from the code and the dated docs that cite
> it** rather than copied. If the Project copy differs, the Project copy is the
> original and should replace this file wholesale. Every figure below is
> attributed to the in-repo source it came from.
>
> Mirrored 2026-09-02 to close the dangling citation from
> `lib/server/warmTargets.ts` (`scripts/check-doc-citations.mjs`).

## What happened

The Upstash Redis database was **suspended for exceeding its read-bandwidth
allowance**. `lib/server/warmTargets.ts` dates the suspension to **2026-08-28**;
`claude/fmp-bandwidth-97pct-2026-08-30.md` refers to it as "the Upstash
suspension of 27-28 Aug" and to the period after it as a "recovery storm". The
site's data layer is Redis-first, so a suspended database is a site-wide
outage, not a degradation.

**User traffic was nowhere near large enough to explain it.** That is the whole
finding.

## The cause: 8 MB read to obtain 3 KB, 648 times a day

`getWarmTargetSymbols()` is the single source of truth for "which symbols do
the background warm jobs maintain data for". It derived that list by calling
`getPickersData()` — which reads **the whole pickers payload, ~8 MB, out of
Redis** — and using it for exactly one thing: `.map(r => r.symbol)`, a list of
~450 tickers, about **3 KB**. Everything else crossed the network and was
discarded.

Three crons called it. Measured 2026-08-28, on a day when production served
~250 user requests in three hours:

| Job | Cron **as live on the measurement day** | Runs/day | Redis read |
|---|---|---|---|
| `warm-price-pool` | `*/3` | 480 | ~3.8 GB/day |
| `warm-stock-data` | `*/10` | 144 | ~1.1 GB/day |
| `warm-fundamentals` | `0 *` | 24 | ~0.2 GB/day |
| | | **648** | **~5 GB/day** |

**~150 GB a month of Redis read bandwidth to look up a few kilobytes of ticker
symbols.**

Those cron strings are the ones that were live on the day of the measurement
and are deliberately not updated anywhere — #374 has since staggered all of
them off minute `:00`. For what runs today, read the `JOBS` registry in
`lib/server/jobRuns.ts`, which is asserted against `vercel.json`.

## The fix

The union is now computed **at most once per `WARM_TARGETS_TTL_SECONDS`** (30
minutes) and parked in its own small key. Simulated against the real cron
schedule, the expensive read happens **45 times a day instead of 648** — ~5.06
GB/day down to ~0.35 GB/day, a **93% cut** — and every other call is a few-KB
GET.

What it does **not** change: cadence, coverage, or which symbols get warmed.
Only the to-do-list lookup got cheaper.

On the TTL: 30 minutes is a **staleness budget, not a performance knob**. It
bounds how long a symbol newly admitted to the displayed set can wait before
the warm jobs know about it — comfortably inside what the consumers already
tolerate (warm-stock-data takes ~3h for a full lap, warm-fundamentals is
hourly). Shortening it costs bandwidth linearly and buys nothing those jobs can
use.

## The second meter, and why the outage is not the excuse

`claude/fmp-bandwidth-97pct-2026-08-30.md` is the companion analysis: same root
cause shape, different bill. Two things from it belong here:

* The recovery after the suspension **spiked FMP**: `historical-price-eod/full`
  over Aug 27–29 ran at **16% success** against a 30-day average of 30%, and
  219k calls in the last 7 days against 44k in the prior 23.
* It is nonetheless **not an outage artifact**. Subtracting the outage window,
  the 23 quiet days *before* it already ran 1,914 successful history calls/day
  — 2.5 full-universe passes/day, ~343 MB/day, ~10.1 GB/30d, at 99% success.
  The spend was structural before the outage and the outage only made it
  visible.

## The general lesson

Both meters were consumed by **background jobs reading large market-wide
objects to obtain small facts**, on a cadence nobody was watching, while user
traffic stayed flat. The corrective pattern that came out of it, and that the
later PRs generalise:

1. **Read what you need, not the object that contains it.** A list of symbols
   is 3 KB; the payload it lives in is 8 MB.
2. **Cache the derivation, not just the source.** The union is cheap; fetching
   its input was not.
3. **Cost is a function of cadence × payload, and cadence is in a cron file
   nobody reads on a normal day.** `jobRuns.ts` is the registry, and it is
   asserted against `vercel.json` so the two cannot drift.
4. **A dated measurement stays as it was measured.** Rewriting the cron strings
   above to today's would falsify a dated observation to make it look current.
