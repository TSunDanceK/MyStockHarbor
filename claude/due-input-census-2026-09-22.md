# What the DueInput producer can actually produce (measured 2026-09-22)

Measured by `scripts/due-input-census.mjs`, relay task `write-due-input-census`,
run [35714403198], against the live report-dates store and the committed cut in
`data/due-strip.json` (generated the same morning from step-0 run
[35713495815]).

**Measurement only. No producer was written against these numbers yet — that is
the decision this doc exists to inform.**

## 1. Only 29 of the 50 can produce a DueInput at all

```
record present                44/50
nextPeriodEnd non-null        43/50
next.kind === "date"          29/50   <- the only kind carrying medianLagDays
  ... kind "month"             4
  ... kind "none"             11
  ... no record at all         6
BOTH periodEnd AND a lag      29/50
```

`medianLagDays` exists **only** on `{kind:"date"}`. The estimator refuses a date
for an irregular filer and returns `month` or `none`, neither of which carries a
lag, and `selectDue` drops any input without one. So the strip is a cut of 29,
not of 50, and no amount of producer code changes that.

### Why the 21 misses, in the estimator's own words

```
 7  only 0 prior 8-K item 2.02 announcement(s)
 2  last 4 lags spread 13 days across 2 months
 1  last 4 lags spread 16 days across 2 months
 1  no matched fiscal period end
 6  (no stored record at all)
```

**THE SEVEN ARE NOT A COVERAGE GAP THAT WILL FILL IN.** `estimateNextReport`
counts announcements whose `basis` is `"8-K item 2.02"`. A foreign private
issuer does not file those — it files 6-K — and the cut carries eight of them:
ASML, BABA, HSBC, RY, MUFG, NVS, AZN, SHEL. They are structurally unable to earn
a dated estimate under the current rule, so they can never appear in the strip.

That is the same FPI blind spot this build has already had to handle twice
(FPI market cap, #489; FPI P/E, #491), surfacing a third time in a new place.
It is recorded here rather than fixed: widening the estimator's basis filter to
admit 6-K is a change to the live stock page's "next expected" estimate, not a
due-strip change, and it is not this build's to make unasked.

## 2. filerCategory does not change the strip today — measured, not argued

The probe fetched the true category for all 50 and ran the SHIPPED `selectDue`
twice, one field apart:

```
   49  Large accelerated filer  ->  quarter 40d · annual 60d
    1  (absent)                 ->  quarter 45d · annual 90d

annual=false: true category 1 entries · fallback 1 entries · disagree on 0
annual=true : true category 1 entries · fallback 1 entries · disagree on 0
```

**Zero disagreement, in both directions.** `filerCategory` is read in exactly
one place — the overdue cap — and `DEADLINE_FALLBACK` (45/90) is *more
permissive* than "Large accelerated filer" (40/60), so a producer that passes
null can only ever keep a symbol the true category would drop. Today it drops
none.

**That is consistent with the brief, not a contradiction of it.** BUILD-BRIEF §6
already measured the overdue cap as a safeguard that fires twice in twelve
months, four symbol-days total. Zero today is what "twice a year" looks like on
a given Tuesday. The field is worth about four symbol-days a year — and on an
ANNUAL period the gap between correct and fallback is 60 vs 90 days, so a
producer hardcoding null would keep an annual filer in the strip **30 days past
the point the cap exists to stop**.

## 3. `annual` has the identical gap, and nothing had noticed

`deadlineDays(category, annual)` takes **both**. `StoredReportDates` stores
neither. The scoping question named only `filerCategory`.

`annual` is not a smaller problem: the deadline cells are 40/45 for a quarter
against 60/75/90 for a year, so guessing it wrong moves the cap by 15 to 45
days — a wider error than the category's. Measured the same way, it also
disagrees on 0 symbols today.

Both are already in hand at the write site. `app/api/jobs/sec-facts/route.ts`
computes

```ts
const cadence = nextPeriodEndFrom(quarterEnds, yearEnds);
const { estimate: next, periodEnd: nextEnd } = estimateUpcoming(
  events, cadence, subs.category, todayIso
);
```

and then calls `writeReportDates({...})` **in the same block**. `subs.category`
and `cadence.annual` are both live variables at that point and are discarded
after use. Storing them is one field each, no extra fetch, no extra rate-limit
exposure.

`cadence.annual` is also the correct value to pair with the stored
`nextPeriodEnd`: `estimateUpcoming` may roll the period forward up to eight
steps, but it passes `cadence.annual` unchanged on every iteration, so the
annual-ness of the returned `periodEnd` never differs from the cadence's.

## 4. The strip renders exactly one row today

```
universe 822 · with a results record 617 · coverage 75.1% (floor 50%)
resolveDueStrip -> listed with 1 entries
  MU     period 2026-08-27 · due from 2026-09-15 · 26d outstanding
```

Two consequences:

- **The `listed` branch is demonstrable against real data.** One row, but real.
- **`none-outstanding` and `unavailable` are NOT reachable from today's
  production data.** `none-outstanding` needs an empty list at coverage ≥ 50%
  and MU is outstanding; `unavailable` needs a failed manifest read or coverage
  below 50% and coverage is 75.1%. Neither can be produced by pointing the page
  at production today.

So "verify all three branches against real data before calling this done"
cannot be satisfied literally. The honest form is: `listed` against real data,
the other two against forced inputs at the render layer — which is a different
and weaker claim, and is flagged rather than quietly substituted.

## 5. A denominator discrepancy to settle before wiring

`dueStripState.DueStripInputs.universeSize` is documented as "symbols in the
analysis universe the strip is computed over". This census used the **manifest**,
which holds **822**. The analysis universe the cut was drawn from holds **700**.

Coverage clears the 0.5 floor on either denominator today (75.1% on 822), so
nothing is currently mis-resolved — but the two numbers are not the same number,
and the floor is a ratio. Whichever the page passes should be the one the cut
came from, or the coverage figure describes a different population from the
strip it gates.

## Reproducing

```
relay.yml  task=write-due-input-census   (credentialled for the READ; writes nothing)
```

Read-only despite the `write-` prefix — that prefix is the credential boundary,
the same as `write-beta-mu` and `write-queue-projection`. The run states
"No writes were performed." as its last line.
