# Earnings-season concentration: still UNMEASURED, and how to measure it (2026-09-02)

## The number everything rests on, and its status

> "~70% of companies report within ~20 trading days."

**That is an estimate. It has never been measured.** It is the input to
`EARNINGS_BATCH_SIZE`, and therefore to whether the growth wall sits at 1,500
symbols or 2,000.

This project's estimates have a record worth stating before leaning on another
one:

| Estimated | Measured | Out by |
|---|---|---|
| $5.7B screener floor | $9.66B (`observedFloor`) | 1.7x |
| 23% of bandwidth price-derived | 75% | 3.3x |
| The universe cap was the binding limit | The **minute guard** was | wrong mechanism entirely |

Two of those three were wrong by more than the margin any batch-size decision
has. So: **do not size the constant on the estimate.**

## Why this document does not contain the answer

The measurement cannot be taken from a Claude Code session. Re-verified
2026-09-02, not assumed:

* `curl https://financialmodelingprep.com/...` → `curl: (56) CONNECT tunnel
  failed, response 403`. The sandbox's egress allowlist does not include FMP.
* No `FMP_API_KEY` and no `UPSTASH_REDIS_REST_URL` / `_TOKEN` in the
  environment, so neither the live calendar nor the cached one is readable.
* `vercel.com` is blocked too — which is separately why `maxDuration` had to be
  declared rather than looked up (PR B).

An honest UNKNOWN is worth more than a plausible number, so this file records
the unknown and ships the instrument.

## The instrument

`GET /api/debug/earnings-concentration` — the same shape as
`/api/debug/symbol-changes` from #405: `EARNINGS_BACKFILL_KEY`-gated, IP
lockout, `maxDuration` 60, changes nothing.

```
https://www.mystockharbor.com/api/debug/earnings-concentration?key=<EARNINGS_BACKFILL_KEY>
https://www.mystockharbor.com/api/debug/earnings-concentration?key=...&months=2026-07,2026-08
```

**Cost: at most one FMP call per month asked for, and zero for a month already
cached.** `fetchMonthRows` reads
`msh:reference:v1:earnings-calendar:<YYYY-MM>` (daily TTL, from #393) before it
reaches FMP. Capped at three months.

### The window matters more than anything else here

**The obvious window is the wrong one.** Probe Q6 measured 29 Aug → 2 Oct.
That falls *between* reporting seasons and will understate the peak badly. The
default is **2026-01, 2026-02**; mid-July to mid-August is the other real
season. A measurement taken in September answers a question nobody asked.

### What comes back

Two distributions, because they may not agree:

* **`all`** — every symbol FMP lists a date for (~10k names, most of them
  micro-caps this site never warms).
* **`preset`** — `PRESET_UNIVERSE`, ~100 mega-caps. Large caps cluster in the
  middle weeks of a season rather than spreading like the tail does, so if the
  two shares differ materially, **`preset` is the one to size against**.

Each carries the whole day curve (busiest first, not a summary),
`shareInBusiest10Days`, `shareInBusiest20Days`, and
`impliedPeakDayRefreshes` at 1,500 and 3,000.

`shareInBusiest20Days` is the number the "~70%" estimate was guessing at.

### Reading it honestly

`ok: false` with a populated `emptyMonths` means **unmeasured, not flat**.
`fetchMonthRows` returns `[]` for a plan restriction, a network failure and a
genuinely empty month alike — and a 402 is the likely answer for half this
plan's endpoints. A distribution built on no rows is perfectly smooth and means
nothing, which is why the shares come back `null` rather than `0`.

`scripts/check-earnings-concentration.mjs` asserts both of those by running the
aggregation, along with the two arithmetic traps: counting rows instead of
distinct symbol-days (the calendar repeats a ticker across rows, and counting
rows overstates the peak), and sizing on the mean day instead of the peak.

## What to do with the answer

`impliedPeakDayRefreshes` is the count of symbols in a universe of that size
reporting on the single busiest day. It is a **floor** for the batch, not the
batch. Three things sit on top of it:

1. **The post-report re-fetch.** `computeEarningsTtlSeconds` gives a symbol a
   short ~12h window right around its report so the actuals and the rolled-
   forward next date land. Budget roughly 2 calls per reporting symbol, not 1.
2. **The cadence — SETTLED 2026-09-03: it is ONE pass a day.** `vercel.json`
   runs `warm-earnings` once (`15 7 * * *`) and that is now the only automatic
   caller. This entry previously read "confirm this before sizing"; it has been
   confirmed, twice over:

   * The two extra passes came from `.github/workflows/pickers-warm.yml`, which
     was calling unauthenticated and getting **401** on both (#408 fixed the
     authentication; the run log quoted there is the evidence).
   * Its GitHub schedule was then removed entirely, because it had **never once
     fired within half an hour of its cron** across 29 recorded runs and had
     drifted to +4 to +12 hours before missing a day outright. The workflow is
     a manual lever now.

   So the measurement is read against **one run a day**, and the batch has to
   cover a day in a single pass. The extra passes are not coming back: a run's
   reach (point 3) is 440 calls against three passes' 120, so the batch is the
   lever, not the pass count.
3. **The run's own reach.** After PR B a single run can make
   `(FMP_SAFE_CALLS_PER_MINUTE 200 − EARNINGS_MIN_HEADROOM_CALLS 90) × 4 min =
   440` calls. `scripts/check-earnings-minute-wall.mjs` fails if
   `EARNINGS_BATCH_SIZE` is raised past that. If the measurement implies a batch
   above 440, the answer is **not** to raise the ceiling blindly — it is either
   more runs per day or a smaller headroom, and both are decisions with their
   own evidence.

## What is NOT to be done from this document

Do not change `EARNINGS_BATCH_SIZE` before the route has been called against a
real season. That is the entire point of the file.
