# Step 3 — the stored field list, for approval before any extraction code

**Date:** 2026-09-14, revised 2026-09-15
**Status:** PROPOSAL. No extraction code written.
**Derived from:** `claude/hide-list-verdict-2026-09-13.md` §7 (the card requirements),
§1 (the tag chains), §2 (the cash-flow finding).
**Brief:** `claude/BRIEF-step3-extraction-and-retention-2026-09-14.md`

> **Revision note.** The first version of this list was derived from grep counts
> of field names in the tree — which measures what the code happens to reference
> today, not what the page needs. It is now derived from §7's cards. That moved
> the count from 35 to 43 and added `interestExpense`,
> `nonOperatingIncomeExpense`, `netIncomeToNoncontrollingInterest`,
> `dividendsDeclaredPerShare`, `deferredRevenue*`, `otherOperatingExpense` and
> `sharesOutstandingCover` — every one of which a card needs and a grep missed.

## 1. The principle

**Store what SEC filed. Derive what the page shows.**

There is no conditional check on `companyfacts` — `Last-Modified` and `ETag` both
absent, measured on every probe symbol — so a field added later cannot be
backfilled cheaply: it means re-reading the whole universe at ~150 KB wire each.
Storing an unused field costs bytes; omitting a needed one costs a full re-fetch.

The asymmetry cuts one way, so the list errs wide.

It also decides what is **not** stored. A wrong *derivation* should cost a
redeploy, never a re-fetch, so everything computable is computed at read time:

| Derived | From |
|---|---|
| Gross profit, gross margin | `revenue − costOfRevenue` |
| Operating / net margin | `operatingIncome`, `netIncome` ÷ `revenue` |
| Free cash flow | `operatingCashFlow − capex` |
| **Quarterly cash flow** | differencing consecutive YTD values (trap 1) |
| **Q4** | `FY − 9M` (trap 4) |
| YoY, QoQ | the 8-quarter window itself |
| Accruals / earnings quality | `operatingCashFlow − netIncome` |
| Net debt, coverage ratios | the debt, cash and interest fields |

Trap 1 says the differencing is the single most likely thing to be wrong.
Storing only its output would make fixing it a re-fetch of the universe.

## 2. The 43 fields, by the card that needs them

### Income statement — 16
`revenue` · `costOfRevenue` · `researchAndDevelopment` ·
`sellingGeneralAndAdministrative` · `otherOperatingExpense` · `operatingIncome` ·
`interestExpense` · `nonOperatingIncomeExpense` · `preTaxIncome` ·
`incomeTaxExpense` · `netIncome` · `netIncomeToNoncontrollingInterest` ·
`epsBasic` · `epsDiluted` · `sharesBasic` · `sharesDiluted`

*Cards: latest snapshot (revenue, EPS), growth & margins, full P&L, recent quarters.*

`netIncomeToNoncontrollingInterest` is here because the **pre-tax chain's two
tags differ precisely on minority interest** (§1). Without it, parent and total
cannot be reconciled and the chain's own ambiguity is unresolvable after the fact.

### Cash flow — 10
`operatingCashFlow` · `capex` · `shareBasedCompensation` ·
`depreciationAndAmortization` · `investingCashFlow` · `financingCashFlow` ·
`netChangeInCash` · `dividendsPaid` · `buybacks` · `dividendsDeclaredPerShare`

*Card: quality of earnings — the live card shows operating cash flow, free cash
flow, capex and stock-based comp.*

**Every one of these is YTD-cumulative** except in Q1 (trap 1). `investingCashFlow`,
`financingCashFlow` and `netChangeInCash` are included because they are what make
the cash-flow statement *checkable*: the three must reconcile to the change in
cash, which is a free arithmetic assertion on the differencing.

### Balance sheet — 17
`cash` · `shortTermInvestments` · `receivables` · `inventory` ·
`totalCurrentAssets` · `totalAssets` · `payables` · `totalCurrentLiabilities` ·
`shortTermDebt` · `longTermDebt` · `totalLiabilities` · `stockholdersEquity` ·
`goodwill` · `intangibleAssets` · `deferredRevenueCurrent` ·
`deferredRevenueNoncurrent` · `sharesOutstandingCover`

*Card: balance sheet, via the debt and investments chains.*

Balance-sheet items are **instant** concepts, not durations — they are never
cumulative and must not be differenced. That distinction is per-field, not
per-statement, and is the second half of trap 1.

`sharesOutstandingCover` is the cover-page count, **distinct from the weighted
averages** in the P&L block. Both are needed: per-share figures use the weighted
average, market cap uses the cover count.

### Chains needing more than one candidate — §1, unchanged

