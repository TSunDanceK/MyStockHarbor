# Job 5 housekeeping — what was fixed, and what needs a decision

## Fixed in this PR

### `recencyScore = 100` — removed

It contributed `recencyScore * 0.05` to `computeOversoldCandidate`'s weighted
sum: a flat **5.00 on every candidate**, which can never separate two stocks. So
that composite had **five** discriminating terms and looked like six.

Removed rather than given a range: inventing a recency measure is a scoring
change, and the rules are parked. Removal is not a scoring change in any sense
that matters — the term was a literal times a literal, inside a numerator
divided by `keep`, which is constant per mode. **Every score in a mode moves by
exactly the same amount, so no ordering anywhere changes.**

The absolute numbers do move: about **5.00 lower** on the live path, **5.26** on
the no-structure paths where the divisor is 0.95. A score quoted from before
this change will not match one quoted after. That is the whole visible effect.

The other two `recencyScore` bindings in the file are **real** —
`scoreInverse(breakoutBarsAgo, …)`, varying per symbol — and are untouched.
`scripts/check-inert-terms.mjs` asserts that, and generalises: it fails on **any**
numeric constant multiplied by a weight anywhere in the file.

### `fetchIndexChanges` — confirmed correct, comment corrected

**It does surface failure.** With all three indexes failing, `succeeded.length
=== 0` throws, `readFeed` marks the feed not-ok, and the page renders
unavailable. It does **not** return `[]` and render "no recent index changes",
which would be indistinguishable from a genuinely quiet month.

The comment was wrong in a way that mattered: it said FMP returns 402 on *"the
Dow Jones constituent-history endpoint"* — singular, implying two of three still
answer. The probes proved **402 on all three**. So `allSettled` does not rescue a
partial result here; there is nothing to rescue, and the feed has never once
succeeded on this plan.

### Four stale `note:` fields in `/api/debug/fmp-endpoints`

Three said the constituent probes were *"currently used by
buildExpandedDiscoveryMasterList"*. That function no longer exists and nothing
in `lib/` calls the plain constituent endpoints. A fourth called
`isEtf=false&isFund=false` a *"CANDIDATE FIX"* — `screenerFundamentals.ts` has
been sending it for some time.

Four, not the three in the brief. They nearly got re-reported as fresh bugs,
which is the cost of a note that outlives its subject.

---

## Needs a decision — reported, not changed

### `advScore < 35` is a liquidity floor written as a penalty

Five sites, and **one is not +25**:

| line | function | penalty |
|---|---|---|
| 2050 | `computeOversoldCandidate` | +25 |
| 2153 | `computeOverboughtCandidate` | +25 |
| 2215 | `computeAthPullback` | **+30** |
| 2291 | `computeAthBreakout` | +25 |
| 2370 | `computeThreeMonthBreakout` | +25 |

**Classification: all five are scores, and all five read as filters.**

Expressed as a deduction, illiquidity can be outweighed. A stock below the
liquidity line still ranks above a liquid one if it is ~25 points better on the
other terms — and on these composites 25 points is reachable. That is not what a
floor means. If the intent is *"below this liquidity we do not show it"*, none of
the five implements it.

The `+30` is worth a separate answer: either `computeAthPullback` deliberately
holds illiquid names to a higher bar, or one site was edited and the others were
not. Nothing in the code says which.

Three shapes, and the choice is the owner's:

1. **Keep as a score, and say so** — rename to `illiquidityPenalty` so it stops
   reading as a floor.
2. **Make it a real filter** — `if (advScore < 35) return null`, which is what
   "floor" means and is a behaviour change.
3. **Both** — a hard floor at a lower threshold plus a graded penalty above it.

### `Daily history` reads 24 / 24 on /cache-health against a 755-symbol universe

**Neither of the brief's two options.** The metric does not sample 24, and
history does not cover only 24. The denominator is self-selecting.

`dailyHistory` is the only dataset in the registry that calls `markRefreshed`
and **never** calls `registerSymbols`:

```
historyCache.ts:523   await markRefreshed("dailyHistory", [normalized]);
pricePool.ts:528      await registerSymbols("pricePool", clean);      // <- the whole universe
```

So its sorted set contains only symbols that have actually been **written**
since the set was created (yesterday), and history writes are lazy — a symbol is
only written on a cache miss. 24 is the number of symbols that happened to miss
in that window.

"24 / 24, within policy" therefore means *"of the 24 we have observed, all are
fresh"*, which is true and reassuring about nothing. It is the same coverage
problem `registerSymbols` exists to solve, on the one dataset that does not use
it.

**The fix is one line** — `registerSymbols("dailyHistory", …)` wherever the
universe is known — but it belongs with the per-outcome TTL work, because that
work changes when history is written and would move this number anyway. Flagged
rather than done, since the brief was report-only.

Until then the row should not be read as coverage. Worth considering whether the
page should render a dataset with no `registerSymbols` caller distinctly — the
same "declared vs verified" treatment the jobs table got.
