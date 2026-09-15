# Step 3 — the stored field list, for agreement before any extraction code

**Date:** 2026-09-14
**Status:** PROPOSAL. Nothing built against it yet.
**Brief:** `claude/BRIEF-step3-extraction-and-retention-2026-09-14.md`

## 1. The principle that decides the list

**Store what SEC filed. Derive what the page shows.**

Because there is no conditional check on `companyfacts`, a missing field costs a
full universe re-fetch (~150 KB wire × ~700 symbols). A wrong *derivation* should
cost a code change, not a re-fetch — so the raw inputs to every derived figure
are stored, and the derivation happens at read time.

Concretely, these are **not stored** because they are recomputable from what is:

| Derived | From |
|---|---|
| Gross profit, gross margin | revenue − costOfRevenue |
| Operating margin, net margin | operatingIncome / netIncome ÷ revenue |
| Free cash flow | operatingCashFlow − capex |
| Quarterly cash flow | differencing consecutive YTD values (trap 1) |
| Q4 | FY − 9M (trap 4) |
| YoY / QoQ | the 8-quarter window itself |

If the differencing logic is wrong — and trap 1 says it is the single most
likely thing to be wrong — it is fixed and redeployed. Storing only the derived
quarterly figure would make that a re-fetch of the universe.

## 2. The fields — 35 raw values per period

Erring wide, as instructed. Every one has either a current consumer or an
obvious near-term one.

### Income statement (12)
`revenue` · `costOfRevenue` · `researchAndDevelopment` ·
`sellingGeneralAndAdministrative` · `operatingIncome` · `preTaxIncome` ·
`incomeTaxExpense` · `netIncome` · `epsBasic` · `epsDiluted` · `sharesBasic` ·
`sharesDiluted`

### Balance sheet (14)
`cash` · `shortTermInvestments` · `receivables` · `inventory` ·
`totalCurrentAssets` · `totalAssets` · `payables` · `totalCurrentLiabilities` ·
`shortTermDebt` · `longTermDebt` · `totalLiabilities` · `stockholdersEquity` ·
`goodwill` · `intangibleAssets`

### Cash flow (9)
`operatingCashFlow` · `capex` · `shareBasedCompensation` ·
`depreciationAndAmortization` · `dividendsPaid` · `buybacks` ·
`investingCashFlow` · `financingCashFlow` · `netChangeInCash`

**Current consumers, counted in the tree:** revenue (79 references), netIncome
(27), operatingIncome (19), eps (16), grossProfit (15), freeCashFlow (13),
epsDiluted (12), operatingCashFlow (11), costOfRevenue (8), capex (7),
operatingMargin (3), grossMargin (3). The balance-sheet block is the widest part
of the proposal and the least currently used — which is exactly where erring wide
is cheap and erring narrow is not.

### Chains needing more than one candidate

From `hide-list-verdict` §1, unchanged:

| Field | Try, in order |
|---|---|
| `revenue` | `RevenueFromContractWithCustomerExcludingAssessedTax` → `Revenues` → `SalesRevenueNet` |
| `costOfRevenue` | `CostOfRevenue` → `CostOfGoodsAndServicesSold` → `CostOfGoodsSold` |
| `preTaxIncome` | `…ExtraordinaryItemsNoncontrollingInterest` → `…MinorityInterestAndEquityMethod` |
| `shortTermInvestments` | `ShortTermInvestments` → `MarketableSecuritiesCurrent` → `AvailableForSaleSecuritiesDebtSecuritiesCurrent` |
| `longTermDebt` | `LongTermDebtNoncurrent` → `LongTermDebtAndCapitalLeaseObligations` → `LongTermDebt` |
| `cash` | `CashAndCashEquivalentsAtCarryingValue` → `CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents` |

## 3. Per-period metadata — the part that makes traps 2, 3 and 4 auditable

Each period carries, alongside its values:

| Field | Why |
|---|---|
| `fy`, `fp` | fiscal year and period (`Q1`–`Q4`, `FY`) — **trap 4**, fiscal ≠ calendar |
| `start`, `end` | the actual period boundaries, as filed |
| `form` | `10-Q` / `10-K` / `20-F` / `6-K` |
| `accession` | **trap 3** — restatement resolution. Newest accession wins. |
| `filed` | tie-break and audit |
| `tax` | `us-gaap` or `ifrs-full`. ARM is an FPI; the taxonomy is not assumable. |
| `cum` | 1 if the cash-flow block is year-to-date cumulative — **trap 1**, recorded rather than inferred at read time |
| `ti` | **trap 2** — which chain entry resolved, PER PERIOD |

### `ti`, and why it is an index rather than a tag string

Trap 2 requires per-period resolution, so a single hoisted tag map per symbol is
**wrong** — AAPL's revenue resolves to `Revenues` before 2018 and to the
contract-revenue tag after. But storing the full tag string per value is
expensive. Measured on a representative 13-period record:

```
per-value tag strings ................ 44.1 KB   — over budget
tags hoisted to one map per symbol ... 18.1 KB   — in budget, but WRONG per trap 2
per-period chain INDEX ............... 24.1 KB   — over budget
...omitting ti where entry 0 won ..... 15.5 KB
...realistic fallback mix ............ 15.7 KB   — against a ~20 KB budget
```

So `ti` records the chain index only for fields where the **primary entry did
not win**. Absence means "entry 0 resolved it", which is both the common case
and self-documenting. `chainVersion` sits at symbol level so a reordered chain
invalidates cleanly rather than silently changing what an index means.

## 4. Size

**15.7 KB per symbol** at 8 quarters + 5 fiscal years, measured on the shape
above rather than estimated — against the ~20 KB budget and the owner's ~9 KB
figure for a narrower list. The extra ~7 KB buys 35 raw fields instead of the
displayed subset, and per-period chain provenance.

**Append-only changes this over time.** The annual series grows without bound by
design: +5 years is the starting state, not the steady state. At ~1.2 KB per
archived year, a symbol held for a decade adds ~6 KB. Worth a size assertion that
scales with year count, not a fixed bound.

## 5. Open questions before this is agreed

1. **Segment revenue.** The probe answered the dimensional-axis question
   (`claude/segments-answered-2026-09-13.md`). Not in this list. In or out?
   It is the one field whose omission would be expensive and whose shape is not
   a scalar.
2. **Deferred revenue / RPO.** Not listed. Cheap to add now, a re-fetch later.
3. **`sharesOutstanding` as of the cover date** — distinct from the weighted
   average `sharesBasic`/`sharesDiluted` in the list. Both, or just the weighted?
4. **Units.** Everything above assumes USD. An FPI reporting in another currency
   needs a `unit` per value or per period. Recommend **per period**, since a
   filer does not mix currencies within one statement.

## 6. Validation, per the brief

Every extracted number diffs against the **frozen FMP ground-truth dump** — not
against hand-built fixtures. §17 of `scripts/check-sec-daily-index.mjs` is the
worked example: a synthetic fixture produced `{ periodic-report: 77,
unconfirmed: 50 }` out of a modulo-5 round robin and was reported as a real-window
replay for days.

Two assertions the traps hand us for free:

- **Trap 1:** a quarterly operating cash flow exceeding its own annual figure is
  arithmetically impossible.
- **Trap 4:** Q1 + Q2 + Q3 + Q4 must reconcile to FY for every stored year.
