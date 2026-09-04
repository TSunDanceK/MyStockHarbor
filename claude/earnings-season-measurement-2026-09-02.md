# Earnings-season concentration: still UNMEASURED, and how to measure it (2026-09-02)

> ## BLOCKED 2026-09-04 — READ THIS BEFORE RAISING `ANALYSIS_UNIVERSE_CAP`
>
> The growth sequence below (700 → 1,500 → 3,000) is sequenced against the
> EARNINGS ceiling. **It is no longer the binding one.** Redis bandwidth is:
> ~207 GB/month against a 200 GB plan cap at today's 762 symbols, and every term
> scales linearly with the universe, so 1,500 projects to roughly twice the cap.
>
> That is a harder constraint than the one measured here: an earnings shortfall
> degrades coverage, an over-cap Redis bill is an invoice or a throttle.
>
> **Do not raise `ANALYSIS_UNIVERSE_CAP` on the strength of the earnings work
> alone.** `scripts/check-redis-bandwidth.mjs` fails the build if it rises above
> `REDIS_OVERAGE_MEASURED_AT_CAP` while the projection is over the plan limit.
> The measurement, the options and what it takes to clear 1,500:
> `claude/redis-bandwidth-2026-09-04.md`.
>
> Everything below about the earnings ceiling remains correct and still has to be
> satisfied — it is now the *second* gate, not the first.

## UPDATE 2026-09-04 (later) — measured clean, and EARNINGS_BATCH_SIZE is now DERIVED

The probe was re-run with `?fresh=1` after #411's slicing. **February came back
complete for the first time.**

```
2026-01   1,654 rows   1 fetch
2026-02   6,018 rows   3 fetches   cappedDays: []  truncated: false
                                   dateRange 2026-02-01 -> 2026-02-28
distinct symbols  7,559   (was 5,572)
busiest day       2026-02-26, 710 symbols   (unchanged)
share in the busiest 20 trading days   0.848
```

**The estimate this all started from was 0.70. Truncated data said 0.934. The
truth is 0.848.**

And the verdict moved **safer**, not riskier — the opposite of the caveat in the
previous brief. `impliedPeakDayRefreshes` is universe size × peak-day *share*,
and recovering ~2,000 symbols grew the denominator while the peak day itself did
not move. A fixed-size universe now takes a smaller slice of any given day.

### EARNINGS_BATCH_SIZE: 40 → 262, and not typed

`EARNINGS_BATCH_SIZE` was a typed **40**. It is now `planEarningsDay`'s answer
for the current universe caps. Typing the measured number would have been the
same failure this rebuild removed twice (`PRICE_TARGET_RUNS`; `priceCap` derived
from one tier while the universe sat on two): right today, silently wrong the
moment `ANALYSIS_UNIVERSE_CAP` moves, and wrong in the direction that quietly
does less work.

**The basis is the union of the two caps** — `ANALYSIS_UNIVERSE_CAP` +
`MAX_DYNAMIC_UNIVERSE_SIZE` = 1,400 — not the analysed cap alone and not the
observed 762. `getWarmTargetSymbols` hands the job the union of two separately
capped pools, which is why the live figure runs ~9% above the analysis cap, and
it is the same basis `check-price-tiers` uses for the pre-open buffer: worst-case
work inside one run.

| `ANALYSIS_UNIVERSE_CAP` | basis | peak-day reporters | calls on the peak run | % of the 440 ceiling | passes | batch |
|---|---|---|---|---|---|---|
| **700 (today)** | 1,400 | 131 | **262** | 60% | **1** | **262** |
| 1,500 | 2,200 | 206 | 412 | **94%** | 1 | 412 |
| 3,000 | 3,700 | 346 | 692 | 157% | **2** | 346 |

All three rows are computed by `scripts/check-earnings-batch.mjs`, not written
down. **3,000 needs two passes and multi-pass is not implemented** — that is the
next growth blocker, and the check fails the build rather than relying on anyone
remembering it.

**The 1,500 step is tight.** 94% of the ceiling, and the model counts only
near-report fetches — retries, the 10-day unknown-next-date bucket and the
quarterly base rotation are all real and none is counted. Read the 6% as less
than 6%.

### The measured share, and why it is a recorded constant

`EARNINGS_PEAK_DAY_SHARE = 0.0935`, in `lib/server/earningsPlan.ts`, carrying
`EARNINGS_PEAK_SHARE_MEASURED_AT`, `EARNINGS_PEAK_SHARE_SOURCE` (months, probe,
`requiresSlicing`) and `EARNINGS_PEAK_SHARE_WITNESSES` — the three
`impliedPeakDayRefreshes` figures the run printed (72 at 762, 141 at 1,500, 281
at 3,000). The check **re-derives all three from the share on every build**, so a
share edited without re-running the probe fails against its own provenance.