| Field | Try, in order |
|---|---|
| `revenue` | `RevenueFromContractWithCustomerExcludingAssessedTax` → `Revenues` → `SalesRevenueNet` |
| `costOfRevenue` | `CostOfRevenue` → `CostOfGoodsAndServicesSold` → `CostOfGoodsSold` |
| `preTaxIncome` | `…ExtraordinaryItemsNoncontrollingInterest` → `…MinorityInterestAndEquityMethod` |
| `shortTermInvestments` | `ShortTermInvestments` → `MarketableSecuritiesCurrent` → `AvailableForSaleSecuritiesDebtSecuritiesCurrent` |
| `longTermDebt` | `LongTermDebtNoncurrent` → `LongTermDebtAndCapitalLeaseObligations` → `LongTermDebt` |
| `cash` | `CashAndCashEquivalentsAtCarryingValue` → `CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents` |

`Revenues` is **legacy** — AAPL's last is 2018-09-29, MU's 2018-08-30, PLAB's
2018-10-31 — so it must sit *below* the contract-revenue tag, never above, or
every large filer renders 2018 revenue as current.

## 3. Per-period metadata — what makes traps 2, 3 and 4 auditable

| Field | Trap | Why |
|---|---|---|
| `fy`, `fp` | 4 | fiscal year and period; fiscal ≠ calendar (31 Mar, 26 Sep, 3 Sep, 31 Oct, 31 Dec across five probe symbols) |
| `start`, `end` | 1, 4 | the actual boundaries as filed — what differencing operates on |
| `form` | — | `10-Q` / `10-K` / `20-F` / `6-K` |
| `accession` | **3** | restatement resolution. Newest accession wins. |
| `filed` | 3 | tie-break and audit |
| `tax` | — | `us-gaap` or `ifrs-full`. ARM is an FPI; the taxonomy is not assumable. |
| `unit` | — | per period. A filer does not mix currencies within one statement, but an FPI may not report in USD. |
| `cum` | **1** | whether the cash-flow block is YTD-cumulative — **recorded at write time, not inferred at read time** |
| `ti` | **2** | which chain entry resolved, **per period** |

`ti` records the chain **index**, and only where the primary entry did *not* win —
absence means entry 0 resolved it. `chainVersion` sits at symbol level so a
reordered chain invalidates cleanly rather than silently changing what an index
means.

## 4. Encoding — positional, and the measurement that decided it

Measured on a representative 8-quarter + 5-year record:

```
named object per period ....... 19.7 KB   at the ~20 KB budget on day one
positional + field list ....... 10.2 KB   48% smaller
per archived year beyond 5 .... 1.51 KB named   vs   0.71 KB positional
at 15 archived years .......... 34.8 KB named   vs  17.3 KB positional
```

Field names repeat 13 times per symbol; that is half the payload. **The named
encoding is at the ceiling on day one and the series is append-only by decision**
— it grows forever. Positional fits the full wide list with room for decades.

**The risk is a silent misread** if a reader's field order differs from the
writer's, which is this project's recurring failure shape. Guard: a short
`fieldsHash` over the ordered field list is stored per symbol, and a reader whose
own hash differs must treat the record as **unreadable and re-fetch**, never
decode it positionally. That turns an order change from a wrong number into a
cache miss.

## 5. Open questions — answer before extraction is written

1. **Segment revenue.** §6 leaves it "the only open question left on the page",
   and the datasets probe failed for two stacked reasons (constructed URL, and
   ARM the wrong target as a 20-F filer — point it at AAPL or MU). **Not in this
   list.** It is the one omission that would be expensive, and the only field
   whose shape is not a scalar. Include a placeholder now, or accept a re-fetch
   later?
2. **`unit` per period — confirmed needed, or over-cautious?** Every probe symbol
   reports USD. ARM is an FPI and reports in USD; an FPI reporting in EUR or GBP
   would silently render foreign-currency figures as dollars. Cheap to store.
3. **Restatement history.** Trap 3 says newest accession wins. Should the
   superseded value be **kept** (an `amended` sibling) or discarded? Keeping it is
   the only way to show "restated from X" on the page, and it cannot be recovered
   later once an archived year is overwritten.
4. **`sharesOutstandingCover`** — is the cover-page count wanted alongside the
   weighted averages, or is market cap sourced elsewhere?

## 6. Validation

Every extracted number diffs against the **frozen FMP ground-truth dump**
(run `34776325456`) — the only independent check that exists. Every other number
on the page can be re-derived from filings forever; that one cannot.

**Not against hand-built fixtures.** §17 of `scripts/check-sec-daily-index.mjs`
is the worked example, and it cost a day and a half: a synthetic fixture produced
`{ periodic-report: 77, unconfirmed: 50 }` out of a modulo-5 round robin and was
reported as a replay of a real window.

Two assertions the traps give for free:

- **Trap 1:** a quarterly operating cash flow exceeding its own annual figure is
  arithmetically impossible.
- **Trap 4:** Q1 + Q2 + Q3 + Q4 must reconcile to FY for every stored year.

And one the field list adds: **operating + investing + financing must reconcile to
`netChangeInCash`** for every period — which tests the differencing directly.
