# Getting `/stock/[symbol]/earnings` off FMP — free-source map (2026-09-13)

Audited against the **live ARM page**, read in full today, not against the July build docs.
Same method as the Pickers work: map every rendered card to the data class behind it, then
ask what that class costs.

---

## 0. The answer in one line

**About 75% of this page is as-reported company filings, which SEC EDGAR gives away for
free and in the public domain. What is NOT free is analyst consensus** — the estimate
column, the surprise column, and the forward FY card. Same shape as the Pickers finding:
the licensed thing is what analysts *think*, never what companies *filed*.

**CORRECTED 2026-09-13, later the same day.** The first version of this doc said the price
reaction card runs free on Stooq bars. That is wrong — see §4b. Stooq is closed, and the
daily-bars question on this page is the same open commercial question as Pickers. It must
not be solved twice.

---

## 1. Card-by-card map of the live page

| Card on the page | Data class | Free source | Verdict |
|---|---|---|---|
| Earnings score (95/100) | derived | — | survives |
| Latest snapshot — revenue actual, YoY revenue growth | as-reported | SEC XBRL | **free** |
| Latest snapshot — **EPS actual, EPS est., EPS surprise, revenue est., revenue surprise** | consensus | none clean | **gap — §3** |
| Latest report date | filing date | SEC `submissions` | **free** |
| **Next expected earnings date** | forward calendar | §3c | gap, cheap workaround |
| Recent earnings trend (8 qtrs, beat/miss dots) | consensus history | none clean | **gap — §3** |
| EPS actual-vs-estimate bar chart | consensus history | none clean | **gap — §3** |
| Revenue actual-vs-estimate bar chart | consensus history | none clean | **gap — §3** |
| Growth & margins (YoY revenue/EPS, gross & operating margin by qtr) | income statement | SEC XBRL | **free** |
| Quality of earnings (OCF, FCF, net income, capex, SBC) | cash-flow statement | SEC XBRL | **free** |
| Balance sheet (cash & investments, total debt, net cash, current ratio) | balance sheet | SEC XBRL | **free** |
| Revenue breakdown by product **and** by region | segment disclosure | SEC, but harder — §4 | **free, awkward** |
| Price reaction around reports (+ did the move hold, 5d/20d) | daily bars × filing dates | filing dates free; **bars are not** | **see §4b** |
| Recent reported quarters table | half free, half consensus | mixed | **partial — §3** |
| Investor read / Why it matters / Learn / Next step | static copy | — | survives |
| **Forward consensus — FY revenue & EPS, ranges, analyst counts** | consensus | none | **gap — §3** |
| Full P&L latest quarter (revenue → diluted EPS, EBITDA, tax rate) | income statement | SEC XBRL | **free** |
| Yearly earnings read (2022–2026) | derived from the above | — | survives |

FMP endpoints this page currently pulls, all replaceable except the last: `earnings`,
`income-statement`, `cash-flow-statement`, `balance-sheet-statement`,
`revenue-product-segmentation`, `revenue-geographic-segmentation`,
`historical-price-eod`, `analyst-estimates`.

---

## 2. The trap that has to be settled before anything is built

**The page is currently mixing two different EPS definitions, and only one of them is free.**

On the ARM page today:

```
LATEST REPORT   →  EPS $0.45   (FMP "earnings" — the adjusted/analyst-basis number)
FULL P&L        →  Diluted EPS $0.25   (as-reported GAAP, from income-statement)
```

Both are on the same page, 1,000 pixels apart, and they disagree by 80%. That is not a bug
— $0.45 is the figure the $0.40 consensus was set against, and $0.25 is what ARM filed.

**SEC EDGAR can only ever give the $0.25.** So a naive "swap FMP for SEC" does not just lose
the estimate column — it silently rewrites the headline EPS on every stock page to a
different, usually much lower, number, and every "beat" on the site becomes a miss.

Two honest ways out, and this is an owner decision, not a build decision:

- **(a) Keep the adjusted basis.** Then the estimate/actual pair has to come from one vendor
  that supplies both, on the same basis. §3 is about who does that for £0.
- **(b) Go GAAP-only.** Headline EPS becomes the filed diluted EPS, the estimate and
  surprise columns get hidden under the flag, and the page's story changes from
  "did they beat?" to "what did they report, and is it growing?". Fully free, no vendor,
  no licence question, and it never breaks. It is a real reduction in what the page says.

