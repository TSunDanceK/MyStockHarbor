# Redis bandwidth: Part 1, measured — and the model is incomplete

**Part 1 only. No payload shape was changed in the PR that produced this**, per the
brief's own rule: do not act on an estimate. What shipped is the measurement, a
meter so the two remaining unknowns close on their own, and a build-enforced
ceiling on `ANALYSIS_UNIVERSE_CAP`.

**Headline: chartPoints are the largest single term, but they are not the whole
bill. Bulk history reads are a second term of the same order, and the model
omits them entirely.** The brief asked to stop and say so if the measurement said
something other than "chartPoints dominate". It does.

---

## What is measured, what is counted, what is inferred

The distinction matters more than the numbers, so it comes first.

| kind | figure | how |
|---|---|---|
| **measured** | bytes per symbol, per store | structures rebuilt from the writing modules' own field sets, rounding and bar counts, then serialised. Re-derived on every build by `scripts/check-redis-bandwidth.mjs`, which fails if a constant drifts. |
| **cross-checked** | the reconstruction itself | lands at 10,963 B against the 11,016 B `/api/debug/pickers-size` measured in production on 2026-08-06 — **0.5% apart**. That agreement is the only reason to believe any synthetic figure here. |
| **counted** | picker builds per day | Vercel runtime logs, `[pickers] build complete`: **4 in the 3 hours 05:09–08:09Z on 2026-09-04** → ~32/day. |
| **inferred** | picker payload reads per day | still not directly countable — see Q4. Bounded, not known. |

---

## Q1 — bytes per symbol, today, at 762

| store | bytes/symbol | what it is |
|---|---|---|
| `msh:picker-charts:v1` | **10,963** | 72 bars × 10 fields |
| stripped pickers payload | **~2,000** | the non-chart share of one `signalRecord` |
| **picker total** | **~13.0 KB** | the brief's extrapolated 13.3 KB was right to 2% |
| `msh:history:v7:<SYM>` | **109,962** | ~1,188 bars of OHLCV — **8.5× the picker figure** |

The 2026-08-06 extrapolation from a 260-symbol universe holds. The history entry
is the figure nobody had.

## Q2 — points stored, and the shape of one

**72 bars per symbol**, from `buildPickerChartPoints(points, bars = 72)`. Ten
fields: `date open close high low volume ma50 ma200 rsi14 macdHist`.

One point costs **152.3 bytes**, and the brief's instinct is right — most of it is
the field names:

```
date      key  7B  value 12.0B      ma50      key  7B  value  5.2B
open      key  7B  value  5.2B      ma200     key  8B  value  5.2B
close     key  8B  value  5.2B      rsi14     key  8B  value  4.9B
high      key  7B  value  5.2B      macdHist  key 11B  value  6.4B
low       key  6B  value  5.2B
volume    key  9B  value  7.7B
                              keys 78B   values 62.3B   +9 commas +2 braces
```

**Field names are 51.6% of every point.** That is the ceiling on what repacking
can win — which is why the answer below is 2.07×, not the 3–5× the brief hoped
for.

Every one of the ten fields is load-bearing, checked rather than assumed:
`MiniPickerCandleChart` has client-side fallbacks for `ma50`, `rsi14` and
`macdHist`, but computed over the 72-point window they are null for 42, 0 and 26
of the 64 visible candles respectively; `ma200` needs 200 bars and is never
recoverable client-side at all. **No field can be dropped.** The format is the
only free lever on this store.

## Q3 — the trim gap is 11%, not "the whole saving"

This is where the brief's model is wrong, and it is worth being exact.

| consumer | wants | for how many rows |
|---|---|---|
| `deriveRow` — price, change %, volume, **200 MA** | last **2** bars | **every row** |
| `sparkCloses` | last **40** closes | rendered rows |
| `MiniPickerCandleChart` | `visibleLimit = supportResistanceZone ? 104 : 64` | `CHART_PAGE_SIZE` = 21, plus one open mobile row |

**The chart asks for up to 104 bars and we store 72.** On rows carrying a
support/resistance zone we are already serving it short. On rows without one the
gap is 72 → 64: **eight bars, 11%.**

