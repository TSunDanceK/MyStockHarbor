# Step 3, step 2 — the five-symbol extraction, diffed against the frozen FMP dump

> **2026-09-23 (#552, COWORK #4):** FMP values in this doc are redacted as
> "[removed 2026-09-23]". The SEC values and the findings are kept.

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
| ARM | 2026-03-31 | **differenced** (FY − 9M) | 1,490.0M | [removed 2026-09-23] (matched) |
| AAPL | 2025-09-27 | **differenced** | 102,466.0M | [removed 2026-09-23] (matched) |
| MU | 2025-08-28 | **differenced** | 11,315.0M | [removed 2026-09-23] (matched) |

### AAPL's TTM aggregates agree exactly, free cash flow included

```
revenue (TTM)          SEC 466,823.0M   FMP [removed 2026-09-23]   0.00%
operatingIncome (TTM)  SEC 154,859.0M   FMP [removed 2026-09-23]   0.00%
netIncome (TTM)        SEC 128,930.0M   FMP [removed 2026-09-23]   0.00%
freeCashFlow (TTM)     SEC 136,683.0M   FMP [removed 2026-09-23]   0.00%
epsTtm                 SEC       8.71   FMP [removed 2026-09-23] 0.74%
divPerShare (TTM)      SEC       1.05   FMP [removed 2026-09-23] 0.94%
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
      epsDiluted  SEC 0.97   FMP [removed 2026-09-23]   DIFFER 40.85%
```

That is the €10.2B EU State Aid charge, and the extraction **corroborates it from
its own output**: `incomeTaxExpense` for that quarter reads 14,874.0M against
~5,000M in every neighbouring quarter. $0.97 is AAPL's GAAP diluted EPS; FMP's figure ([removed 2026-09-23]) is
the ex-charge figure. **The largest single disagreement in the whole run is a case
where the SEC extraction is correct and the FMP number is not GAAP.**

ARM (GAAP 0.25 vs FMP [removed 2026-09-23]) and MU (GAAP 0.80 vs FMP [removed 2026-09-23]) are the same story — both report
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
reads 1.84 against FMP's [removed 2026-09-23] (0.54%), and the residual is the within-year drift of
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

---

## 5. After the fixes — run [34945335355](https://github.com/TSunDanceK/MyStockHarbor/actions/runs/34945335355), head `bf82efc`

### CORRECTION to §2 above

I reported **"revenue: 33 of 33 mapped quarters AGREE"**. The quarter figure was
**25/25**. The 33 was 25 quarter revenues plus 8 TTM aggregates, conflated by a
tally that took one verdict per row — the same defect recorded as D6. Every
revenue comparison did agree at 0.00%, which is what the conclusion rested on;
the count attached to it was wrong.

### D1 / D1b — fixed and measured

```
sharesBasic    {"as-filed":6,"null":2}   negative: 0     x5 symbols
sharesDiluted  {"as-filed":6,"null":2}   negative: 0     x5 symbols
epsBasic       {"as-filed":6,"null":2}   negative: 0     (ASTS: computed 6)
epsDiluted     {"as-filed":6,"null":2}   negative: 0     (ASTS: computed 6)

null rate: 10/40 (25%) on each of the four, identical for every symbol
```

**25% is exactly right, and it is the cost stated plainly:** eight quarters
contain two Q4s, Q4 is never filed as a three-month frame, and nothing is
derived to fill it. So **the recent-quarters table will show a blank EPS and a
blank share count on one quarter in four.** No negative share counts anywhere.

ASTS shows `computed: 6` because it publishes only `EarningsPerShareBasicAndDiluted`
and that chain entry now exists — the value is `netIncome / sharesBasic` for the
same quarter, and it is negative on all six because ASTS loses money. The probe's
first version asserted "never negative" on all four fields and failed ASTS six
times for being accurate; that assertion is now scoped to the share counts.

### D2 — fixed, and the owner's assertion passes on all five

```
[D2] PASS instant series holds 8 balance-sheet dates (want 8)   x5
[D2] PASS no period row carries only one field                  x5
STRUCTURAL ASSERTIONS: 40/40 pass
```

Previously AAPL, MU and PLAB stored four. `coverShares` is now symbol-level with
its own asOf: ARM 2026-03-31, AAPL 2026-07-17, MU 2026-06-17, PLAB 2026-09-03 —
three of the five sit well after the period end, which is exactly why they were
displacing balance sheets.

### Section 2 — the five identities, pass rates over 5 symbols

| identity | pass | fail | skipped | of checkable |
|---|---|---|---|---|
| `assets = liabilities + equity` | 40 | 0 | 0 | **100%** |
| `grossProfit = revenue − costOfRevenue` | 32 | 0 | 8 | **100%** |
| `operatingIncome = grossProfit − operatingExpenses` | 27 | 5 | 8 | 84% |
| `operating + investing + financing + fx = netChangeInCash` | 39 | 1 | 0 | 98% |
| `cashEnd − cashStart = netChangeInCash` | 32 | 3 | 5 | 91% |

Two of these were at 80% and 86% before the run above, and **both failures named
their own cause:**

- **PLAB failed the balance sheet on 8 of 8 by ~23%.** It carries a large
  noncontrolling interest; the identity balances only against TOTAL equity.
  `totalEquity` is now a separate field — merging it into `stockholdersEquity`
  would have fixed the identity by changing what the page calls equity.
- **MU failed the cash identity twice and ASTS three times, once by 27.5%.**
  `netChangeInCash` is filed against one of two cash concepts and the balance was
  always read on the plain one. The winning tag is on the cell, so the identity
  reads it and picks the matching balance; `cashIncludingRestricted` exists to
  have one to pick.

### What still fails, with its residual

- **`operatingIncome`, 5 of 32** — ARM −7.0M and −6.0M, MU −39M, −112M, −33M.
  Always negative, which means the stored opex breakdown does not capture
  everything those filers expense (restructuring, impairments, amortisation of
  intangibles). **It does not make `operatingIncome` wrong** — that is taken as
  filed. It means the P&L's own lines will not sum to it for those quarters, and
  the page must not present the breakdown as complete.
- **`cashEnd − cashStart`, 3 of 35** — all ASTS, residuals 64M / 21M / 20M on
  multi-billion balances.
- **the cash-flow reconciliation, 1 of 40** — ASTS 2025-06-30, residual 1.2M.

### The frame diagnostic answered the ASTS gaps — they are not chain gaps

Last run left three "the chain names a tag the filer publishes, yet nothing came
through" puzzles, and I was about to guess at new tags. Printing the frames each
tag actually carries settled all three:

```
!! OperatingIncomeLoss IS published — USD[17] 2020-07-01..2020-09-30 ... 2021-01-01..2021-03-31
!! EffectOfExchangeRateOnCashAndCashEquivalents IS published — USD[8] 2021-01-01..2021-06-30 ... 2022-01-01..2022-03-31
!! RevenueFromContractWithCustomerExcludingAssessedTax IS published — USD[29] ... mostly annual, through 2024
```

**ASTS stopped tagging all three years ago.** The extraction is right to leave
them null and the identities are right to report `skipped`. No chain change is
warranted, and one would have been made without this.