**Why not derive it at runtime from the cached calendar** (the better-sounding
option): the batch must be sized for the **peak**, and the peak is seasonal. A
job running in September would derive September's share — a fraction of
February's — and set a batch too small for eleven months of the year, in the one
direction that fails silently. Sizing for the peak at runtime means reading
February *from September*, which is outside the three-months-forward window the
calendar cache is built for. And a runtime value cannot fail a build, which is
the whole point of the coupling. Cost if done anyway: ~1.4 MB of Redis calendar
reads per run, one to three FMP calls for an out-of-window month, and a new
failure mode where an empty or 402'd month shrinks the batch.

**When to re-take it:** when the calendar's *shape* changes — a new
reporting-season pattern, exchanges added or dropped from FMP's feed, or the page
cap moving again. **Universe growth does not require a re-take**: the share is
per-symbol, which is the whole reason it is a share.

### The cost, on the record

* **Peak day:** up to **262 calls** in one run (the worst case the caps allow);
  the observed 762-symbol universe needs **144**. At ~13.7 KB per `earnings`
  call that is ~3.6 MB on a peak day against ~0.5 MB at the old 40 — negligible
  against a 20 GB/month cap.
* **Typical day:** the loop stops at symbols that are actually **due**, so
  outside earnings season it fetches far fewer than the cap regardless. Order of
  magnitude: ~15 of our universe's symbols report on a quiet day (×2 fetches)
  plus ~16/day of quarterly base rotation — **tens of calls, not hundreds.** The
  batch is a ceiling on a busy day, not a workload on a quiet one.
* **Backlog:** coverage was last seen at 80/327 — 247 symbols missing — running
  at 40/day against a job whose extra passes were 401ing until #408. At 262 that
  clears in **about a day** instead of six. Counting the dynamic-universe
  symbols with no cached earnings at all (up to ~700), roughly **three days**
  instead of seventeen.

---

## UPDATE 2026-09-04 — the limit is IGNORED, and the cap eats the oldest dates

`/api/debug/earnings-calendar-limit` ran against 2026-02:

```
verdict: "limit-ignored: every limit returned the same rows"

limit=0      4000 rows  821,701 bytes  dateRange 2026-02-11 -> 2026-02-28
limit=4000   4000 rows  821,701 bytes  identical: true
limit=10000  4000 rows  821,701 bytes  identical: true
limit=20000  4000 rows  821,701 bytes  identical: true
```

`EARNINGS_CALENDAR_LIMIT`, added in #410, does nothing. It is **removed**: a
request parameter that is provably ignored, with an assertion saying we send it,
is a claim the code makes and cannot keep. What replaces it is
`EARNINGS_CALENDAR_PAGE_CAP = 4000` — FMP's number, named for what it is.

**And the cap drops the OLDEST dates.** We asked for 2026-02-01 → 2026-02-28 and
got 2026-02-11 → 2026-02-28. Ten days of peak Q4 season were absent from a 200
that looked complete, and the earlier concentration run agrees: its earliest
February date is 2026-02-11.

### It is a production bug, not only a measurement one

