# Two findings from the live picker-structure run

Both measured. Neither is a trading judgement, and **nothing below is changed** —
each needs a decision that is the owner's.

---

## A. `dynamicBoost` is the deciding term on /overbought-stocks-today, not a tiebreaker

**Yes, it applies to the section rank on that page**, and the magnitude is
2–4× the gap it decides.

### The mechanism, traced

```
pickersBuilder.ts:2655   dynamicBoost = (isDynamicUniverse ? 10 : 0) + (isPopularSearch ? 10 : 0)
pickersBuilder.ts:2741   red.push({ ..., _score: overboughtCandidate.score + dynamicBoost(symbol) })
takeTop                  sorts by _score DESC, slices 20
page config              kind "preset" + sectionIncludes ["overbought"]
PickerResultPage         the sectionIncludes block re-applies the section's rank to the page
```

So the boost is inside the number that decides membership of the top 20, and the
section's ordering is what the page shows. It is not applied after the cut, and
it is not a tiebreaker within it.

### The magnitude, against the observed gap

Owner's live run: **ARGX 96.43 at rank 20, MRK 91.68 at rank 25** — 4.75 points
across the five ranks either side of the cut.

| boost | vs the 4.75-point gap |
|---|---|
| +10 (dynamic universe) | **2.1×** |
| +20 (dynamic + popular search) | **4.2×** |

### The part that matters more than the ratio

`takeTop` reports `score` as `Math.round(_score)`, so **the figures above already
include the boost**. Stripping it does not shuffle the order slightly — it can
inverts it:

- MRK is `source: "preset"`, so it carries **+0**. Its raw composite is 91.68.
- ARGX is one of the 20 dynamic names, so it carries **+10 or +20**. Its raw
  composite is therefore **86.43 or 76.43** — in either case *below* MRK's.

On the raw composite, the name at rank 25 outscores the name at rank 20. The
boost is not adjusting a close call; it is producing the cut.

### Supporting evidence, same run

37 symbols carry `RSI >= 70`, `compOverbought >= 4`, `compOversold = 0` and
appear on neither page. Six sit at the maximum `compOverbought` of 6:

| symbol | RSI | rank |
|---|---|---|
| A | 80.53 | 29 |
| MRK | 77.85 | 25 |
| ABT | 77.80 | 70 |
| HMC | 75.69 | 51 |
| TMO | 74.64 | 30 |
| SQM | 72.82 | 22 |

Meanwhile **HOOD at RSI 62.5 is shown at rank 15**.

### The decision

A popularity term deciding membership of a page named *Overbought Stocks Today*
is either a deliberate product choice the page should state, or a bug. It cannot
be neither. Three shapes, in rough order of how much they change:

1. **State it.** Keep the behaviour, and say on the page that the list favours
   widely-followed names. Cheapest, and honest.
2. **Demote it to a tiebreaker.** Rank on the raw composite and use
   `dynamicBoost` only to break ties — which is what its name suggests it
   already does.
3. **Remove it from these two pages.** Keep it wherever a popularity lean is
   wanted; drop it where the page name makes a technical claim.

Not doing any of them until the owner picks.

---

## B. `rankNoStructureWaived` and `rankNoStructurePenalised` cannot differ

Reported as identical across all 402 rows. **They are identical by construction**
— not rarely triggered.

### Proven from the source, not inferred from the data

`StructureMode` has three values (`pickersBuilder.ts:1940`). Every comparison
against it in the scoring functions tests only `mode === "live"`:

```
:2047   const keep = mode === "live" ? 1 : 1 - STRUCTURE_WEIGHT;
:2053   (mode === "live" ? clamp(structureScore, 0, 100) * STRUCTURE_WEIGHT : 0)
:2143   (the same two lines in computeOverboughtCandidate)
:2149
```

There is **no comparison against `"no-structure-penalised"` anywhere in the
file**. Both non-live modes take the same `keep`, and both zero the same
structure term. Zero differences in 402 rows is what that produces; a larger
universe would produce zero differences too.

### What was meant, and where it went

The comment at `:2039` describes behaviour that was never implemented:

> *"Under `no-structure-penalised` an unassessable trend takes the penalty
> instead — not-yet-qualified rather than passing."*

The code beneath it:

```js
const structurallyWeak = trendScore
  ? !trendScore.priceAboveMA200 && !trendScore.ma50AboveMA200
  : true;
if (structurallyWeak) penalty += 10;
```

`trendScore === null` yields `true` **in every mode**, so the penalty is applied
unconditionally and "waived" never waives anything. The intended difference — a
mode where an unassessable trend is treated as not-yet-qualified rather than as
fine — would need `mode` in that expression, and it is not there.

Same family as `recencyScore = 100` adding a flat 5.00 to every candidate
(`:2033`): a term that reads as considered and does no work.

### Why it matters even though nothing renders it

`/api/debug/picker-structure` exists to answer "what would the ranking look like
without the structure term". Right now it answers that question twice with the
same number under two names, which reads as *"we tried it both ways and it makes
no difference"* — a much stronger and entirely false claim than *"one of the two
ways was never built"*.

### The decision

Either implement the penalised mode (`mode === "no-structure-penalised"` in the
`structurallyWeak` expression), or delete it and its column so the debug route
stops offering an answer it does not have. **Reported, not fixed** — but the
comment should not be left describing behaviour the code has never had.