The brief's framing — "if the page draws 60 and we store 200, that gap is the
whole saving" — describes the *history* cache (1,188 bars stored, 63–1,300
requested), not the picker payload. In the payload the storage is already close
to what is drawn.

**So option (a) is rejected on measurement**, not on taste.

## Q4 — regenerations per day: still inferred, and the meter is why

The brief's 690/day is circular (bandwidth ÷ its own byte estimate) and it says
so. I tried to replace it with a real count and **could not**, for a specific
reason worth recording: a picker page regeneration that finds a warm cache emits
**no log line at all**, so it does not appear in Vercel's runtime logs. Grouping
24h of production logs by route returns only routes that logged; the picker
routes appear only on the builds.

What is countable is the **builds**: 4 in 3 hours → **~32/day**. Those are the
runs that pay the history term below.

So the payload-read count is bounded rather than known:

```
total bill                     6.67 GB/day
less history on builds         2.56 GB/day     (32 x 79.9 MB, both terms measured)
                               ----
remainder for payload reads  ≤ 4.11 GB/day
                             ÷ 9.4 MB per read
                             = ≤ 437 reads/day  =  ≤ 12.1 per route per day
```

**Not 19.2 — at most 12.1**, and that is still an upper bound, because it charges
the three plays builders' history passes and everything else to the payload term.

`recordRedisRead` now counts these directly and `/cache-health` ranks them. The
answer arrives on its own within a day of deploy, which is the point of shipping
a meter instead of a conclusion.

## Q5 — the ranking, and the term that was missing

Per read, at 762 symbols:

| read | bytes | note |
|---|---|---|
| one full-universe **history** bulk read | **79.9 MB** | on **every build**, warm cache or not |
| one **picker payload** read (charts + stripped) | **9.4 MB** | on every regeneration that misses the in-process memo |
| one **price pool** bulk read | ~0.17 MB | every 5 minutes; negligible |

Derived bytes/day:

| source | GB/day | share |
|---|---|---|
| picker charts | ≤ 3.5 | ≤ 52% |
| **history bulk (picker builds)** | **2.56** | **38%** |
| picker payload (stripped) | ≤ 0.66 | ≤ 10% |
| history bulk (three plays builders) | unknown | invisible — they log nothing |
| price pool | ~0.05 | <1% |

`getDailyHistoryBulk` reads Redis **even under force and even on a fully warm
cache** — its own comment says so. From FMP's point of view a warm build is free,
which is exactly why the FMP meter could sit at 11.4% while this one was at 100%.

The plays builders (`bull-flags`, `plays`, `descending-triangles`) each read the
universe's history per rebuild and emit no build log, so their contribution is
unmeasured. If all three rebuilt hourly they alone would exceed the entire bill,
so they plainly do not — but "plainly does not" is a guess, and the meter now
counts them.

---

## Part 2 — recommendation

**Take (b). Reject (a). Hold (c). Reject (d) as written, and take its better
half separately.** With the measured saving for each.

### (b) Pack the point format — **the recommendation**

Parallel arrays, the shape `trendSeries` already uses at `pickersBuilder.ts:128`.

| store | now | packed | factor |
|---|---|---|---|
| chart series | 10,963 B | **5,301 B** | 2.07× |
| history entry | 109,962 B | **55,366 B** | 1.99× |

**2×, not 3–5×** — field names are 51.6% of a point, so removing them all is a 2×
ceiling by arithmetic. The brief's higher figure was the one thing in it that the
measurement contradicts outright.

The reason to take it anyway is that **it is the only lever that applies to both
terms**, including the one the model omitted. Zero UX change; the pack/unpack
lives inside `historyCache` and `pickerChartsCache`, so every consumer keeps
seeing `Point[]` and `chartPoints`, exactly as `pickerChartsCache` already hides
the payload split.

Two costs, stated:
- **A migration window.** Old entries are unpacked objects and must stay readable
  until they expire (50h for history, 3h for charts). A `v` marker on the packed
  shape and a two-shape reader; the fallback comes out in a second deploy. A
  follow-up that must happen is a follow-up that can be forgotten — the same
  objection that sank Task 5 in `claude/redis-data-shape-proposal-2026-08-31.md`,
  and it applies here too.
