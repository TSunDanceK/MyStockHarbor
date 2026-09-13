# Earnings page off FMP — consolidated build brief (2026-09-13)

Supersedes the running commentary in
`earnings-page-free-sources`, `sec-pipeline-spec`, `hide-list-verdict`,
`probe-results-pipeline`, `probe-final`, `segments-answered` and
`consensus-and-adjusted-eps-survey`. Those stay as the evidence; this is what gets built.

Everything below is **measured**, from the probe at
`app/api/debug/earnings-sources` on `probe/earnings-sources-2026-09-13`, run from Vercel
`iad1` on 2026-09-13. Nothing is assumed.

---

## 0. The decision

**Free sources only. No vendor, no quote, nothing blocking on a reply.**

Everything a company files is confirmed recoverable from SEC EDGAR — public domain, no key,
no display licence, 10 requests/second and no daily cap. What is not free is analyst
consensus, and the survey settled that it is not free anywhere: Alpha Vantage's terms
explicitly exclude an ad-supported public site, Finnhub's published $3,500/month plan is
still marked personal use, and every EODHD tier redirects to a custom quote.

So the page ships **GAAP-only**, with the consensus features behind the existing flag and a
provider switch ready if a quote is ever accepted.

---

## 1. What the page loses, keeps, and gains

### Hidden — behind the flag, with a comment naming the source and date, never deleted

- Forward Consensus card (FY revenue/EPS, ranges, analyst counts)
- EPS estimate, EPS surprise, and the estimate series on the bar chart
- Revenue estimate, revenue surprise, same
- The beat/miss dots in Recent Earnings Trend

### The headline EPS changes, and this is the visible one

```
today:   LATEST REPORT  EPS $0.45   (FMP adjusted/analyst basis)
         FULL P&L       EPS $0.25   (as-reported GAAP)
after:   both $0.25
```

The page currently shows both, 1,000 pixels apart, disagreeing by 80%. After the switch it
shows one number consistently. **Every "beat" on the site becomes a neutral statement of
what was filed.** That is the change to brace for, and it is the right one — a single honest
basis beats two conflicting ones.

### Kept, complete, free

The whole left column: revenue and YoY growth, growth & margins, quality of earnings,
balance sheet, revenue breakdown by product and region, price reaction, the full P&L, the
yearly pattern, the history table's actuals.

---

## 2. The Earnings Score, re-based

**Keep the name.** "Earnings Score" still describes what it does — it scores the earnings
report. Renaming it costs search equity on a site where SEO recovery is an active
workstream, and the name is part of the page's identity in the index. Change the basis and
the copy, not the label.

**What it measures now**, all from free data, four independent components:

| Component | Weight | From | Why it earns its place |
|---|---|---|---|
| **Growth** | 30% | YoY revenue growth, **and whether it accelerated vs the prior quarter** | Acceleration is the signal; a level alone says little |
| **Margins** | 25% | Operating and gross margin, direction vs the same quarter a year ago | Expanding, holding or compressing |
| **Cash conversion** | 25% | OCF ÷ net income, FCF positive or not | The quality half — profit is an opinion, cash is a fact |
| **Balance sheet & dilution** | 20% | Net cash vs net debt, current ratio, diluted share count YoY | Dilution matters enormously to this audience and almost nobody shows it |

This is **more information than the old score, not less.** Surprise measured whether analysts
guessed right; these measure whether the business did well. Cash conversion and dilution in
particular are things most competing pages do not surface at all.

### Three rules that stop it producing nonsense

1. **A missing component reduces confidence, not the score.** If a filer has no SG&A tag
   (ASTS does not), renormalise over the components that computed and say the score is based
   on three of four. Scoring an absent input as zero would make every sparse small-cap look
   terrible — the same failure-versus-absence trap the hide list nearly fell into.
2. **Pre-profit and pre-revenue companies get no score.** A margin-and-growth score on a
   company with de minimis revenue is meaningless, and those are exactly the speculative
   names this audience looks at. Say "early stage — a score would not be meaningful here"
   and show the components instead. Honest, and it protects the page from printing 12/100
   under a company that is doing what it said it would.
3. **Version the score.** Store `scoreVersion` with every stored result. Without it, "ARM
   scored 95 in September and 62 in October" reads as a decline when it is a methodology
   change — and it will shift again if consensus is ever bought back in.

