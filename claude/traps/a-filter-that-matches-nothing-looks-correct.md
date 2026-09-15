# A filter that matches nothing looks exactly like a filter with nothing to match

Named 2026-09-15, after the third instance in one project. Each of the three got
a point fix. The pattern had never been written down, so each was found by luck
rather than by habit — and the third was found only because an *unrelated* line
next to it failed to compile.

## The shape

A predicate is written against data nobody has looked at yet. It is syntactically
valid, semantically plausible, and **wrong in the one direction that produces no
error**: it matches nothing, ever.

Nothing breaks. No exception, no type error, no failing test. The code runs, the
page renders, the numbers look reasonable. **The output of a broken filter is
indistinguishable from the output of a working filter on a quiet day** — and the
quiet-day reading is always the more comfortable one, so that is the reading it
gets.

The asymmetry is what makes it durable:

- A filter that matches **too much** deletes visible things. Someone notices.
- A filter that matches **too little** deletes nothing. Everything it should have
  removed stays, wearing the appearance of legitimate data.

## The three instances

### 1. FMP's guessed field names (`lib/server/ipoCalendar.ts`, 2026)

`firstStr(row, ["symbol", "ticker"])` and friends were written against FMP's IPO
calendar **without ever seeing a live payload** — the docs are a JS-rendered
playground, so the parser accepted several plausible spellings per value and fell
back to null.

A candidate list that contains the right key works. A candidate list that misses
it returns null for every row, and `parseRow` then drops the row as "not
confirmed yet". **A parser with entirely wrong field names produces an empty
Upcoming IPOs table, which is exactly what a quiet fortnight produces.**

It survived because someone eventually saw live data: the file's own comment
records that the withdrawal field is `actions` (values seen: `"Expected"`), *not*
the `status`/`ipoStatus` originally guessed. Both guesses are still in the
fallback list. The guess was wrong and nothing had said so.

### 2. The SIC codes that matched zero rows (`claude/ipo-phase0-RESULTS-2026-09-14.md`)

The ETF/trust exclusion was specified as **SIC 6726 (investment offices) and 6221
(commodity contracts)**. Entirely reasonable codes. Measured over a 120-day
window they matched **0 rows**, because the actual filers — `Canary Staked INJ
ETF`, `Bitwise NEAR ETF` — file under **6199, "Finance Services"**.

Had it shipped it would have excluded nothing, left both ETFs sitting in
"Upcoming IPOs", and read as correct to anyone reviewing the diff. The rule was
only caught because the probe **printed the match count**, and the count was zero.

### 3. `tickerMap.has(cik)` (`lib/server/ipoExclusions.ts`, 2026-09-15)

`company_tickers_exchange.json` is keyed by **symbol**; the CIK sits in the value.
The already-listed filter was written as:

```ts
tickerMap.has(cik)   // compiles. always false.
```

`Map<string, T>.has` accepts any string, so **the type system cannot object** —
and this filter is the load-bearing one: it removes **172 of 228** candidates.
Shipped, every already-listed issuer filing a resale registration would have
poured into "Upcoming IPOs", and the page would have looked *busier*, which is the
opposite of a symptom.

`tsc` did catch something — `entry.ticker` does not exist on `TickerEntry` — but
that was an **adjacent property access**, not the join. Remove that line and the
bug compiles clean. **It was found by luck.**

## Why the usual safety nets miss it

- **Types.** A wrong-direction map lookup is type-correct. A regex that matches
  nothing is type-correct. Predicates return `boolean` whether or not they are
  asking the right question.
- **Tests, unless written adversarially.** A fixture assembled by the same person
  who wrote the filter carries the same misunderstanding. The test passes.
- **Review.** `6726` and `6221` *look* like the right codes. So does
  `tickerMap.has(cik)`. Review catches implausible code, and this code is
  plausible — that is the whole problem.
- **The page.** It renders. It has rows, or it doesn't, and both are normal.

## What actually works

**Print the match count, and treat zero as a defect until proven otherwise.**
This is the only one of these that would have caught all three. It is why
`warnIfEntityFilterMatchedNothing()` exists, and why it says so in its own text:

> Crypto ETF and trust S-1 filings are near-continuous in this market. Zero
> matches across a full 90-day window means THE RULE BROKE — a SIC code moved, a
> naming convention shifted, or the field stopped being populated — not that the
> market went quiet.

It is the same reasoning as `warnIfImplausiblyEmpty()` in `feedCache.ts`, which
exists because *"a 30-day window with no US IPO listings is essentially never
true."* Both encode a **base rate**: if you know roughly how often a thing should
happen, you can tell a broken detector from a quiet world. Without that number
you cannot, and no amount of care substitutes for it.

Three supporting habits, in rough order of value:

1. **Measure the filter against real data before shipping it, and report the
   count, not the verdict.** The SIC rule was specified from plausibility and
   measured at zero. Ten minutes on a runner.
2. **Assert the join direction where types can't.** `scripts/check-ipo-exclusions.mjs`
   asserts the already-listed lookup goes through a CIK index, because `tsc`
   provably cannot. A guard is worth writing exactly where the compiler stops.
3. **Negative-control every guard.** A check that has never failed has not been
   shown to work. Each assertion in `check-ipo-exclusions.mjs` was verified by
   breaking the code, watching it fail, and restoring it.

## The tell

Whenever a predicate is written against a source nobody has sampled — a field
name from documentation, a code from a standards list, a key from a schema read
rather than printed — **ask what the count should be, then check it.** If the
answer to "how many should this match?" is "I don't know", the filter is not
finished, however correct it looks.

And a corollary from instance 3, worth its own sentence: **a compiler error near
a bug is not a test for that bug.** The `.ticker` access failing is what put eyes
on the join. Nothing about that was designed, and next time the adjacent line
will compile.