- **Unpack CPU.** ~900k object allocations per build at 762 symbols. The build
  already takes 11s; this is not free and should be measured on the preview.

### (a) Trim stored points — **reject**

11% at best (72 → 64), and negative on rows with a support/resistance zone, which
already get fewer bars than the chart asks for. Not worth a shape change.

### (c) ISR 1800 → 3600 — **hold as the reversible lever**

Halves the payload term and does nothing for the history term, so it cannot fix
this alone. Cheap and reversible, so it is the right thing to reach for if (b)
lands short at 1,500 — see below, where it is needed.

One caveat on the arithmetic: at ≤12 regenerations per route per day against the
48 an 1800s window allows, regenerations are **traffic-driven, not clock-driven**.
Doubling the window halves them only if request arrivals are roughly uniform.
Plausible for scraper traffic; not proven.

### (d) Charts above the fold only — **reject as written; take the scalars**

The regression is real: `PickerResultsGrid.tsx` "Show more" works off data already
sent. But `claude/chartpoints-payload-dependency-2026-08-24.md` already designed
the version without it — **ship four scalars per symbol** (`price`, `changePct`,
`volume`, `ma200`) computed server-side, plus the 40 closes the sparkline draws,
and fetch full series only for rendered rows.

Measured: the list row's actual need is **324 bytes per symbol — 3.0% of today's
10,963.** That is the 95% cut with no "Show more" regression, because the scalars
ship for every row and only the *series* becomes lazy.

It is a bigger change than (b) and it touches render paths, which is why (b) goes
first.

---

## The test of this PR: does 1,500 come back under the cap?

Read counts held at the measured/inferred rates (they are traffic-driven, not
universe-driven; the per-read SIZE is what grows).

| | 762 | 1,500 | 3,000 |
|---|---|---|---|
| today | **207 GB/mo** | 407 | 814 |
| (b) both stores packed | **111** | **219** | 438 |
| (b) + (c) ISR 3600 | 79 | **149** | 293 |
| (b) + scalars/lazy series | 84 | **123** | 245 |

**(b) alone lands 1,500 at ~219 GB/month — about 10% over.** It clears today with
room and it does not clear the next growth step on its own. Either (c) or the
scalars closes it; the scalars are the better of the two because they cost no
freshness, and they are the only pair that also improves 3,000 materially.

**Nothing here clears 3,000.** At that size the history term alone is 5.1 GB/day
packed, and its depth cannot be cut — `claude/fmp-history-payload-audit-2026-08-30.md`
established that 1,300–1,400 days is genuinely requested by four call sites. 3,000
needs a different answer (fewer full-universe passes), not a smaller one.

---

## What this changes about the growth plan

`claude/earnings-season-measurement-2026-09-02.md` sequenced
`ANALYSIS_UNIVERSE_CAP` 700 → 1,500 → 3,000 behind the earnings work, with 1,500
"tight but provisionally one pass". **1,500 is now blocked here instead**, and on
a harder constraint: an earnings shortfall degrades coverage, while 2× the Redis
cap is a bill or a throttle.

`scripts/check-redis-bandwidth.mjs` enforces it: `ANALYSIS_UNIVERSE_CAP` may not
rise above `REDIS_OVERAGE_MEASURED_AT_CAP` (700) while the projection is over the
plan limit.

### Is a build-enforced budget check practical? Yes, with one honest caveat

Everything needed is derivable — the constants are re-derived from source on
every build, the cap is imported rather than retyped, and the plan limit is
named. But **the obvious form of the check is red on main today**, because the
bill is already over at the cap we run. A check that fails from the day it lands
gets muted, and a muted check protects nothing.

So the enforced rule is the direction rather than the level: **the cap may not
rise while the projection is over.** Green today; red on precisely the action
this document exists to prevent. When (b) lands and the projection drops under
the cap, the ceiling can be raised to whatever the new measurement supports —
which is the same act as re-taking the measurement, deliberately.

## The method note, for the fifth time

An endpoint returning a suspiciously round number is telling you about its
defaults. This one is the sibling case: **a meter that exists gets read, and a
limit with no meter gets ignored.** FMP had a meter and sat at 11.4%; Redis had
none and sat at ~100% for weeks. The first question about any limit is not "how
close are we" but "is anything counting".
