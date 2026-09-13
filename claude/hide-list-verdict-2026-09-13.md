# The hide list, answered — and it is not a hide list (2026-09-13)

Runs 2 and 3, `iad1`, preview, `secUserAgent.source: "env"`. Five symbols, all `ok: true`,
all CIKs resolved. This is the measurement the whole probe existed for.

---

## 1. The headline: nothing goes on a site-wide hide list

Per-symbol `trueHideList`:

| Symbol | Concepts with no SEC source |
|---|---|
| ARM | `Revenues`, `IncomeLoss…MinorityInterestAndEquityMethod`, `LongTermDebtNoncurrent` |
| **AAPL** | **none — empty** |
| MU | `IncomeLoss…ExtraordinaryItemsNoncontrollingInterest` |
| PLAB | `IncomeLoss…MinorityInterestAndEquityMethod` |
| ASTS | `SellingGeneralAndAdministrativeExpense` |

**The intersection across all five is empty.** Every tag that is missing for one filer is
present and quarterly for another. Not one column on the earnings page loses its source
universally.

The clearest case is pre-tax income, and it is the reason Code refused to guess which of the
two tags I meant:

```
IncomeLoss…ExtraordinaryItemsNoncontrollingInterest   ARM ✓  AAPL ✓  MU ✗  PLAB ✓  ASTS ✓
IncomeLoss…MinorityInterestAndEquityMethod            ARM ✗  AAPL ~  MU ✓  PLAB ✗  ASTS ~
```

Each is absent exactly where the other is present. Either one alone puts pre-tax income on
the hide list for part of the universe; together they cover all five.

### So the design changes shape

**Not a hide list — a resolver.** Each displayed field gets an ordered chain of candidate
tags, tried in order, first quarterly hit wins. Hiding becomes a per-symbol, per-render
decision when a chain comes up empty, not a site-wide flag.

Chains the data already dictates:

| Field | Try, in order |
|---|---|
| Revenue | `RevenueFromContractWithCustomerExcludingAssessedTax` → `Revenues` → `SalesRevenueNet` |
| Cost of revenue | `CostOfRevenue` → `CostOfGoodsAndServicesSold` → `CostOfGoodsSold` |
| Pre-tax income | `…ExtraordinaryItemsNoncontrollingInterest` → `…MinorityInterestAndEquityMethod` |
| Short-term investments | `ShortTermInvestments` → `MarketableSecuritiesCurrent` → `AvailableForSaleSecuritiesDebtSecuritiesCurrent` |
| Long-term debt | `LongTermDebtNoncurrent` → `LongTermDebtAndCapitalLeaseObligations` → `LongTermDebt` |
| Cash | `CashAndCashEquivalentsAtCarryingValue` → `CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents` |

Note `Revenues` is a **legacy tag** — AAPL's latest is 2018-09-29, MU's 2018-08-30,
PLAB's 2018-10-31. It stopped being used when ASC 606 landed. It must sit *below* the
contract-revenue tag in the chain, never above, or every large filer renders 2018 revenue
as current. That is the kind of error that looks like working software.

**This is a materially better outcome than the brief assumed.** The plan was "five columns
go behind a flag". The answer is "no columns go behind a flag; the tag mapping has to be
plural".

---

## 2. The finding that would have shipped a wrong number: cash flow is cumulative

Three concepts come back `sparse` — **2 or 3 quarterly periods in an 8-quarter window — for
every single symbol**, with no exceptions:

```
NetCashProvidedByUsedInOperatingActivities     ARM 3q  AAPL 2q  MU 2q  PLAB 2q  ASTS 2q
PaymentsToAcquirePropertyPlantAndEquipment     ARM 3q  AAPL 2q  MU 2q  PLAB 2q  ASTS 2q
ShareBasedCompensation                         ARM 3q  AAPL 2q  MU 2q  PLAB 2q  ASTS 2q
```

A uniform result across five unrelated filers is not five coincidences. **US cash-flow
statements are filed year-to-date cumulative, not per-quarter.** Q1's 10-Q covers 3 months,
Q2's covers 6, Q3's covers 9, the 10-K covers 12. Only Q1 is ever a true three-month period.

**The live Quality of Earnings card is built on quarterly cash flow** — "Operating cash flow
$902.0M · Free cash flow $694.0M · Capex −$208.0M · Stock-based comp $343.0M" for the
quarter ending 2026-06-30. Reading those straight out of `companyfacts` gives the
year-to-date figure, which for a Q3 filing is roughly **three times too large** and looks
entirely plausible on the page.

The remedy is differencing consecutive year-to-date values:

```
Q1 = the 3-month value as filed
Q2 = 6-month  − 3-month
Q3 = 9-month  − 6-month
Q4 = 12-month − 9-month
```

Code's reading guide flagged this for Q4 only ("derive Q4 from FY minus 9M"). **It is every
quarter except the first.** The probe already reports `annualPeriods`, `nineMonthPeriods`
and `sixMonthPeriods` per concept, so the inputs are all there.

This one is worth a check script of its own: a quarterly operating cash flow that exceeds
its own annual figure is arithmetically impossible and trivially assertable.

---

## 3. The timezone fitter did its job by failing loudly

| Symbol | Verdict | Agreement | Rollovers |
|---|---|---|---|
| ARM | **INDETERMINATE** — only 2 rollovers | 0.993 @ offset 5 | 2 |
| AAPL | "OFFSET 9h FROM EASTERN — unexplained" | 0.959 | 36 |
| MU | "OFFSET 9h FROM EASTERN — unexplained" | 0.983 | 14 |
| PLAB | "OFFSET 9h FROM EASTERN — unexplained" | 0.982 | 17 |
| ASTS | "OFFSET 10h FROM EASTERN — unexplained" | 0.952 | 21 |

