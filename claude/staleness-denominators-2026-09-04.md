# The /cache-health denominators are inflated, and only ever grow

**Status: REPORT, not a fix.** Nothing in this document is implemented. It answers
the question "which of the two known causes dominates the 2,040, and what would
it take to make the denominator mean *the universe* again", and recommends two
changes that are deliberately not in the PR that produced it.

Written 2026-09-04, from the figures on the live page that morning.

---

## The observation

| dataset | rendered | universe | excess |
|---|---|---|---|
| Fundamentals | `761 / 886` | 762 | +124 |
| Price pool | `0 / 886` | 762 | +124 |
| Daily history | `796 / 2040` | 762 | **+1,278** |

Every percentage the page computes for these rows is a ratio against those
denominators, so every one of them is understated, and will keep getting more
understated for as long as the site runs.

## Two known causes

1. **`registerSymbols` is `nx`, and nothing ever removes.** A symbol that drops
   out of the universe stays in the queue forever. `deregisterSymbols` was added
   in #404 but it is called from exactly one place — the delisting sweep, on
   eviction — and until today nothing had ever been evicted.

2. **`markRefreshed("dailyHistory")` fires on page renders.** It lives in
   `writeHistoryEntry` (`historyCache.ts:936`), which runs for *any* symbol
   whose history is fetched — including a symbol that has never been in the
   universe, fetched because a crawler asked for its page. `markRefreshed` uses
   a plain `zadd`, so it **adds members**; it is not confined to updating scores
   of members that already exist.

## Which dominates: cause 2, by roughly nine to one

The fundamentals and price-pool rows are the control, and they are a clean one.
Both are `coverage: "registered"`, both are registered over the same universe,
and — critically — **neither has a `markRefreshed` caller outside its own warm
job**. `markRefreshed("fundamentals")` is called from inside `warmFundamentals`
over `quoteMap.keys()`; `markRefreshed("pricePool")` from inside `warmPricePool`
over `refreshed`. No render path touches either.

So for those two, the excess over the universe is cause 1 and nothing else:

```
cause 1  =  886 - 762  =  124 symbols   (+16% on the universe)
```

Two independently-maintained datasets landing on exactly the same 886 is what
makes this a measurement rather than a guess — that number is the nx-accumulation
of universe churn and nothing else.

Daily history is registered over the same universe by the same mechanism, so
cause 1 contributes the same ~124 there. Everything above it is cause 2:

```
cause 2  ≈  2040 - 886  =  1,154 symbols   (~57% of the whole denominator)
```

Of the 1,278 excess on that row, **cause 1 is ~10% and cause 2 is ~90%.**

### The one caveat on that number

`registerSymbols("dailyHistory", …)` was added later than the fundamentals one
(`pickersBuilder.ts:2983`, and its own comment records that the dataset was
`markRefreshed`-only before that). The two accumulation windows are therefore
not identical lengths, so "cause 1 contributes the same 124" is an assumption,
not a measurement. It biases the estimate in the direction of *understating*
cause 2 — a shorter cause-1 window means more of the 2,040 belongs to cause 2,
not less. The 9:1 split is a floor.

## What it would take to make the denominator mean "the universe"

Two separate changes. Neither is in the current PR, and the reasons are given
below rather than implied.

### 1. Stop it growing — `markRefreshed` should not be able to widen a denominator

`stalenessQueue.ts`'s own header already states the contract:

> `registerSymbols(...)` declares the DENOMINATOR
> `markRefreshed(...)` supplies the NUMERATOR

`markRefreshed` does not honour it. Its `zadd` has no `xx`, so it inserts
members that were never registered — which is precisely how a render for a
non-universe ticker ends up in the daily-history population.

The fix is one flag, and the registry already carries the information needed to
apply it selectively:

* `coverage: "registered"` → `zadd … { xx: true }`. The dataset has a real
  denominator; `markRefreshed` must only ever move a score inside it.
* `coverage: "observed-only"` (news, sectorNews, screenerFundamentals) → plain
  `zadd`, unchanged. For those, `markRefreshed` **is** the denominator, and the
  page already renders them distinctly for exactly that reason.

**Why it is not in this PR.** It changes a primitive nine datasets call, and it
has one visible edge: if a build ever calls `markRefreshed` before
`registerSymbols` for a brand-new symbol, the `xx` write is a no-op and the
symbol reads "never refreshed" for one cycle. That is the safe direction
(understating freshness, self-healing on the next run) but it deserves its own
diff and its own assertion run in the failing direction, not a footnote in a
change about delistings.

### 2. Shrink what is already there — a daily reconcile against the universe

`xx` stops the bleeding; it does not remove the 1,154 members already in the
set. Those need an explicit prune, and the machinery exists:
`deregisterSymbols(symbols)` ZREMs from every dataset's queue and defer set.

The cheap shape is one pass a day in the sweep that already holds the universe
list: `ZRANGE` the registered datasets' queues (~2,040 members, one command,
~20 KB), diff against the universe, `deregisterSymbols` the difference. It is
one extra read and one write per day.

**Why it is not in this PR.** It is destructive of bookkeeping across every
registered dataset at once, and a symbol that is temporarily out of the universe
— which happens on ordinary score churn, not only on death — loses its refresh
history and comes back reading "never refreshed". That is recoverable and cheap,
but it is a decision about what the page's population *means*, and it should be
made deliberately rather than as a side effect.

### What is NOT the fix

Raising the denominators' visibility, adding a second "true universe" count
beside them, or annotating the page. All of those leave the arithmetic wrong and
add a caveat the reader has to remember — the same shape as rendering a purple
`24 / 24`, which this page already rejected once on the grounds that a recoloured
wrong number still reads as a number.

## Cross-reference

The delisting sweep now calls `deregisterSymbols` on stale-bar evictions as well
as absence evictions, so the six dead tickers it removes come off these
denominators too. That is six of 1,278. It is not a fix for this and should not
be read as one.
