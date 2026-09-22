# The Item 2.02 that isn't the results release — TSLA, ABBV

*Found 2026-09-22 while verifying the ticker-search estimator against production
(relay 35763970676). Recorded, not fixed — the cause is in the SHARED estimator
and the fix moves the live `/stock/[symbol]` page, which is a different
subsystem and a different decision.*

## What was seen

Six symbols earned an in-window estimate in relay 35763454309. Two of them
quote a median a reader would not believe:

```
TSLA  expected to report in roughly 8 to 21 days
      Usually reports 2 days after a period ends, over its last 14 periods
ABBV  expected to report in roughly 8 to 21 days
      Usually reports 4 days after a period ends, over its last 14 periods
```

## The filings underneath, from the stored record

```
TSLA  next={"kind":"date","date":"2026-10-02","medianLagDays":2,"spreadDays":0,"fromEvents":14}
      period 2026-06-30  announced 2026-07-02  lag 2  8-K items=2.02,9.01  0001628280-26-046717
      period 2026-03-31  announced 2026-04-02  lag 2  8-K items=2.02,9.01  0001628280-26-022956
      period 2025-12-31  announced 2026-01-02  lag 2  8-K items=2.02,9.01  0001628280-26-000016
      ... eight consecutive quarters, every one at lag 2

ABBV  next={"kind":"date","date":"2026-10-03","medianLagDays":4,"spreadDays":4,"fromEvents":14}
      period 2026-06-30  announced 2026-07-06  lag 6  8-K items=2.02,9.01  0001551152-26-000021
      period 2026-03-31  announced 2026-04-03  lag 3  8-K items=2.02,9.01  0001551152-26-000011
      ... eight consecutive quarters at lags 3–7
```

Tesla announces quarterly production and delivery numbers two days after each
quarter ends, and files them under **Item 2.02, Results of Operations** — which
is correct filing practice. Its actual earnings release lands roughly three
weeks later. ABBV shows the same shape: a consistent Item 2.02 three to seven
days after period end, while its results release is about a month out.

So the event is a real Item 2.02. It is simply **not the results release**, and
`reportEvents` keeps the EARLIEST 2.02 per period.

## Why nothing catches it

- **`spreadDays` doesn't.** TSLA's spread is 0 and ABBV's is 4 — these filers are
  extremely regular, which is what the estimator rewards.
- **The precision bar doesn't.** `filerPrecision` scores whether a filer repeats
  **its own** habit. It cannot see that the habit being predicted belongs to the
  wrong event. A consistently wrong answer scores near 1.0.
- **Coverage doesn't.** The input arrived; it is the wrong input.

## Where it already shows, today

This is **not introduced by #512 or the search change** — it is in the shared
estimator and is already live:

| Surface | What it does with TSLA today |
|---|---|
| `/stock/TSLA` "next expected" | reads `next.kind:"date"` → **2026-10-02**, already live |
| Due strip (#507/#508, live) | period ends, +2 days, nothing filed → TSLA claimed **outstanding** within days of each quarter end |
| Expected section (#512, unmerged) | **"expected in roughly 8 to 21 days"** when earnings are ~30 days out |
| Ticker search (this branch) | the same sentence, per symbol |

## Options, none taken

1. **Do nothing.** Two filers of 55; the 30-day band absorbs a lot, but not
   three weeks — TSLA's estimate lands in the wrong band, not merely off by a
   few days.
2. **A minimum-lag floor** (refuse an estimate below ~10 days as implausibly
   early for a results release). One line, but it is an unmeasured threshold
   and it would silently drop a genuinely fast filer. ORCL at 10 days is real.
3. **Pair the 2.02 against the period's 10-Q/10-K filing date** and keep the
   2.02 nearest it rather than the earliest. Principled, uses data already
   stored, and is the real fix — it also moves `/stock/[symbol]`, so it is its
   own change with its own verification.
4. **Latest-2.02-per-period instead of earliest.** Cheap, but earliest-wins was
   chosen deliberately and reversing it has its own failure mode (a later
   8-K amending or restating results would win).

Recommendation: **(3)**, as a separate piece of work against the shared
estimator, with the due strip and the expected section re-verified after it.
