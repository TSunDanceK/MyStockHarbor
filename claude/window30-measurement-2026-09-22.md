# A 30-day window survives what an exact date did not (measured 2026-09-22)

Relay [35731269985], task `window30`, against step-0 dump [35713495815].
Full analysis universe, not a sample. **Measurement and a recommendation; no
page code written.**

## The bar, stated before the numbers

1. **It must beat the naive baseline by a wide margin.** A quarterly filer sits
   inside *some* 30-day forward window about a third of the time, so "list
   everyone, every day" scores ~33% while knowing nothing. A predictor that
   does not clear that decisively is one a reader could reproduce by assuming
   everyone reports soon.
2. **It must hold PER FILER**, because a page shows or hides a symbol, not an
   average. Bar: ≥70% listing-day precision on that filer's own history.
3. **Catastrophic misses must be rare and attributable** — a tail spread evenly
   across the population is a property of the method; a tail concentrated in a
   nameable class is a suppression rule.

## Collection

```
universe 700 · collected 695 · 5 with no CIK · 0 fetch failures · 14 needed extra pages
715 requests · 116.2 MB · 142s wall
filers with >=8 usable periods: 614 of 695
excluded for thin history: 81 (11.7%) — 5 of those hit the paging cap, so their
  thin history may be the CAP rather than the filer
```

## The numbers

```
ALL        n=20199 over 614 filers · medAbs=3d p90=15d
           band: <=7d 79.2% · <=14d 89.6% · <=21d 95.0% · <=30d 98.6%
           LISTING-DAY PRECISION 82.6% · zero usable overlap: 281 (1.4%)
domestic   n=17963 over 540 filers · medAbs=3d p90=14d
           LISTING-DAY PRECISION 83.9% · zero overlap: 97 (0.5%)
FPI        n= 2236 over  74 filers · medAbs=5d p90=27d
           LISTING-DAY PRECISION 72.1% · zero overlap: 184 (8.2%)
```

**Listing-day precision** is the reader-facing figure: over every day we would
list the filer, how often it really does report within that window. A 10-day
error is not "a hit", it is two thirds of one, and this is the only one of the
three figures that scores it that way.

### The baseline, computed rather than assumed

```
"list every filer every day, knowing nothing": 31.5%
  (union of [actual-30, actual] per filer, merged, across 682,283 of 2,168,916 filer-days)

LIFT OVER BASELINE: 51.2 points (82.6% vs 31.5%)
```

### How far off the misses are

```
outside +/-30d: 281 of 20199 (1.4%)
  |error|: median 39d · p90 109d · max 596d
  31-45d: 185 · 46-60d: 39 · 61-90d: 20 · 91-180d: 17 · 180+d: 20
  spread across 91 of 614 filers
  worst: SBS(20) BBVA(17) WPM(15) PAAS(11) AEM(10) ESLT(9) BN(8) BNJ(8) HSIC(7) ATHS(7)
```

Two thirds of the misses are 31–45 days — a filer that slipped a fortnight, not
a filer we have no idea about. The 180+ tail is 20 predictions across the whole
corpus.

### Per filer, which is what decides the feature

```
filers scored: 614
  >= 50%: 607 (98.9%)     >= 70%: 556 (90.6%)     >= 90%: 152 (24.8%)
  >= 60%: 595 (96.9%)     >= 80%: 415 (67.6%)
filers whose WORST prediction still overlapped at all: 523 (85.2%)
```

## Verdict: it clears all three. Build it.

Against bar 1 by 51 points; bar 2 for 556 of 614 filers (90.6%); bar 3 with a
1.4% zero-overlap rate concentrated in 91 filers, and **the concentration is
nameable**: FPIs are 8.2% zero-overlap against domestic filers' 0.5%.

This is not in tension with the day-level result — it confirms it. Median
absolute error is 3 days and p90 is 15, so an exact-date claim fails exactly as
measured, while a 30-day band absorbs the same error. The two measurements
agree about the error distribution and disagree only about what claim it
supports.

### Suppression rules the data supports

- **Per filer, ≥70% on its own history.** Drops 58 of 614.
- **FPIs need their own treatment**, not exclusion by default: at 72.1% they
  clear bar 1 easily but carry 16× the domestic zero-overlap rate. Either widen
  their band or hold them to a higher per-filer bar.