Nine hours from Eastern is not a timezone EDGAR could plausibly be in. High agreement on a
meaningless offset is over-fitting: with only 4% of filings rolling over, an offset that
shifts many *non*-rollover filings across midnight can score well for the wrong reason.

**Do not build the price-reaction card on a fitted offset.** Read the raw timestamps
instead — they answer it directly:

```
ARM  2026-09-10T20:09:45Z  filingDate 2026-09-10   → 16:09 ET, after the close, no rollover ✓
ARM  2026-04-21T13:01:24Z  filingDate 2026-04-21   → 09:01 ET, before the open,  no rollover ✓
ARM  2026-03-24T21:11:56Z  filingDate 2026-03-24   → 17:11 ET, before 17:30,     no rollover ✓
```

Every one is consistent with the `Z` being genuine UTC, and ARM's own best fit is offset 5 —
Eastern standard time — at 0.993. So: **treat the timestamp as UTC, convert to Eastern with
a real timezone library, compare against the 16:00 ET close.** Deterministic, per filing, no
global verdict needed.

The fitter was built to stop a confident wrong answer reaching the card. It produced a
confident wrong answer and labelled it unexplained, which is exactly the behaviour that was
wanted. Keep the mechanism, discard this particular output.

---

## 4. ARM is a foreign private issuer, and the page is built on it

```
ARM   forms: ["20-F", "6-K"]   8-K filings: 0   fiscalYearEnd: 0331
AAPL  forms: ["10-K", "10-Q"]  8-K: 22
MU    forms: ["10-K", "10-Q"]  8-K: 27
PLAB  forms: ["10-K", "10-K/A", "10-Q", "10-Q/A"]  8-K: 22
ASTS  forms: ["10-K", "10-Q", "10-K/A", "10-Q/A"]  8-K: 57
```

ARM files **20-F annually and 6-K for quarterly results** — no 10-Q, no 8-K at all. The
example page this whole exercise is built around is an FPI, and plenty of Nasdaq-listed
names are.

Consequences the pipeline has to carry:

- **The periodic-filing detector cannot key on 10-Q/10-K alone.** 6-K and 20-F must be in
  the set or ARM never updates.
- **The 8-K Item 4.02 restatement idea is dead for FPIs** — ARM has filed zero 8-Ks. The
  `/A` suffix rule from 6c still covers them (`20-F/A` exists as a form type).
- ARM's 6-Ks come in pairs on the same day, one carrying the period-end report date and one
  carrying the filing date. Deduplicate on `accn`, and prefer the one whose `reportDate` is
  a quarter end.
- Fiscal years are all over the place — 31 Mar, 26 Sep, 3 Sep, 31 Oct, 31 Dec across five
  symbols. Nothing may assume calendar quarters.

---

## 5. Payload sizes, and a correction to yesterday's arithmetic

```
            wire (gzip)   parsed
ARM           50.8 KB     720 KB
AAPL         271.8 KB     3.79 MB
PLAB         224.7 KB     3.23 MB
MU              —         4.08 MB
ASTS            —         1.12 MB
```

**Roughly 14× compression.** My Layer 3 sweep estimate of ~500 MB used the parsed size and
is wrong on the axis that matters: bandwidth follows the wire figure, ~250 KB for a large
filer, so a full 700-symbol verification sweep is **≈175 MB, not 500 MB**. A nightly sweep
becomes arguable again rather than clearly unaffordable — though a 30-day rotation is still
the sensible default given there is nothing to gain from checking daily.

The parsed figure is still the one that governs **function memory** on a cold render, and
4 MB for MU is the number to design the queue-and-drain around.

---

## 6. Datasets: wrong URL, and the wrong target symbol

```
month derived from: ARM's 20-F filed 2026-05-26  →  2026_05
https://www.sec.gov/files/dera/data/financial-statement-and-notes-data-sets/2026_05_notes.zip
HEAD → 404
```

Two problems stacked, and the month derivation is not one of them — it worked exactly as
designed.

- **The URL is constructed, not discovered.** A 404 here says the filename pattern is wrong,
  nothing more. The fix is to read the directory listing and match, rather than guess a
  naming convention that SEC has changed before.
- **ARM is the wrong target for this section.** It is a 20-F filer, so its segment
  disclosures sit differently from the 10-K filers the datasets are mostly built around.
  Point this section at AAPL or MU.

Segment revenue remains unanswered. It is the only open question left on the page.

---

## 7. Where the earnings page now stands

| Card | Verdict |
|---|---|
| Latest snapshot — revenue, YoY growth | **free**, via the revenue chain |
| Latest snapshot — EPS, estimates, surprise | consensus — unchanged, still the real gap |
| Growth & margins | **free** |
| Quality of earnings (cash) | **free, but must difference YTD values** — §2 |
| Balance sheet | **free**, via the debt and investments chains |
| Full P&L | **free**, via the cost and pre-tax chains |
| Revenue breakdown by segment | **unresolved** — §6 |
| Price reaction | free once bars are settled; timing per §3, not the fitter |
| Recent quarters table | actuals free, estimate columns not |
| Forward consensus | consensus — unchanged |

**No column is hidden for lack of a source.** The hidden set is exactly what it always was:
analyst consensus. Everything the company itself files is available, for every symbol tested,
once the tag chains and the cash-flow differencing are built.