### The copy has to change with it

The score is now **backward-looking only**. It describes what the quarter showed; it no
longer says anything about expectations. Current copy — *"stronger-than-expected
fundamentals"* — becomes untrue the moment surprise leaves the inputs. Rewrite to describe
what was reported, in the house's hedged register: what growth did, what margins did,
whether profit converted to cash.

---

## 3. The ten findings the build must not get wrong

Each one measured, each one would produce plausible-looking wrong numbers if missed.

### 3.1 There is no hide list — tags need chains

The intersection of missing concepts across five filers is **empty**. AAPL's is empty on its
own. Every tag missing for one filer is present and quarterly for another, so hiding is a
per-symbol render decision, never a site-wide flag. Resolve each field down an ordered chain,
first quarterly hit wins:

| Field | Try, in order |
|---|---|
| Revenue | `RevenueFromContractWithCustomerExcludingAssessedTax` → `Revenues` → `SalesRevenueNet` |
| Cost of revenue | `CostOfRevenue` → `CostOfGoodsAndServicesSold` → `CostOfGoodsSold` |
| Pre-tax income | `…ExtraordinaryItemsNoncontrollingInterest` → `…MinorityInterestAndEquityMethod` |
| Short-term investments | `ShortTermInvestments` → `MarketableSecuritiesCurrent` → `AvailableForSaleSecuritiesDebtSecuritiesCurrent` |
| Long-term debt | `LongTermDebtNoncurrent` → `LongTermDebtAndCapitalLeaseObligations` → `LongTermDebt` |
| Cash | `CashAndCashEquivalentsAtCarryingValue` → `CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents` |

**`Revenues` is a legacy tag** — AAPL's latest value is 2018-09-29, MU's 2018-08-30. It must
sit *below* the contract-revenue tag or large filers render 2018 revenue as current.

### 3.2 Cash flow is year-to-date cumulative

Operating cash flow, capex and stock-based comp returned 2–3 quarterly periods in an
8-quarter window **for all five symbols identically**. US cash-flow statements are filed
cumulative: Q1 covers 3 months, Q2 six, Q3 nine, the 10-K twelve.

```
Q1 = the 3-month value as filed
Q2 = 6-month  − 3-month
Q3 = 9-month  − 6-month
Q4 = 12-month − 9-month
```

Read straight, a Q3 figure is roughly **three times too large** and looks entirely plausible.
Worth its own check script: a quarterly operating cash flow exceeding its own annual figure
is arithmetically impossible and trivially assertable.

### 3.3 Segment revenue — two traps on one axis

Recoverable, free, from the Financial Statement **and Notes** Data Sets. But:

- **`dim.tsv` stores axis names with the `Axis` suffix stripped** — `ProductOrService`, not
  `ProductOrServiceAxis`. Parse the left side of each `key=value;` pair.
- **The `ProductOrService` axis carries cost of sales as well as revenue.** Filter on the
  revenue tag, not just the axis, or the card silently includes `CostOfGoodsAndServicesSold`.
- **Two overlapping partitions share the axis**: `{Product, Service}` and
  `{iPhone, Mac, iPad, Wearables, Service}`. Taking all six double-counts. General rule:
  **drop any member whose value equals the sum of its siblings on the same axis and date** —
  that removes rollups without a per-company table.
- **Geography appears twice.** `BusinessSegments=` with `ConsolidationItems=OperatingSegments`
  gives the reportable segments (Americas, Europe, Greater China, Japan, Rest of Asia
  Pacific) — that is the "By region" card. `Geographical=` gives a narrower country split.
  Report one, do not merge them, or the percentages will not sum.
- **`dim.tsv` uses quoted fields containing tabs.** A naive split shifts columns and attaches
  a wrong axis to a real hash — silently. One row in 119,267 today. Parse quote-aware, and
  count rows that do not yield the expected column count.

### 3.4 Foreign private issuers file nothing you are looking for

ARM — the symbol this whole page was audited against — files **20-F and 6-K, and has never
filed an 8-K.** So the periodic-filing detector cannot key on 10-Q/10-K; 6-K and 20-F must be
in the set or ARM never updates. The 8-K Item 4.02 restatement route does not exist for these
filers at all; the `/A` suffix rule covers them (`20-F/A` is a real form type).