- **Thin history stays out.** <8 usable periods is 81 filers; the 5 that hit the
  paging cap should be re-measured with the cap lifted before being excluded on
  the merits.

### A finding worth acting on separately

The production estimator (`secReportDates.estimateNextReport`) counts only
`"8-K item 2.02"` events, which is why the due strip structurally excludes eight
FPIs (`claude/due-input-census-2026-09-22.md`). **This probe's FPI path reads
6-K and works** — 74 filers, 72.1% precision. So the FPI blind spot is a
limitation of the estimator's basis filter, not of the data. Recorded, not
fixed: widening that filter changes the live `/stock/[symbol]` "next expected"
line.

---

# The FMP audit (item 4), traced rather than assumed

## The header is NOT stale. The grid still calls FMP.

`lib/server/earningsCalendar.ts` contains **no reference to
`secReportDatesStore`** — verified by grep across the file. #484 replaced the
per-symbol *report-date* computation; it never touched the grid's candidate
list. Traced end to end:

```
getDayCandidates -> getMonthCandidates -> fetchMonthRows
  -> fetchMonthRowsDetailed -> fetchCalendarRange
  -> https://financialmodelingprep.com/stable/earnings-calendar?from&to&apikey
```

All three FMP endpoints the header names are still live call sites:

| endpoint | line | what it supplies |
|---|---|---|
| `/stable/earnings-calendar` | 681 | the candidate list for every date |
| `/stable/stock-list` | 879 | company names (`getNameMap`) |
| `/stable/quote` | 1101 | **price, marketCap AND exchange**, per symbol |

**So "the due strip is SEC-sourced, no FMP involved" is true of the strip and
not of the grid it sits above.**

## A live bug found in the same trace

In `fetchMonthRowsDetailed`, the no-key early return sits **above** the Redis
read:

```ts
const apiKey = process.env.FMP_API_KEY;
if (!apiKey) return empty(cached?.rows ?? [], Boolean(cached));   // <- returns here
if (!options.bypassCache) { const shared = await readReference(...) }  // <- never reached
```

The comment on that Redis block says "REDIS BETWEEN THE MODULE CACHE AND FMP",
and positionally it is — but the key-lapsed path jumps over it. So on a cold
lambda with no FMP key the month reads as **empty** even though Redis holds it:
the shared cache that exists to survive cold starts is skipped exactly when it
is the only source left. Recorded, not fixed.

## Scoping the Tiingo swap

**It is not a drop-in, because the FMP quote is not primarily a price call.**
`quoteOne` returns `{price, marketCap, exchange}` and `exchange` is the
**US-listed admission test** — a row with no exchange is dropped entirely
(line 1254). Tiingo supplies the price and neither of the other two.

| field | today | after a Tiingo price swap |
|---|---|---|
| `price` | FMP `/stable/quote` | Tiingo |
| `marketCap` | FMP `/stable/quote` | **gap** — but the price pool and `fundamentals.json` carry caps for the ~700 universe (#505) |
| `exchange` | FMP `/stable/quote` | **gap, and load-bearing** — without it every non-pool row fails `exchangeOk` and vanishes |

The cheapest path is probably to stop treating the quote as the admission test
at all: `usOk` (a price-pool hit) already bypasses `exchange`, and the pool
covers the analysis universe. Symbols outside it are exactly the "hidden, not
dashed" population decision 7 already covers.

**Licensing, unchanged and worth re-confirming before wiring:**
`scripts/bars-provider-probe.mjs` records that Tiingo's free and personal tiers
are INTERNAL-USE, and that the cheapest properly-licensed display path is its
EOD+IEX Redistribution Business tier at ~$250/month — "from research, not from
this run". A public site redistributes.

## Two live forward-looking overclaims on the page

1. **The "Next up" ticker is already effectively dead.** It walks forward 14
   days, but `isDateInWindow` is `[today-90, today]` — so only `today` passes,
   and every row it renders is labelled "Today". A "Next up" marquee showing
   at most three of today's already-filed companies.
2. **The search placeholder reads "Search a ticker or company for its next
   earnings date"** — a next earnings date the page does not have.

Both are resolved by the section proposed above, or by retiring the copy.