`fetchMonthRows` feeds the `/earnings-calendar` pages **and** the earnings
schedule index (#400) that decides when a symbol's income statement, cash flow
and dividends refresh. A symbol reporting inside a dropped window is invisible
to that trigger: it does not refresh on filing, it waits for
`QUARTERLY_FLOOR_DAYS` (120). That is the precise freeze the floor exists to
bound, arriving through a door nobody checked.

**Dormant until January.** January returned 1,655 rows uncapped and Sep–Dec are
quiet, so nothing between now and the new year breaches the cap. It would have
surfaced in February as *"some companies just stopped refreshing"*, with nothing
pointing at the fetch layer.

### The fix: adaptive slicing

Fetch a range; if the response comes back at the cap, split it and fetch the
halves; recurse until nothing is capped; merge. **Detection drives the split**,
so a changed cap or a heavier season self-corrects — a fixed "two halves per
month" would fail exactly the way the unsliced code did, silently.

| | fetches | transferred | stored |
|---|---|---|---|
| today, a capped February | 1 | 0.82 MB | 4,000 rows — **missing ten days** |
| sliced, a 7,000-row February | **3** | ~2.26 MB | ~7,000 rows, ~1.44 MB |
| any month under the cap | 1 | as now | as now |

205 bytes/row measured (821,701 ÷ 4,000). The 3 is not an estimate — the
invariant check runs the splitter over a fixture that caps at 4,000 by dropping
the oldest, and it recovers all 7,000 rows in three fetches. Once a day, behind
the daily reference TTL.

Each slice now goes through **`reserveFmpCallSlot`**, which it never did:
`fmpFetch` records bytes for the usage meter but reserves no slot, so the
calendar has been spending the plan's rate limit invisibly — and the warm jobs
compute their backoff from that counter.

### The verdict below is on TRUNCATED data and must be re-derived

Re-run `/api/debug/earnings-concentration?fresh=1` — without `fresh=1` the 24h
reference cache serves the truncated month and the fix reads as a failure.

**Expect the numbers to move.** Early February is prime Q4 season, so the ten
missing days may hold some of the busiest; `busiestDay: 2026-02-26, 710 symbols`
may not be the true peak. The pass count follows directly, and 1,500 was already
at 87% of the ceiling — a true peak only **1.15×** the truncated one puts it into
two passes. **The table below is kept as the record of what the truncated data
said, not carried forward as an answer.**

---

## UPDATE 2026-09-03 — it was run, and the answer is a FLOOR

The probe ran against 2026-01 and 2026-02 and killed the estimate:

| | estimate | measured (floor) |
|---|---|---|
| share reporting in the busiest 20 trading days | 0.70 | **0.934** |
| share in the busiest 10 | — | **0.710** |
| busiest day | — | 2026-02-26, **710 symbols** |
| implied peak-day refreshes at 1,500 / 3,000 | — | 190 / 380 |

Concentration is far tighter than the plan assumed: **71% report inside ten
trading days.**

### And then the month totals gave it away

```
2026-01   1,655 rows
2026-02   4,000 rows      <- exactly 4,000
```

`lib/server/earningsCalendar.ts` sent **no `limit`**, so 4,000 is FMP's default
page. **February is truncated and every figure above is a floor, not a
measurement.** It is probe Q1 one endpoint over: `SCREENER_LIMIT` sat at 1000
because nobody had tried raising it, and the coverage floor the whole plan
reasoned from was wrong by an order of magnitude. Nobody had asked the same
question here.

Fixed in the same PR as this note: `EARNINGS_CALENDAR_LIMIT` is sent,
`isTruncatedMonth` makes a full page cost `ok: false` rather than passing as a
result, and `/api/debug/earnings-calendar-limit` establishes whether the
parameter is honoured at all.

### The decision, on the floor numbers

`plan.byUniverse` on the concentration route now computes this rather than
leaving it to prose. Derived from the peak share, the near-report multiplier
(**2**, from the once-a-day cadence intersecting the 12h TTL — see
`lib/server/earningsPlan.ts`) and #406's per-run ceiling of 440:

| universe | peak-day reporters | calls on the busiest run | passes |
|---|---|---|---|
| 762 (today) | 97 | 194 | **1** |
| 1,500 | 190 | 382 | **1** — at 87% of the ceiling |
| 3,000 | 380 | 762 | **2** |

**One pass covers today and, provisionally, 1,500. 3,000 needs two.**

The 1,500 verdict is the fragile one and should not be banked: a peak share only
**1.15×** the truncated one puts it over, and February was cut off at exactly
4,000 rows. Read the untruncated month before committing to one pass at 1,500.

When a second pass is eventually needed it must be **derived**, not typed into a
cron expression: `planEarningsDay` returns `passesNeeded` and `batchPerPass`
from real constants, and `scripts/check-earnings-calendar-limit.mjs` asserts the
arithmetic in the failing direction. A hand-typed `15,27,39 7 * * *` encodes "3"
with no link to the numbers that produced it — the `PRICE_TARGET_RUNS` shape
this rebuild already removed once.

`EARNINGS_BATCH_SIZE` is still unchanged, and is sized in its own PR.

---

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

1. **The near-report re-fetch — 2, and traced rather than assumed.** The long
   TTL is `secondsUntil - EARNINGS_TTL_DAY`, so a symbol's key expires exactly
   one day before its report; the next run refetches it, and the run after that
   catches the date passing. **Two fetches, and it is two because of the
   CADENCE, not because the TTL is 12h** — with the job running once a day, a
   12h TTL is unreachable. The figure becomes 3 the moment the job runs twice a
   day, which is why `fetchesPerReport` derives it from the run period and the
   two TTLs instead of carrying "x2" as a constant.

   Note what this does NOT say: the peak run's load is `R(D) + R(D+1)` — fetch 1
   for a symbol reporting on D lands on the run of D−1 and fetch 2 on the run of
   D — so the busiest run carries two days' work, which is why the multiplier is
   applied to the peak count rather than to an average.
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