ARM's 6-Ks arrive in pairs on the same day — deduplicate on `accn` and prefer the one whose
`reportDate` is a quarter end. And fiscal year ends across five symbols were 31 Mar, 26 Sep,
3 Sep, 31 Oct, 31 Dec: **nothing may assume calendar quarters.**

### 3.5 Filing timestamps are UTC — do not infer

The probe's timezone fitter returned "9 hours from Eastern" at 0.96–0.98 agreement for three
symbols, which is not a timezone EDGAR could be in. Over-fitting on a weak discriminator.

Read `acceptanceDateTime` as UTC, convert to Eastern with a real timezone library, compare
against the 16:00 close. ARM's own filings confirm it: 20:09Z → 16:09 ET after the close,
13:01Z → 09:01 ET before the open, 21:11Z → 17:11 ET just before the 17:30 cutoff, all
consistent with the filing dates that did not roll over. Keep the fitter as a check, never
as the source.

### 3.6 The daily index is the change detector, and holidays return 403

One request a day lists every filing by every filer. Reachable from `iad1`, layout stable,
`CIK|Company Name|Form Type|Date Filed|File Name`, ~3,600–4,100 rows/day, and it correctly
surfaced a PLAB 10-Q and two ARM filings from the target set.

**A day with no index answers 403, not 404** — and the body is
`<Error><Code>AccessDenied</Code>` from **S3**. EDGAR's indexes sit in a bucket without
`ListBucket`, so a missing key reads as AccessDenied by design. Stable, not a quirk.

The probe classifies by window spread; **the live job has one file a day and no spread.**
Re-express it across time: **alarm on consecutive 403s, never on one.** A single 403 retries
tomorrow, silently.

### 3.7 There are no cache validators

`companyfacts` offers neither `Last-Modified` nor `ETag`, so conditional requests do not
exist. Every verification is a full payload. Wire sizes are what matter — ARM 50.8 KB, AAPL
271.8 KB, PLAB 224.7 KB gzipped, against 0.7–4.1 MB parsed, roughly 14× compression.

```
700 symbols × ~250 KB wire  ≈ 175 MB per full sweep
rolling 1/30th nightly      ≈ 6 MB/day, ~23 symbols/night
```

**This promotes the content hash from optional to the mechanism** — with no validators there
is no cheap "has this changed?" to ask, so a stored hash is the only way a silent restatement
is ever noticed.

### 3.8 Restatements are quiet, and `/A` is the signal

`companyfacts` republishes a period from every filing that restated it, so a historical
quarter can change months later with nothing about the fetch looking different. `/A` appears
verbatim on the form type — 12,637 amended filings over 29 days, of which **28 × 10-K/A and
44 × 10-Q/A**, about two a day market-wide. A workable signal.

When a hash change fires, **do not silently overwrite.** A restatement changes charts that
have already been published. Record what changed, which periods, from which accession.

### 3.9 The cold start is a bulk archive, not 10,426 requests

```
companyfacts.zip  /Archives/edgar/daily-index/xbrl/companyfacts.zip
                  1,343.5 MB · classic zip · 20,359 entries
                  central directory 1.7 MB · accept-ranges: bytes
```

A 1.7 MB directory plus range support makes it a **random-access store over HTTP**, rebuilt
nightly. Stream entry by entry across invocations at the drain rate. `submissions.zip` is
ZIP64, 990,026 entries, an 83 MB directory — **skip it**, the per-symbol endpoint serves the
same data in 25 KB.

Note the paths are not interchangeable: `xbrl/` for companyfacts, `bulkdata/` for
submissions. The swapped combinations 403.

### 3.10 `company_tickers.json` works, and it is the abuse gate

200, 798 KB, **10,426 tickers**, all symbols resolved — the news probe's 403 was the
undeclared-agent block, not a host block. Commit it as a static file anyway, because it is
what makes an unknown ticker 404 *before* any network call. That is what bounds cold-fetch
exposure at 10,426 requests ever, ~21,000 Upstash commands, about four pence.

---

## 4. The pipeline

### Three jobs, one queue