Recommendation: **(b) as the shipping default, with (a) wired behind the same provider
switch as the news adapter**, so the estimate columns light up the day a source is bought
or cleared. That keeps the flick-back requirement intact and means nothing blocks on a
vendor reply.

---

## 3. The consensus gap — what free actually gets you

### 3a. Alpha Vantage, free tier — the only realistic no-cost route

Three relevant endpoints, none of them carrying a **Premium** badge in the docs:

- `EARNINGS` / `EARNINGS_HISTORY` — quarterly `reportedEPS`, `estimatedEPS`, `surprise`,
  `surprisePercentage`, `reportedDate`. **One call returns the whole history for a symbol**,
  which is exactly the 8-quarter trend chart and the history table.
- `EARNINGS_ESTIMATES` — forward analyst estimates (this is the Forward Consensus card).
- `EARNINGS_CALENDAR` — CSV, `horizon=3month|6month|12month`, **the whole market in one
  request**, with the upcoming report date and the EPS estimate per symbol.

**Free tier is 25 API requests per day** (verified on their pricing page today — it is not
the old 500/day). Paid starts at **$49.99/mo for 75 req/min**.

The budget arithmetic, which is the whole question:

```
Universe 700 symbols (or ~1,000 Nasdaq-only)
Each symbol needs EARNINGS re-fetched only AFTER it reports → 4 calls/yr
700 × 4 / 365   ≈  8 calls/day     (1,000 → ~11/day)
+ EARNINGS_CALENDAR                =  1 call/day, covers every symbol
                                    ─────────────
                                       ~9–12 of the 25/day
```

**It fits, with room.** The cost is the cold start: a full backfill of 700 symbols at
24/day is **~30 days**, or ~42 days at 1,000. So the estimate columns would fill in
gradually over the first month rather than appearing on launch day.

Two caveats, both real:
- 25/day is a *hard* daily cap, so the queue must be durable and resume where it stopped —
  a retry storm burns the day's budget in a minute.
- **The commercial-use question has not been answered.** Alpha Vantage's "for commercial
  use, contact sales" notes appear on the *realtime price* endpoints (exchange-regulated),
  not the fundamentals ones. That is suggestive, not permission. Ask in writing before
  shipping — the FMP lesson is that a cheap tier is cheap until they look at the site.

### 3b. What is NOT a route

- **Nasdaq** — already measured as a hard datacentre block from Vercel (news probe,
  2026-09-12). Do not reintroduce it for earnings either.
- **Finnhub free** — explicitly personal/non-commercial.
- **Scraping Yahoo/StockAnalysis** — same posture that made the FMP conversation expensive,
  with worse odds. Not recommended at any price.

### 3c. Next expected earnings date — free without any vendor

`EARNINGS_CALENDAR` is the clean answer, but there is a genuinely free fallback that needs
no key at all and is worth building **regardless**, as the backstop:

1. **Company IR press releases** — "X to report Q3 results on 4 Nov". These arrive on the
   GlobeNewswire and PR Newswire feeds **already probed and PASSed** on 2026-09-13, with
   ticker tags in `<category>` / `prn:subject`. The adapter being built for news can emit
   an earnings-date event from the same fetch, for zero extra calls.
2. **Filing cadence** — last year's same-quarter filing date from SEC `submissions`, plus
   the mean inter-report gap. Gets within a few days for most large caps.

Label it honestly when it comes from (2): *"expected early November"* rather than a false
precise date. Hedged wording, consistent with the house style.

---

## 4. Revenue breakdown by product and region — free, but the fiddly one

`data.sec.gov/api/xbrl/companyfacts` returns **consolidated facts only** — the dimensional
qualifiers are stripped, so "Royalty $2.61B / License $2.31B" is not in there. Two free routes:

- **Bulk (right for a 700–1,000 symbol universe):** SEC **Financial Statement *and Notes*
  Data Sets** — monthly ZIPs, eight files (SUB, TAG, **DIM**, **NUM**, TXT, REN, PRE, CAL).
  `NUM.dimh` is a 32-byte key into `DIM`, whose `segments` field holds the concatenated
  axis-and-member string. Join NUM→DIM, filter to the revenue tags on
  `ProductOrServiceAxis` and `StatementGeographicalAxis`, and the whole universe's segment
  split falls out of **one monthly download**. Public domain, no key, no rate limit worth
  mentioning.
