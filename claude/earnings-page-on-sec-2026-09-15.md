# The earnings page on SEC data — what moved, what did not, 2026-09-15

> **THIS IS NOT A COMPLETE MIGRATION OFF FMP.** Everything price-derived is
> untouched and still on FMP: market cap, P/E, the price-reaction card, and the
> daily bars behind it. The bars have not moved. Read §4 before assuming the FMP
> licence can lapse.

## 1. What now renders from SEC filings

Every financial number on `/stock/{symbol}/earnings`:

| card | source |
|---|---|
| Latest snapshot — revenue, GAAP EPS, operating income, net income, YoY on each | SEC fact set |
| Growth & margins — revenue/EPS YoY and gross/operating/net margin per quarter | SEC fact set |
| Quality of earnings — operating cash flow, capex, free cash flow, accruals, SBC | SEC fact set |
| Balance sheet — cash, investments, debt, net cash, current ratio, A/L/E | SEC fact set |
| Full P&L — the 16-line waterfall for the latest quarter | SEC fact set |
| Recent quarters — eight quarters, actuals only | SEC fact set |
| Earnings score | recomputed from the SEC fact set (§3) |

One Redis `GET` per render. `lib/server/secFactStore.ts`.

## 2. What is HIDDEN, not removed

The owner's standing rule: a column that loses its source is hidden with a
comment at the point of hiding recording what went away and when, so a future
deploy cannot switch one back on and ship an empty column. Registry:
`RETIRED_SOURCES` in `lib/server/secEarningsView.ts`.

| id | what | why |
|---|---|---|
| `eps-estimate` | EPS estimate and surprise | No free source for analyst consensus |
| `revenue-estimate` | Revenue estimate and surprise | Same |
| `forward-consensus` | Forward full-year consensus | Not in filings; guidance is 8-K prose |
| `quarter-estimate-columns` | Estimate columns in the recent-quarters table | Same source as above; actuals stay |
| `revenue-by-segment` | Revenue by product and by region | Filed on an XBRL **segment axis**; companyfacts publishes the **default context only** — this is not a chain gap a better tag would close. `hide-list-verdict` §6 |

Each renders a short reason. **Never a blank and never a zero** — "EPS surprise:
0.00" reads as "came in exactly in line", which is a claim, and a false one.
`retiredSource()` **throws** on an unknown id rather than falling back, so a card
cannot ship with an invented reason.

## 3. The score was rebuilt, not left running

Two of its three signals were estimates, weighted 1.35× (EPS surprise) and 3.2×
(revenue surprise) — together the dominant term. Deleting only those terms would
have left a growth-only number **still described as measuring estimate
performance**, which keeps the authority of the old one. It now scores year-over-
year revenue and EPS growth, profitability, operating-margin direction over four
quarters, and cash conversion, and `scoreExplanation` says so.

## 4. What is STILL ON FMP — read before assuming the licence can lapse

Two calls remain on this page, both price-derived:

- **`/earnings`** — for the **announcement date** and its before-open /
  after-close timing. A filing date is not an announcement date, and the
  price-reaction card needs the session the market actually reacted in. SEC
  filings do not carry this.
- **`getDailyHistory`** — the daily bars.

And elsewhere on the site, unchanged by this pass: **market cap** and **P/E**
(`msh:pickers:fundamentals:v1`), the analyst columns, and everything in the
pickers and screener that reads them.

## 5. How the data gets there — the standing population path

`app/api/jobs/sec-facts/route.ts`, cron `20 4 * * *`, twenty minutes behind
`sec-daily-index` (which keeps its stated property of **zero companyfacts
calls** — the change detector proved in isolation).

Two queues with **separate** allowances, so a large never-populated backlog
cannot starve the queue driven by what actually filed:

1. **reverify** — `needsReverify`, oldest enqueue first. 60/run.
2. **populate** — `contentHash === null`. 40/run.

Keyed on `contentHash === null` and **standing, not a backfill with an end**:
only a filing event fills `contentHash`, so a one-off backfill leaves the same
hole open for every symbol admitted afterwards
(`claude/sec-cold-start-coverage-2026-09-14.md` §2).

A failed fetch **leaves `needsReverify` set**, which is what makes the next run
retry it. A content-hash move with no filing event behind it is logged as a
**silent restatement** rather than quietly overwritten (spec §3 Layer 2).

**A page shows the "not loaded yet" card until this job has reached its symbol.**
At 40/run a ~700-symbol universe drains in about a fortnight;
`?symbol=XXXX&key=…` populates one on demand.

## 6. Labels and attribution

- **EPS is labelled GAAP** everywhere it is named, with a note that companies
  headline an adjusted figure and the two can differ substantially. Measured:
  AAPL FQ4-2024 is $0.97 GAAP against FMP's $1.64.