| Job | Shape | Frequency |
|---|---|---|
| **Backfill** | slow drain, seeded with the universe | one-off, then idle |
| **Daily index** | one request, intersect, enqueue | 1×/day, forever |
| **Verify sweep** | full re-reads, content-hash compare | 1/30th nightly |

All three, plus lazy cold requests, are **producers on one queue with one drain**. That makes
fetch-on-request nearly free to build, and leaves a single dial governing every SEC call the
site makes: the drain rate.

### Storage

```
msh:sec:facts:v1:<SYM>   the extracted fact set, one blob, ~20 KB
msh:sec:manifest:v1      cik, lastAccession, lastFiled, contentHash,
                         nextExpected, nextExpectedSource, verifiedAt,
                         needsReverify, scoreVersion
```

One `GET` per render. Never per-field keys — `historyCache.ts:150` already records why.
Store provenance with every fact set, so a change can be attributed and not merely detected.
**Never store raw `companyfacts`** — extract, keep the small blob, discard the document.

### Never expire, never evict

A TTL means eviction means a cold key means a render that has to fetch — the failure already
recorded in `pool-ttl-died-behind-the-market-gate`. The next-report date sets a
`needsReverify` flag, not an expiry. And no LRU cap: eviction is what turns a bounded one-off
cold-population cost into a treadmill a scraper can spin forever. Storage is effectively free
at 20 KB a symbol; re-fetching is what costs.

### The cold path

Allowlist gate → 404 before any network call. Then a pending marker, enqueue, render the
honest not-yet-available state, **`noindex` until the data lands** so a crawl cannot get a
shell indexed. Never a synchronous upstream fetch inside a render. Cache the miss, or one
hammered symbol becomes unbounded writes.

**Cap cold enqueues per IP, not requests.** A request cap is what 403'd a real user on
`/insights/videos`, and `firewall-asn-audit` records that a deny rule has no feedback loop.

### Next report date

Company announcements on the GlobeNewswire and PR Newswire feeds the news adapter already
fetches — free, exact, no new vendor. Fall back to filing cadence, and label that case hedged
("expected early November"), never as a precise date.

---

## 5. Build order

1. **Manifest, empty.** Everything reads and writes it.
2. **Daily index job alone.** One fetch, intersect, write the manifest, no `companyfacts`
   calls at all. Prove the change detector before wiring anything to it. Include 6-K and 20-F.
3. **Per-symbol fetch on event** — the tag chains (3.1) and the YTD differencing (3.2) live
   here. This is the step where wrong numbers get built in if 3.1–3.5 are skimmed.
4. **Backfill** via `companyfacts.zip` range reads, most-visited symbols first.
5. **Verify sweep**, 1/30th nightly, content-hash compare.
6. **Segment extraction** (3.3), with the sum check as the rollup filter.
7. **Ticker→CIK static file and the 404 gate** — before the lazy path opens.
8. **Lazy population**, pending marker and drain.
9. **Score re-base and copy rewrite** (§2), with `scoreVersion` stored from the first write.

All of it behind `FUNDAMENTALS_PROVIDER = "sec" | "fmp"`, FMP adapter left compiling in the
tree. The flick-back requirement is unchanged.

**Step 2 is the whole idea, and it is one request a day.** If that works the rest is plumbing.

---

## 6. Deliberately not being done

- **No consensus vendor.** Not free anywhere; the switch is wired and dark.
- **No adjusted-EPS scraping.** Press-release non-GAAP figures are not XBRL-tagged, so it
  means parsing free text per company forever — and it is pointless without the estimate side.
- **No Stooq.** Closed from three independent egress paths. Do not reintroduce it.
- **No Nasdaq.** Measured datacentre block.
- **The price-reaction card does not solve daily bars.** It consumes whatever Pickers lands
  on. Building a second bar path means solving the project's hardest commercial question
  twice.

---

## 7. Still urgent, and unrelated to all of the above

**The estimate/actual/surprise history in Redis is the only copy of the consensus series the
site will ever have, and it dies with the FMP key.** Everything else on the page can be
re-derived from public filings forever; that series cannot, and no free source backfills it.
Step 0 in `stooq-sec-probe-INSTRUCTIONS-2026-09-12` is still the oldest unfinished item on
the project. Read-only, two Upstash variables, permanent cost of delay.