- **Per company:** the filing's inline XBRL / `FilingSummary.xml` R-files for the
  "Disaggregation of Revenue" statement. ~1–2 requests per company per year. Fine for a
  long tail, wrong as the primary path.

Member labels will read differently from FMP's ("Korea, Republic Of" is the XBRL member
label) — already accepted for Pickers industries, same acceptance applies here.

---

## 4b. Daily bars — the correction, and why this page must not solve it

`claude/NEXT-SESSION-2026-09-12.md` records the measurement: **Stooq is closed.** 6/6
JavaScript challenge from a GitHub runner, 401 on the bulk archive, **and blank from a
residential UK browser on both `stooq.com` and `stooq.pl`.** Not a datacentre-IP problem
and not a rate limit — eliminated before anything was built on it.

**Re-measured 2026-09-13 from Vercel `iad1`: 5/5 symbols returned the same JavaScript
verification interstitial, 796 bytes each, zero bars parsed.** Third independent egress
path, same result. The file is closed — not a datacentre-IP problem, not a rate limit, not
a retry candidate.

So the Price Reaction card has no free bar source, and neither does Pickers. That same doc
puts the live position plainly: Tiingo, Alpaca and marketstack are all *reachable*, so the
constraint is licensing rather than access, every free and personal tier is internal-use,
and vendor enquiries went out on 2026-09-12 (`claude/data-vendor-enquiry-2026-09-12.md`).
The open question worth ~£200/month is whether a vendor treats indicators computed from
their EOD data as the customer's own derived output.

**The consequence for this page: it consumes the bars decision, it does not make one.**
Whatever Pickers lands on becomes the price-reaction card's source with no extra work,
because the card needs roughly 330 bars per symbol — ±20 trading days around eight reports
— which is a rounding error against what Pickers already pulls. Building a second bar path
here would mean solving the hardest, most expensive question on the project twice.

Until that lands, the card renders from the bars already in Redis and degrades per quarter
rather than disappearing. Which makes the point below urgent.

### The thing that is actually time-critical

**The 8-quarter estimate and surprise history now sitting in Redis is irreplaceable, and it
dies with the FMP key.** Every other number on this page can be re-derived from public
filings forever. The consensus series cannot — it is a snapshot of what analysts expected
at a moment that has passed, and no free source backfills it. Alpha Vantage *might*, which
is a probe result nobody has yet.

Step 0 in `claude/stooq-sec-probe-INSTRUCTIONS-2026-09-12.md` is still recorded as the most
urgent unfinished item on the project, and it already lists earnings rows. This adds one
line to its justification: **dump the estimate/actual/surprise series for the full universe
before the key lapses, not after the probe.** It is read-only, needs the two Upstash
variables, and its cost of delay is permanent.

## 5. What ships hidden

**SUPERSEDED IN PART 2026-09-13** by `claude/hide-list-verdict-2026-09-13.md`: the measured
result is that NO concept is missing across all filers, so nothing is hidden for lack of an
SEC source. What remains hidden is exactly the consensus list below, which was never in
doubt.

Following the existing convention — **hidden behind the flag with a comment naming the lost
source and the date, never deleted**:

1. Forward Consensus card (FY revenue/EPS, ranges, analyst counts)
2. EPS estimate / EPS surprise columns and the estimate series on the bar chart
3. Revenue estimate / revenue surprise, same
4. The "READ" verdict column in the history table, *if* it is computed from surprise —
   it can be re-derived GAAP-only from growth + profitability instead, which is preferable
   to hiding it

The Earnings Score needs re-weighting either way: on the GAAP-only basis its surprise
inputs vanish, and a score that silently drops two of its four inputs will read as broken.

Everything else on the page — the whole left column, the P&L, cash, balance sheet,
segments, price reaction, yearly pattern — survives complete on free data.

---

## 6. Ask in writing before anything is bought or shipped on it

Same letter as the news survey, to Alpha Vantage:

> MyStockHarbor.com is a publicly accessible, ad-supported stock-analysis website. I intend
> to display quarterly reported and estimated EPS, revenue, surprise percentages and
> forward full-year analyst consensus on public ticker pages, cached, for roughly N symbols.
> Does that fall within the free tier / plan [P] at the listed price, or does it require a
> separate commercial or redistribution licence? Please confirm in writing.