- **Attribution reads "SEC EDGAR filings"**, from one constant, so there is not a
  second spelling to forget to update.
- **Period labels are the filer's own fiscal period** — "Q3 FY2026", never a
  calendar quarter. The five probe symbols' year-ends are 31 Mar, 26 Sep, 3 Sep,
  31 Oct and 31 Dec: two companies' "2026" can be nine months apart.
- **Derived figures carry a `derived` mark** with the sentence explaining the
  derivation. That is every cash-flow quarter except Q1 (filed year-to-date), Q4
  of anything (never filed standalone), and any computed EPS.
- **Price-derived figures keep their "as of close" framing**, and the next-report
  date says on the page that it comes from the earnings calendar rather than a
  filing.

## 7. The visible consequences, stated rather than discovered later

- **One quarter in four has no EPS and no share count.** Q4 is never filed as a
  three-month frame and a weighted average is not additive, so neither is
  derived. Measured at exactly 25% over the five probe symbols. The row shows a
  dash.
- **`epsTtm` is therefore null too** for any symbol whose newest four quarters
  include a Q4, because a trailing-twelve-month sum refuses a partial year.
- **The P&L waterfall does not always add up.** Measured to fail on 5 of 32 probe
  quarters (ARM, MU) by 1–7%: those filers expense things the stored lines have
  no slot for. Operating income is taken **as filed** and is right; the card says
  the breakdown is partial rather than presenting a subtraction that does not
  work.

## 8. Checks

`scripts/check-sec-earnings-page.mjs` — 32 assertions, source-level, because the
page renders from Redis and a check cannot reach it. It asserts the registry is
complete and used in both directions, that every hiding is commented with what
went and when (read from **raw** source: `readCodeOnly` strips comments, so
asserting on stripped text would pass whatever was written), that no retired
endpoint is still called, that `/earnings` still is, that no user-visible string
says FMP, and that no rendered value coalesces null to zero.

## 9. What the render check caught that no unit check would have

The preview cannot be fetched from this sandbox — Vercel SSO protection is on
for every non-custom-domain host — so the verification was built the other way:
`scripts/sec-extract-probe.mjs` now runs the whole path on a runner, against real
companyfacts, and prints each symbol **as the page would render it**. Extract →
`encodeFactSet` → `cell()` → `buildSecEarningsView`, which is exactly what a
reader sees, not an intermediate.

The first run of that printed AAPL's recent-quarters table like this:

```
Q3 FY2026   2026-06-27    109417.0M      2.02
Q2 FY2026   2026-03-28    111184.0M      2.01
Q1 FY2026   2025-12-27    143756.0M      2.84
FY FY2025   2025-09-27  102466.0M[differenced]     —
Q3 FY2026   2025-06-28     94036.0M      1.57      <- SAME LABEL as row 1
```

and ARM's June 2025 quarter as **"Q1 FY2027"**, nine months out.

**Cause:** companyfacts' `fy` and `fp` describe the FILING, not the period the
row covers — a 10-K carries `fy 2026` on every comparative it restates. The
extractor was reading them.

**This is the labelling hazard the rule exists for, arriving from inside one
company rather than between two.** Every unit assertion about the label passed,
because they all read the same wrong field.

Fixed in `fiscalLabel()`, computed from the filer's own fiscal year-end. Two
details carry the correctness:

- the quarter step is **rounded** against a real quarter (365.25/4), not floored
  against 91 — a quarter runs 90–92 days and `floor(90/91)` is 0, which labelled
  AAPL's June 2025 quarter Q4 on the first attempt;
- the year-end match carries a **ten-day tolerance**, because 52/53-week filers
  move their year-end annually (AAPL's ran 2025-09-27 against a 2026-09-26
  anchor). An exact match pushes every year-end quarter into the next fiscal year
  and labels Q4 as Q1.

Now verified across all five calendars — year-ends 26 Sep, 31 Mar, 28 Aug, 2 Aug,
31 Dec, three of them 52/53-week — with the check asserting the labels *and* that
no two quarters in one table share one.

## 10. Two smaller things the render surfaced, recorded not fixed

- **ARM shows "Total debt —" and "Net cash —".** ARM tags no debt concepts at
  all, and `totalDebt` stays null rather than becoming 0: absence of a tag is not
  proof of no debt, and this repo's standing rule is never to treat it as such.
  The cost is that a genuinely debt-free balance sheet reads as unknown. A
  filer-level "no debt tagged in any period" test could distinguish the two;
  it is not built.
- **PLAB's `longTermDebt` reads $4,000** on one date and $3.9M on another — the
  chain is picking something small and probably wrong for that filer. Flagged in
  the five-symbol diff (D5) and unresolved.
