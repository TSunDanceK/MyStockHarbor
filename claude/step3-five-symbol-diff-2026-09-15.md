# Step 3, step 2 — the five-symbol extraction, diffed against the frozen FMP dump

**Run:** relay `sec-extract`, workflow run
[34931769452](https://github.com/TSunDanceK/MyStockHarbor/actions/runs/34931769452),
head `d3dd7e5`, 2026-09-15 05:12 UTC.
**Dump:** run `34776325456`, artifact `step0-dump`, dumpedAt 2026-09-13T19:00:23Z
(earnings-rows 1,237 present, stockdata 759 present).
**Symbols:** ARM, AAPL, MU, PLAB, ASTS. `fieldsHash 60043626`.

Extraction lifted from the shipped `lib/server/secFields.ts` + `lib/server/secExtract.ts`,
not reimplemented.

---

## 1. What the ground truth can and cannot cover — MEASURE THIS FIRST

The dump is a dump of **what FMP had put in Redis**, and FMP put four numbers per
report (`msh:pickers:earnings:v1` — `epsActual`, `epsEstimated`, `revenueActual`,
`revenueEstimated`) plus six TTM aggregates (`msh:stockdata:v1`). **It never held a
balance sheet.**

So of the 43 stored fields, **8 have ground truth and 35 have none**, and no run
against this dump can ever change that. "No differences found" over 8 fields is not
evidence about the other 35, and the probe now prints the 35 by name so that reading
is unavailable.

Coverage is also uneven per symbol: ARM and PLAB have **no `stockdata` row at all**,
PLAB has **zero earnings rows**, ASTS has 30 earnings rows but no revenue to compare.

---

## 2. What validated — and it is the part that matters

### Revenue: 33 of 33 mapped quarters AGREE at 0.00%

Across four filers with four different fiscal calendars (31 Mar, 26 Sep, 3 Sep,
31 Dec), every quarter FMP has a `revenueActual` for matches the extraction to the
dollar. **Including the derived Q4s**, which is the trap the whole design is about:

| symbol | quarter | derivation | SEC | FMP |
|---|---|---|---|---|
| ARM | 2026-03-31 | **differenced** (FY − 9M) | 1,490.0M | 1,490.0M |
| AAPL | 2025-09-27 | **differenced** | 102,466.0M | 102,466.0M |
| MU | 2025-08-28 | **differenced** | 11,315.0M | 11,315.0M |

### AAPL's TTM aggregates agree exactly, free cash flow included

```
revenue (TTM)          SEC 466,823.0M   FMP 466,823.0M   0.00%
operatingIncome (TTM)  SEC 154,859.0M   FMP 154,859.0M   0.00%
netIncome (TTM)        SEC 128,930.0M   FMP 128,930.0M   0.00%
freeCashFlow (TTM)     SEC 136,683.0M   FMP 136,683.0M   0.00%
epsTtm                 SEC       8.71   FMP       8.7752 0.74%
divPerShare (TTM)      SEC       1.05   FMP       1.06   0.94%
```

`freeCashFlow` matching to the dollar is the strongest single result in the run:
it is `operatingCashFlow − capex` summed over four quarters, **three of which were
differenced**, so an error anywhere in the year-to-date arithmetic would show up
here and does not.

MU: revenue 0.00%, netIncome 0.00%, freeCashFlow 0.00%, operatingIncome 0.17%.

### The EPS gap is GAAP vs adjusted, and SEC is the one that is right

EPS differs on 20 rows, **always in the same direction** (FMP ≥ SEC) and largest
exactly where a large GAAP charge sits. The clearest case:

```
AAPL  report 2024-10-31 -> quarter 2024-09-28
      epsDiluted  SEC 0.97   FMP 1.64   DIFFER 40.85%
```

That is the €10.2B EU State Aid charge, and the extraction **corroborates it from
its own output**: `incomeTaxExpense` for that quarter reads 14,874.0M against
~5,000M in every neighbouring quarter. $0.97 is AAPL's GAAP diluted EPS; $1.64 is
the ex-charge figure. **The largest single disagreement in the whole run is a case
where the SEC extraction is correct and the FMP number is not GAAP.**

ARM (GAAP 0.25 vs FMP 0.45) and MU (0.80 vs 1.18) are the same story — both report
heavy non-GAAP adjustments. AAPL, which barely adjusts, agrees on 7 of 8 quarters.

---

## 3. DEFECTS FOUND — two are real bugs in code written today

### D1 — `sharesBasic` / `sharesDiluted` are being DIFFERENCED, and must not be

A weighted average over a period is **not additive**. `9M_avg − 6M_avg` is not the
Q3 average, and the output says so plainly:

```
PLAB  sharesBasic    25-10-31  -668,000 D      24-10-31    45,000 D
ARM   sharesBasic    26-03-31   1.0M    D      25-03-31     1.0M  D
ASTS  sharesBasic    25-12-31   9.5M    D      24-12-31    15.0M  D
AAPL  sharesBasic    25-09-27  -44.4M   D      24-09-28   -57.3M  D
```

A negative share count. It affects **every symbol, on every differenced quarter** —
4 of the 8 quarters for each. The `kind` flag caught the balance sheet and missed
this, because these two are durations that are cumulative in neither sense.

**Proposed fix — a third `kind`.** `"duration-average"`: read as filed when the
filer published that exact frame, and otherwise **left null rather than derived**.
The weighted identity `Q4 = 4·FY − 3·9M` exists and is arithmetically sound for
equal-length quarters, but it is a second derivation with its own failure mode and
is not worth introducing to fill one cell. Null is honest; −668,000 is not.

### D2 — the instant series is polluted by cover-page dates

`dei:EntityCommonStockSharesOutstanding` is measured at the **cover date**, which
for most filers is 2–4 weeks after the period end. Those dates enter the instant
series as their own periods carrying nothing but that one field, and `slice(0, 8)`
then returns **4 balance sheets and 4 near-empty rows**:

```
AAPL  cash                   — 39544.0M —  45572.0M —  45317.0M —  35934.0M
AAPL  sharesOutstandingCover 14594.2M —  14687.4M —  14681.1M —  14776.4M —
```

ARM and ASTS are unaffected only because their cover dates happen to fall on the
period end. So retention of "8 quarters" currently stores **4** balance sheets for
AAPL, MU and PLAB and 8 for ARM and ASTS — a silent, per-filer halving.

**Proposed fix.** Key the balance sheet to the **quarter end dates the duration side
already established**, and carry `sharesOutstandingCover` as its own dated field
rather than as a member of the instant grid. It is not a balance-sheet line; it only
lives there because it is an instant.

### D3 — EPS is differenced too, and it is a ratio, not a sum

This one is *approximately* right and the diff proves it: AAPL's differenced Q4
reads 1.84 against FMP's 1.85 (0.54%), and the residual is the within-year drift of
the weighted share count. It is not wrong enough to show as a defect and not right
enough to leave undeclared. Either mark it `duration-ratio` and keep the
approximation with the caveat recorded, or recompute it as `netIncome / sharesDiluted`
once D1 gives that denominator honestly. **Owner's call.**

### D4 — the cash-flow reconciliation is missing its FX leg

Breaks: ARM 6, MU 6, PLAB 8, ASTS 1. Nearly all are small absolute differences on a
small `netChangeInCash` denominator — ARM 2026-03-31 reads 17.9% on a $10M gap. The
cause is structural: `netChangeInCash`'s first chain entry is
`...PeriodIncreaseDecreaseIncludingExchangeRateEffect` while the three activity
totals exclude FX. The assertion needs
`EffectOfExchangeRateOnCashAndCashEquivalents` as a fourth term before it can be
trusted as a check rather than read as noise.

### D5 — chain gaps, found on real filers rather than guessed at

| field | missing for | likely tag |
|---|---|---|
| `payables` | MU | `AccountsPayableAndAccruedLiabilitiesCurrent` |
| `epsBasic` / `epsDiluted` | ASTS (all 8 quarters) | `EarningsPerShareBasicAndDiluted` |
| `revenue` | ASTS (7 of 8) | — needs looking at |
| `operatingIncome` | ASTS (all 8) | ASTS may not tag `OperatingIncomeLoss` |
| `interestExpense` | AAPL, MU, PLAB | — |
| `nonOperatingIncomeExpense` | ARM, MU, PLAB | — |
| `longTermDebt` | PLAB reads `4,000` then `3.9M` | chain may be picking a stray |

Genuinely absent rather than a gap: AAPL `goodwill`/`intangibleAssets` (it tags
neither), ARM `shortTermDebt`/`longTermDebt` (no debt), ARM/ASTS `dividendsPaid`.

**Coverage on the newest period:** ARM 31/43, MU 24/43, PLAB 22/43, ASTS 31/43.
Part of that shortfall is D2 (the balance sheet landing on the wrong row) and part
is D5.

### D6 — two defects in the probe's own reporting, not the extraction

- **The SUMMARY tally silently drops the EPS verdicts.** It printed
  `{"AGREE":33,"CLOSE":4,"NO-GT":8}` with **no `DIFFER` at all**, while 20 EPS rows
  DIFFER on the lines above it. The tally reduced each quarter row to its `revenue`
  verdict. A reader who trusted the tally would have read this run as clean.
- **The report→quarter window is too wide.** At 120 days it mapped MU's *scheduled*
  2026-09-22 report back onto the 2026-05-28 quarter (`+117d`), producing a spurious
  NO-GT row. Narrowed to 75 days, which still clears ARM's real +37d.

---

## 4. What the guards did

The mid-year tag-change guard fired and **refused to difference** rather than
subtracting one concept from another: AAPL 17 notes, MU 14, PLAB 14, ASTS 5. Every
one is a real boundary — `Revenues → SalesRevenueNet →
RevenueFromContractWithCustomerExcludingAssessedTax` for MU across 2016–2017,
`NetCashProvidedByUsedInOperatingActivities ↔ ...ContinuingOperations` for all four,
`NetIncomeLoss ↔ ProfitLoss` for ASTS in 2021. These are in archived years and cost
nothing now, but they are the ASC 606 mechanism working on real data.

The multi-class `ambiguous` branch was **not exercised** — none of the five is a
multi-class filer. It remains tested only against the check's own rows.