*Not legal advice — confirm licensing with the vendor in writing.*

---

## 7. Probe first — paste-ready instruction set for Claude Code

Nothing above gets built until it is measured, same sequence as the news probe that caught
the Nasdaq block. Temporary debug route on a throwaway branch, deleted after.

```
Branch: probe/earnings-sources-2026-09-13
Route:  app/api/debug/earnings-sources/route.ts   (delete once the adapter ships)
Run from Vercel PREVIEW, not local — the point is to test from the deployment's own IP.
Symbols: ARM, AAPL, MU, PLAB, ASTS  (one mega cap, one mid, two small, one recent IPO)

For each source, record: HTTP status, latency, payload bytes, and the exact fields returned.
Report a table. Change nothing else in the repo. No PR without the owner saying so.

1. SEC companyfacts
   GET https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
   Declared User-Agent. Confirm presence and quarterly depth of:
   Revenues / RevenueFromContractWithCustomerExcludingAssessedTax, CostOfRevenue,
   GrossProfit, ResearchAndDevelopmentExpense, SellingGeneralAndAdministrativeExpense,
   OperatingIncomeLoss, IncomeLossFromContinuingOperationsBeforeIncomeTaxes...,
   IncomeTaxExpenseBenefit, NetIncomeLoss, EarningsPerShareDiluted,
   WeightedAverageNumberOfDilutedSharesOutstanding,
   NetCashProvidedByUsedInOperatingActivities, PaymentsToAcquirePropertyPlantAndEquipment,
   ShareBasedCompensation, CashAndCashEquivalentsAtCarryingValue,
   ShortTermInvestments, AssetsCurrent, LiabilitiesCurrent, LongTermDebtNoncurrent.
   → Explicitly report ANY of these that is missing or empty per symbol. That list is the
     real hide list, not the one guessed above.

2. SEC submissions
   GET https://data.sec.gov/submissions/CIK##########.json
   Confirm 8-K and 10-Q/10-K filingDate + acceptanceDateTime for the last 8 quarters.
   acceptanceDateTime is what decides before-open vs after-close for the price-reaction card
   — report whether it is populated and what timezone it is in.

3. SEC Financial Statement and Notes Data Sets
   Download ONE recent monthly ZIP. Join NUM.dimh → DIM.dimh.
   Report: zip size, row counts, and whether ARM's FY2026 revenue splits by
   ProductOrServiceAxis and StatementGeographicalAxis are recoverable, with the member
   labels verbatim. This is the go/no-go for the Revenue Breakdown card.

4. Alpha Vantage, free key
   EARNINGS (or EARNINGS_HISTORY), EARNINGS_ESTIMATES, EARNINGS_CALENDAR&horizon=3month.
   Report exact field names, how many quarters of history come back, whether the CSV
   calendar covers all five symbols, and the exact error body on the 26th request of the day.
   Budget: this probe alone will eat most of one day's 25.

5. Stooq daily bars
   CORRECTED: Stooq measured 0/6 from a GitHub runner AND blank from a residential UK
   browser. A FAIL is the expected result. Run it for completeness only — it costs a
   second — and treat a FAIL as closing the file, not as a reason to try harder.

Do NOT probe Nasdaq. It is a measured datacentre block, not a retry candidate.
```

*(Claude Code corrected §5 before running it, and shipped the probe as
`app/api/debug/earnings-sources` on branch `probe/earnings-sources-2026-09-13`, commit
`e6ef232` — two files added, nothing else touched. See
`claude/earnings-probe-adjudication-2026-09-13.md` for the review and the run checklist.)*

---

## 8. Order of work

1. Run the probe. Nothing below is trustworthy until the probe table exists.
2. Build the SEC fundamentals adapter behind the same env-switched provider interface the
   news adapter uses (`EARNINGS_PROVIDER = "free" | "fmp"`), FMP adapter left compiling in
   the tree. Flick-back preserved.
3. Ship the page GAAP-only with the consensus cards hidden and the score re-weighted.
4. Add the Alpha Vantage estimates queue as a second, optional provider once the licence
   answer is in — the page works without it, so it never blocks the exit.
