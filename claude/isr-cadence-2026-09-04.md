# The ISR split, and where the $30.80 actually is

Supersedes PR A of `cut-the-bill.md`. Same change, and the measurement it asked
for first.

**Headline: it is `/stock/[symbol]`, and the other side of that is provable
rather than estimated.** Every other revalidating page in `app/` has a hard
ceiling of ~4,000 regenerations a day, whatever traffic arrives.

---

## Part 1 — the split, measured before changing anything

### What is provable

An ISR regeneration needs a request arriving after the window expires, so the
ceiling per path is `86400 / revalidate`. Enumerated from source — 50 files
declare a route-level `revalidate`:

| window | routes | paths | ceiling, regenerations/day |
|---|---|---|---|
| **900s** | `/stock/[symbol]` (layout — covers the page and its `/news` and `/earnings` tabs) | **one per symbol × 3 tabs** | **96 per path** |
| 1800s | 36 picker routes + headlines, sector (×2 dynamic), plays (×3), videos | ~84 | ~4,032 total |
| 3600s | bottlenecks | 1 | 24 |
| 86400s | insights/[slug], learn/[slug], stocks, upcoming-ipos | ~40 | ~40 |

**Everything that is not `/stock/[symbol]` cannot exceed ~4,100 regenerations a
day at its absolute ceiling.** Against 7.7M writes a month (~257k/day), that is
the whole answer to "where is the saving": not on the picker routes.

The stock path space is the other half. The sitemap submits a curated
`priorityStocks ∪ uniqueEtfs` set — **161 symbols**, so 161 + 161 news + 129
earnings = **451 sitemap-listed paths**. The long tail is not in the sitemap but
is reachable by internal links from every picker and screener row, which puts the
crawlable space closer to **~2,300 paths** at the warm universe's 762 symbols.

```
451 paths   x 96/day  =    43k regenerations/day
2,300 paths x 96/day  =   221k regenerations/day
observed              =   257k ISR WRITES/day
```

### What is NOT provable from here, and I am not going to pretend otherwise

**Writes are not regenerations.** Next 16 caches at segment granularity, and the
production runtime logs show it directly — `/learn.segments/_tree.segment`,
`/learn.segments/_head.segment`, `/learn.segments/learn/__PAGE__.segment` appear
as three separate routes for one page. So one regeneration writes several cache
entries and the multiplier is >1. I cannot read it from any tool available here.

That matters, because a cross-check disagrees with the naive reading. Each stock
regeneration server-seeds its chart with `getDailyHistory()`, a **~110 KB** Redis
read (`lib/server/redisBandwidth.ts`). At 257k regenerations a day that would be
**27.8 GB/day of Redis** — four times the entire measured bill of 6.67 GB/day. It
cannot be right.

Reconciled the other way round: the Redis budget leaves room for roughly
**35–40k stock-page regenerations a day** after #419's ~2.5 GB/day of cron
history reads, which implies **~6–7 ISR writes per regeneration** and ~400 stock
paths saturating — close to the 451 the sitemap submits. That is a consistent
picture, and it is still an inference.

**What survives either model** — and it is the only thing the decision needs:

- the non-stock routes are ~1.6% of writes under the high model and ~10% under
  the low one;
- **`/stock/[symbol]` is the line either way**;
- and the ÷4 applies to ISR *writes* directly, whatever the per-regeneration
  multiplier is.

I have said which parts are ceiling arithmetic, which are cross-checks and which
are inference, because this model has now been wrong twice by treating a
plausible number as a measured one.

## Part 2 — the change

| route | was | now | why it is safe |
|---|---|---|---|
| `/stock/[symbol]` (layout) | 900 | **3600** | the render holds the **shell** — name, sector, profile, income statement — all on 24-hour FMP caches |
| 36 picker routes | 1800 | **3600** | pairs with tier 2 going hourly (PR B) |

**Nothing a reader would notice is on this clock.** Price, valuation and analyst
rating are fetched client-side on every load with their own caches — `/api/quote`
holds a 60-second Redis cache and refuses to queue behind the minute guard. The
one thing that *is* on this clock is the server-seeded chart, which is daily
candles: an hour is immaterial, and the last bar is a running close either way.

`ScanFooter` prints the **observed** price-age range rather than the policy, so
the picker pages state their real freshness without any change here.

## Part 3 — the expected dollars

ISR Writes: **7.7M → $30.80** = **$4.00 per million**.

| | writes/month | after | saved |
|---|---|---|---|
| `/stock/[symbol]` at ÷4 | ~7.6M | ~1.9M | **~5.7M** |
| picker routes at ÷2 | ~50k | ~25k | ~25k |
| | | | **~5.7M ≈ $22.80/month** |

**~$23 of a $67.48 bill, ~34%**, and essentially all of it is the stock pages.

Two honesties about that number:

- It assumes regenerations are **ceiling-saturated**, i.e. that a request arrives
  in nearly every window. The observed volume sitting close to the path-count
  ceiling is what makes that reasonable; where it is not saturated the divisor
  under-delivers.
- The picker half is **~$0.10/month**. It is in this PR for coherence with the
  hourly price tier, not for the money, and calling it a saving would be
  dressing up rounding error.

### The Redis half, reinstated as secondary

`cut-the-bill.md` claimed longer windows cut Redis too, then withdrew it as
unverified. **It is real** — a stock-page regeneration reads ~110 KB of history
to seed the chart, and ÷4 cuts that fourfold — but it is not the dominant term
(#419 showed the crons were), and **its size is not asserted here**. #419's
caller-tagged meter, with `history-single` and a `stock-page` tag, is what will
measure it. The honest sequence is to let it, rather than to claim a number the
way the first version did.

## What is not touched

`/api/history`'s own `revalidate` and the price-pool TTLs govern data a reader
can see. This PR is about how often the **shell** is rebuilt, and nothing else.

## The check changed shape, not just its number

`check-picker-routes` pinned the literal `1800`, which made it a test of a value
rather than of a property — moving the window failed it for the right pages for
the wrong reason. It now asserts the two things that matter: that all 36 declare
the **same** window (a shorter timer on one page reinstates the per-scrape
rebuild cost invisibly), and that the window is **not shorter than
`TIER2_TTL_MS`**, read from `priceTiers.ts` rather than retyped. A page rebuilt
more often than its prices refresh pays for renders that cannot show anything
new — that is the coupling PRs B and C rest on, now enforced rather than
remembered.
