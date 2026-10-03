# FMP-off test: page-by-page checklist (#553 COWORK #97 item 6)

Draft, 2026-10-03. Read from `origin/main` (f341ef93) with the three open B branches merged locally (no push): `claude/b-step3-charts-history`, `claude/b-step5-pool-on-tiingo`, `claude/b-87a-dash-reasons`. File:line references are to that merged tree. Where a line is only on a B branch, that is noted.

---

## 1. Preview setup

**Env vars, set on Preview only** (Vercel → Project → Settings → Environment Variables, scope "Preview", or scoped to the test branch):

| Variable | Value on Preview | Why |
|---|---|---|
| `FMP_API_KEY` | **unset** (remove the Preview entry; don't set it to an empty string unless that is the only option. Every gate tests truthiness, so `""` behaves the same) | The test itself |
| `PRICE_PROVIDER_PICKERS` | `tiingo` | |
| `PRICE_PROVIDER_STOCK_PAGE` | `tiingo` | Also drives the dashboard quote, `/api/quote` Tiingo leg, benchmarks |
| `PRICE_PROVIDER_POOL` | `tiingo` | Also retires `/api/market` (410) |
| `PRICE_PROVIDER_CHARTS` | `tiingo` | |
| `PRICE_PROVIDER_HISTORY` | `tiingo` | |
| `PRICE_PROVIDER_SPX` | `tiingo` | |
| `PRICE_PROVIDER_VIDEOS` | `tiingo` | |
| `PRICE_PROVIDER_NEWS_HERO` | `tiingo` | |
| `PRICE_PROVIDER_NEWS_TECH` | `tiingo` | |
| `IPO_PROVIDER` | `sec` | |
| `PICKERS_FUNDAMENTALS` | **unset** (= SEC) | `fmp` is the rollback |
| `NEWS_PROVIDER` | **unset** (= free) | Must NOT be `fmp` on Preview |
| `NEXT_PUBLIC_POSITIVE_LAST_EARNINGS_ENABLED` | leave as Production has it (unset = page 301s) | |

- Spelling matters: anything other than exactly `tiingo` reads as `fmp` (`lib/server/marketData/provider.ts`).
- **An env change only takes effect after a redeploy.** Change the vars, then use "Redeploy" on the preview deployment (same commit), or push an empty commit to the test branch. A preview built before the change still has the old env. `NEXT_PUBLIC_*` values are inlined at build time, so they always need a rebuild.
- Don't add `TIINGO_API_KEY` to Preview for this test. Pages only read stored Tiingo data. The Tiingo API is called only by the `tiingo-quotes` / `tiingo-eod` jobs (`lib/server/marketData/tiingo.ts:57`).

**Read before interpreting results:**

1. **The preview reads Production's Redis.** Production still has `FMP_API_KEY` and its crons keep writing FMP-sourced caches: FMP history (50 h TTL), fundamentals (26 h), screener fundamentals (30 h), stock-data (26 h), FMP earnings rows, the price-pool FMP rows. A page that reads one of those caches will **look fine on the preview** and still break about 1–2 days after Production loses the key. The page table flags these as "masked on preview". They are covered in §3 (jobs) and §4 (blockers), not by eyeballing.
2. **Crons don't run on Preview.** Every job result in §3 comes from code reading, not from the preview.
3. **Don't call `/api/jobs/*` on the preview.** Those routes write to Production's Redis. The ones without FMP would still run their writes, and the FMP ones just 500. Leave the jobs to §3.
4. **Pick symbols for both outcomes.** Use one in the Tiingo universe (AAPL, BRK.B, KO, KRMN, which is a video ticker) and one deliberately outside the FMP history cache, so the cache can't mask an FMP read. A fresh ticker that has a stock page but low traffic is best.
5. Use DevTools → Network with the filter `financialmodelingprep` on every page. **Any request matching it is a FAIL**, except logo images (see B9).

---

## 2. Page checklist

Legend: **T** = Tiingo stored data (`msh:tiingo:*`, via Data Cache), **SEC** = stored SEC fact sets / filings, **R-FMP** = Redis cache written by an FMP job (masked on preview), **F** = free news stack (Google News / wires / SEC), **static** = no market data.

Generic FAIL signs on every page: HTTP 500 or an error boundary; "Failed to load data"; "Failed to load stock page"; a blank section where the code renders a reason; any `financialmodelingprep` request (other than logo PNGs) or any visible "FMP" / "Financial Modeling Prep" / "financialmodelingprep.com" text; a price with no label; a $0.00 price; Tiingo-sourced figures without the linked "Market data from Tiingo.com" credit.

### 2a. Stock pages

| Route | Example path | Sources | Expected with FMP off | FAIL signs |
|---|---|---|---|---|
| `/stock/[symbol]` | `/stock/AAPL`, `/stock/BRK.B`, `/stock/KRMN`, `/stock/KO`, plus one unknown such as `/stock/ZZZQ` | Quote: T (`readTiingoQuote`), FMP fallback skipped when there is no key (`page.tsx:118`). Chart + 52-wk: T (`historyForSurface("CHARTS")`). Profile, valuation, dividend, share history, earnings sidebar: SEC. Name: Nasdaq directory + snapshot. Sector: R-FMP fundamentals cache, else SEC SIC. Client: `/api/history` (T), `/api/quote` (**500**, see B1) | Header price with label "last IEX trade, HH:MM ET" or "close, D Mon YYYY". Volume labelled "as of last close". Linked "Market data from Tiingo.com" under the header stats and under the chart (only when the series is Tiingo's). Daily/Weekly toggle works. Valuation footer reads "Computed from the company's own filings on SEC EDGAR…", with "—" plus a reason where a figure is refused. Market cap names its price basis. No analyst block. For an unknown or uncovered ticker: a 200 page with a "…data is temporarily unavailable" heading. That wording is expected but wrong; it should say "No data available" (see B12) | 500. Unlabelled price. Chart present but no Tiingo credit, which means the FMP history cache answered: check the symbol isn't served by the R-FMP masking. Network shows `/api/quote` 500 (expected until B1 is fixed; note it, and confirm the header keeps the server price). A "Failed to load stock page." banner, which means `/api/history` failed |
| `/stock/[symbol]/earnings` | `/stock/KO/earnings`, `/stock/AAPL/earnings`, plus one low-traffic symbol | SEC (fact sets, report dates, scorer). **Price reaction chart, valuation card, `<title>` price: FMP `getDailyHistory` directly, with no Tiingo switch** (`earnings/page.tsx:313,330,511`) | On the preview: probably looks normal, because R-FMP history is masked. For a symbol not in the history cache: the reaction card hidden or empty, the valuation card without a price, and no "— Price $" in the title. No EPS surprise or estimates anywhere | **B3.** Any price on this page has no label and no Tiingo credit, because it is FMP-cache data. That is the FAIL even when it renders |
| `/stock/[symbol]/news` | `/stock/AAPL/news`, `/stock/BRK.B/news` | News: F. Hero "Last Price": T (`NEWS_HERO`), else Yahoo quote. Technical Picture: T bars (`NEWS_TECH`), else Yahoo. Earnings card: SEC. Sector: R-FMP fundamentals, else SEC. Title price: T, else FMP quote (none without a key) | Last Price tile with "close, …" / "last IEX trade, …" plus the linked Tiingo credit. Technical Picture ends with a linked Tiingo credit. News cards from Google News / wires / SEC within 45 days. "Why this matters" / AI card load | Last Price shows a number **without** a label or credit, which is a Tiingo miss falling to Yahoo (`news/page.tsx:773`, see B13). "DATA UNAVAILABLE" for a covered symbol. A Technical Picture with no Tiingo credit, which means the Yahoo history was used |

### 2b. Dashboard / home

| Route | Example path | Sources | Expected with FMP off | FAIL signs |
|---|---|---|---|---|
| `/` (desktop = dashboard, mobile = MobileHomePage) and `/dashboard` | `/`, `/dashboard` | Server seed: quote via `fetchQuoteSnapshot` (T first), history T (`HISTORY`), benchmarks T (SPY/QQQ/DIA/IWM), earnings pill SEC, news F, movers ticker `/api/pickers`, which uses Tiingo movers on POOL. **Client on a ticker or timeframe change: `/api/quote` + `/api/history`** | First paint for the default ticker shows a labelled price, the chart, the "Market data from Tiingo.com" credit, benchmark tiles from Tiingo with labels, and a movers ticker labelled "Last close · D Mon" | **Search for or click another ticker (e.g. MSFT), or switch the chart timeframe, and you get "Failed to load data (try another ticker)."** That is B1: `/api/quote` returns 500 with no key and the client throws on `!qR.ok` (`DashboardClient.tsx:741-743`). Benchmark tiles reading "as of D Mon YYYY, HH:MM UTC" means a stale FMP payload from Redis (Tiingo missed). Empty benchmark row plus a 500 on `/api/benchmarks` |

### 2c. Screeners (Pickers)

All the routes below render through `PickerResultPage`. Sources: the picker build from Redis (built by Production's `warm-picker-universe` / `tiingo-eod` with `PRICE_PROVIDER_PICKERS=tiingo`; **Production still has the FMP fallback for Tiingo misses, so missing symbols are masked**). Prices are T via the pool overlay. Fundamental columns are SEC (b-87a: word cells, FY markers, reasons). List-view Performance tab and EPS/fwd columns: R-FMP `stockDataCache`.

| Route | Example path | Expected with FMP off | FAIL signs |
|---|---|---|---|
| `/pickers` | `/pickers` | Sections populated, a linked "Market data from Tiingo.com" credit (`pickers/page.tsx:216`), movers labelled "Last close · …", and a table note | An empty section with no reason. The **"Fetch Earnings" button** in an earnings section, which errors when clicked: it calls `/api/jobs/warm-earnings` → 401/500 (B11) |
| Technical presets: `/stock-screener`, `/3-month-high-breakout-stocks`, `/all-time-high-breakout-stocks`, `/atr-spike-stocks`, `/bearish-macd-divergence-stocks`, `/bearish-rsi-divergence-stocks`, `/bullish-macd-divergence-stocks`, `/bullish-rsi-divergence-stocks`, `/bullish-bearish-divergence-stocks`, `/best-trend-score-stocks`, `/breakout-signal-stocks`, `/macro-support-resistance-stocks`, `/overbought-stocks-today`, `/oversold-stocks-today`, `/stocks-above-50-day-moving-average`, `/stocks-below-50-day-moving-average`, `/stocks-below-200-day-moving-average`, `/stocks-trading-above-200-day-moving-average`, `/stocks-near-200-day-moving-average`, `/stocks-near-weekly-200-day-moving-average`, `/stocks-down-20-from-all-time-highs`, `/stocks-with-bullish-trend-flip`, `/stocks-with-bearish-trend-flip`, `/stocks-with-weekly-bullish-trend-flip`, `/stocks-with-weekly-bearish-trend-flip`, `/top-stocks-with-buy-signals`, `/top-stocks-with-sell-signals`, `/volume-spike-stocks` | e.g. `/stocks-near-200-day-moving-average` | Rows with labelled Tiingo prices and the credit under the grid. Every empty cell carries a hover/tap reason. Fundamental cells show "Loss" / "Neg." / "n/a" words and an FY marker before the number. No loading placeholder | Blank cells with no reason. A price column with no Tiingo credit. A row count far below Production's for the same page. **Performance tab (1W/1M/6M/YTD/1Y)**: it is filled today from R-FMP and will go to "—" with the reason "Not enough price history for this period" once the cache expires, which is the wrong reason (B6) |
| Fundamental presets: `/cash-rich-value-stocks`, `/cheap-tech-stocks`, `/dividend-growth-stocks`, `/high-dividend-yield-stocks`, `/low-pe-stocks`, `/semiconductor-stocks` | `/low-pe-stocks` | As above; P/E, EPS, payout and dividend columns from SEC with period labels | An FMP-era figure where SEC refused, i.e. a number where a reason is expected |
| `/stocks-with-strong-earnings-growth` | same | Rows appear today | **Masked on preview.** List membership comes from FMP earnings rows (`pickersBuilder.ts:3380,3521`), so it empties as those expire (B5). On the preview, just confirm it renders |
| `/stocks-with-positive-last-earnings` | same | 301 to `/stocks-with-strong-earnings-growth` (flag off) | 200 with an FMP "EPS surprise" ranking |

### 2d. Chart plays

| Route | Example path | Sources | Expected | FAIL signs |
|---|---|---|---|---|
| `/plays` | `/plays` | `playsBuilder`: scan reads the **R-FMP history cache** (`getCachedDailyHistory`, `playsBuilder.ts:816`), and the per-pattern chart reads FMP `getDailyHistory` (`:425`). Client `/api/plays` | On the preview: populated (masked) | **B4.** No Tiingo credit or price labels anywhere. "Failed to load chart plays" or an empty list. After the cache expires in Production, this page empties |
| `/plays/bull-flags` | same | `bullFlagsBuilder.ts:451,840`, same pattern | same | same |
| `/plays/descending-triangles` | same | `descendingTrianglesBuilder.ts:438,842`, same pattern | same | same |

### 2e. Sectors, markets, calendars

| Route | Example path | Sources | Expected with FMP off | FAIL signs |
|---|---|---|---|---|
| `/sector` | `/sector` | Sector index: classification R-FMP else SEC SIC, **ranked by R-FMP market cap** (`sectorUniverse.ts:155`). "Sector today", week/month/YTD and breadth: T EOD (`readTiingoEodLast`). Movers: T, "Last close · …" | The Sector today table with a "last close" basis, movers labelled "Last close · D Mon", and a linked Tiingo credit (`sector/page.tsx:162`) | Week/Month/YTD all "—", which means the FMP stock-data path was taken because POOL isn't `tiingo`. No credit. Constituents in a strange order (B7, masked on preview) |
| `/sector/[slug]` | `/sector/technology` | 307 redirect to `/sector/technology/news` | Redirect | 404/500 |
| `/sector/[slug]/news` | `/sector/technology/news`, `/sector/utilities/news` | News F (`fetchFreeSectorNewsWindow`). Panels T EOD. Constituents from the sector index (as above) | Free-feed cards, movers / "Sector today" labelled, linked Tiingo credit (`sector/[slug]/news/page.tsx:254`) | Empty feed with no reason. Unlabelled movers |
| `/markets/spx` | `/markets/spx` | T: SPY EOD bars (`PRICE_PROVIDER_SPX`). On a Tiingo miss: FMP `^GSPC` from the history cache, else "unavailable" | Chart of **SPY**, with a note that it is the S&P 500 ETF (Tiingo doesn't license index levels), plus the linked Tiingo credit (`spx/page.tsx:1112`) | A chart labelled `^GSPC` / "S&P 500 index" with no credit, which means the FMP fallback was served from cache |
| `/earnings-calendar` | `/earnings-calendar` (also click a day, which calls `/api/earnings-calendar/day`) | Grid: SEC announcements. Price and market cap: pool overlay (T price). **Market cap = frozen FMP pool value** (`tiingoPool.ts:79` → `earningsCalendar.ts:1050`). Off-pool symbols: "—" (no FMP quote without a key, `earningsCalendar.ts:970`) | SEC-based copy ("Dates are the day each company filed its results announcement with the SEC"), price cells with the linked Tiingo credit, "—" for off-pool rows, and the note "Price and market cap are shown for the companies this site tracks closely…" | A Market Cap column that shows a number for pool symbols: that number is an FMP figure, frozen since the key went (B8). Days stuck "not settled". Any EPS/revenue estimate column populated |
| `/upcoming-ipos` | `/upcoming-ipos` | SEC store (`IPO_PROVIDER=sec`) | "Data source: SEC EDGAR filings (public domain) — compiled from S-1/A, F-1/A, 424B and 8-A12B filings." with no Market Cap column | "Data source: financialmodelingprep.com." (means IPO_PROVIDER didn't take). "We couldn't load recent IPO listings just now." |
| `/headlines` (and `/news`, which redirects there) | `/headlines` | F (wires) via `marketHeadlines` | Headlines with real publisher names | "Financial Modeling Prep" as a source (means `NEWS_PROVIDER=fmp`). Empty page |

### 2f. Content pages with market data

| Route | Example path | Sources | Expected with FMP off | FAIL signs |
|---|---|---|---|---|
| `/insights/[slug]` (existing post) | `/insights/wfc-daily-ma200-buy-zone-july-2026` | Markdown + **SEO snapshot stored in Redis with no TTL** (`insight-snapshot:<slug>`, built once). Live chart client-side via `/api/history` (T) | Renders exactly as before. The snapshot is the frozen one | 500. Live chart empty |
| `/insights/[slug]` (**post with no snapshot yet**) | the next new daily post, or any slug whose snapshot key is absent | `buildSnapshot`: FMP quote (`fetchQuoteSnapshotForRender`, FMP-only by design) + FMP `getDailyHistory` (`insightSnapshots.ts:227-229`) | Page renders (the error is caught at `insights/[slug]/page.tsx:211-218`), but **with no snapshot block**, or a snapshot with a null price persisted forever | **B2.** Can't be safely tested on the preview: a successful build there writes the snapshot into Production's Redis permanently |
| `/insights` | `/insights` | Markdown + YouTube list | List renders | — |
| `/insights/videos/[videoId]` | `/insights/videos/J5-aZgZjt8U` (KRMN), `/insights/videos/tVFZmSVtXlk` (IFX → IFNNY), `/insights/videos/ONbGYi22p3w` (ALAB or ONDS, outside `POOL_VIDEO_TICKERS`) | T (`PRICE_PROVIDER_VIDEOS`): price, MA50/MA200 from stored bars, market cap = SEC cover shares × price, P/E SEC. Miss: FMP `fetchQuoteSnapshotForRender` → all nulls | A "Price: last IEX trade … / close, …" line, "Market cap is the SEC cover-page share count times that price", a linked Tiingo credit, and MA tiles with a "Not enough price history stored yet" hover when short | All tiles "—" with no label, which means the Tiingo miss fell to FMP and returned nulls. IFX showing nothing (the remap failed) |
| `/bottlenecks`, `/bottlenecks/[ticker]` | `/bottlenecks`, `/bottlenecks/aapl` | Markdown | Renders | — |
| `/bottlenecks/capex` | `/bottlenecks/capex` | SEC / USAspending stores written by the capex jobs (no FMP) | Renders | — |
| `/stocks` | `/stocks` | Committed lists + Nasdaq directory | A–Z list | — |
| `/popular-searches` | `/popular-searches` | Redis demand counts | Renders | — |
| `/learn`, `/learn/[slug]` | `/learn/support-and-resistance` | static | Renders | — |
| `/cache-health` (owner only, backfill key) | `/cache-health` | Job-run records, FMP meter | Optional; shows Production's job runs | — |
| `/verify`, `/platforms`, `/utilities` | — | static / `/api/go/*` | Renders | — |

### 2g. Static pages (spot-check 3–4; they should render identically)

`/about`, `/affiliate-disclosure`, `/contact`, `/privacy-policy`, `/risk-disclaimer`, `/best-charting-platforms`, `/best-indicators-for-swing-trading`, `/best-stock-indicators-for-beginners`, `/bearish-divergence-explained`, `/bullish-divergence-explained`, `/breakout-stocks`, `/how-to-analyse-stocks`, `/how-to-find-buy-the-dip-stocks`, `/how-to-identify-stock-trends`, `/how-to-read-stock-charts`, `/how-to-scan-stocks`, `/margin-trading-explained`, `/overbought-stocks`, `/oversold-stocks`, `/position-sizing-guide`, `/risk-reward-ratio`, `/stock-indicators`, `/stock-scanners`, `/stock-screener-for-breakouts`, `/stock-screener-for-oversold-stocks`, `/stocks-down-20-percent`, `/stocks-down-from-highs`, `/stocks-ready-to-break-out`, `/stocks-with-high-rsi`, `/stocks-with-low-rsi`, `/stop-loss-strategy`, `/trading-risk-management`, `/trading-setups`, `/what-is-vwap-indicator`. FAIL: anything other than 200 and normal content.

### 2h. API routes the pages call (check in DevTools → Network)

| API route | Called from | Sources | With FMP off | FAIL |
|---|---|---|---|---|
| `/api/quote` | dashboard (ticker/timeframe change), stock page (background refresh) | Key check **before** Tiingo (`api/quote/route.ts:125-128`) | **Always 500 with an empty quote** | B1. The stock page hides it, but the dashboard shows "Failed to load data" |
| `/api/history` | stock page (unseeded), dashboard, insight charts | T, else FMP when a key is set, else `points: []` | 200. Empty points for a Tiingo miss | 500 |
| `/api/benchmarks` | dashboard | T (STOCK_PAGE), else stale FMP Redis, else 500 | 200 with `provider: "tiingo"` | 500, or a payload without `provider: "tiingo"` |
| `/api/pickers` | `/pickers`, dashboard ticker | Picker build (Redis) + Tiingo movers | 200 | 500 |
| `/api/plays`, `/api/bull-flags`, `/api/descending-triangles` | plays pages | R-FMP history | 200 (masked) | 500 or empty |
| `/api/symbols`, `/api/ticker-lookup` | every search box | Off FMP since 2026-09-23 | 200 | 500 or no results for AAPL |
| `/api/stock-earnings/[symbol]`, `/api/earnings-outlook/[symbol]` | dashboard pill, earnings-calendar search | SEC | 200 (503 for a real "unavailable") | 500 |
| `/api/earnings-calendar/day`, `/api/earnings-calendar/backfill-date` | earnings calendar | SEC + pool | 200 | 500 |
| `/api/internal-news`, `/api/discovery-strip`, `/api/stock-news/insight`, `/api/stock-news/why-it-matters` | dashboard, news pages | F + AI | 200 | 500 |
| `/api/market` | nothing (builders read the state in-process) | — | **410** "FMP discovery retired" (POOL=tiingo) | 500 "Missing FMP_API_KEY" (means POOL isn't `tiingo`) |
| `/api/jobs/warm-earnings` | `/pickers` "Fetch Earnings" button | FMP | 401 (CRON_SECRET set) or 500 | B11 |

---

## 3. Background jobs (`vercel.json` crons; Production only, never on Preview)

Results for when `FMP_API_KEY` is removed from **Production**, read from the code.

| Cron (schedule, UTC) | What it does | Without `FMP_API_KEY` | Effect on Tiingo universe / caches |
|---|---|---|---|
| `warm-picker-universe` (07:02) | Builds every picker list | Runs. PICKERS=tiingo uses Tiingo bars; `fmpBulk` is null without a key (`pickersBuilder.ts:3436`), so Tiingo misses are just missing | Fine. Symbols that Production currently fills via the FMP fallback drop out of the lists. Earnings presets still read FMP earnings rows (B5) |
| `warm-earnings` (07:15) | FMP `/stable/earnings` per queued symbol → `msh:pickers:earnings:v1:*` | **500** "Missing FMP_API_KEY" (`warm-earnings/route.ts:375`) | Earnings rows age out, so `/stocks-with-strong-earnings-growth` empties (B5). A daily red run |
| `warm-screener-fundamentals` (07:50) | FMP company-screener → screener-fundamentals cache, delisting sweep, dynamic-universe adds | Returns with `ok:false, reason:"no-fmp-key"` (`screenerFundamentals.ts:121`). The sweep is skipped ("screener-unavailable"), but the SEC-listing signal still runs | Screener cache (30 h) expires, so sector ranking loses market caps (B7). The dynamic universe stops growing |
| `warm-fundamentals` (hourly :22) | FMP quote → fundamentals cache (market cap, P/E; sector via SEC) | **500** (`warm-fundamentals/route.ts:71`) | Fundamentals cache (26 h) expires. Sector/industry falls back to SEC SIC (OK). Market cap ranking is lost (B7). Hourly red runs |
| `warm-price-pool` (every 5 min) | Writes the Tiingo universe key, then FMP quotes into the pool | **200 skipped** "no FMP_API_KEY", **after** writing the Tiingo universe (`warm-price-pool/route.ts:190-222`, step 5) and the keep-alive | **Tiingo universe stays healthy** (4-day TTL, rewritten each in-session run). Pool FMP rows are kept alive but frozen, including marketCap/pe (B8) |
| `warm-stock-data` (every 10 min) | FMP ratios / dividends / analyst / stock-price-change → stock-data cache | **500** (`warm-stock-data/route.ts:35`) | Stock-data cache (26 h) expires, so the picker Performance tab and the EV/fwd-EPS fallback columns go to "—" (B6). Constant red runs |
| `sec-daily-index` (04:00), `sec-facts` (04:20, 16:20), `sec-report-dates-rewrite` (05:10), `sec-filings` (hourly :40), `warm-pickers-sec` (05:35) | SEC pipeline | No FMP; unaffected | — |
| `ipo-refresh` (04:40) | SEC IPO store | No FMP; unaffected (503 only on its own SEC-readiness check) | — |
| `capex-receivers` / `capex-contracts` / `capex-spending` (05:50 / 06:10 / 06:30) | Bottleneck capex data | No FMP | — |
| `tiingo-quotes` (every 15 min from :11) | IEX quotes for the Tiingo universe | No FMP. Universe from the key `warm-price-pool` writes, falling back to the pool's fields | OK as long as `warm-price-pool` keeps running (it does) |
| `tiingo-eod` (00:45, 02:45) | EOD bars, picker build trigger, revalidation | No FMP | OK |
| *(not a cron)* `/api/market` | FMP discovery | 410 on POOL=tiingo; **500 on POOL=fmp** | Dynamic universe (`msh:market:state`) frozen as-is |
| *(public, not a cron)* `/api/stock-earnings-debug/[symbol]` | FMP probe outside `/api/debug` | 500 | Retire (B10) |

**Bottom line for jobs:** none of them breaks the Tiingo universe or the Tiingo caches. Three crons go red permanently (`warm-earnings`, `warm-fundamentals`, `warm-stock-data`; that is about 170 failed runs a day on `/cache-health`), and they need a skip-200 like `warm-price-pool` or removal from `vercel.json`. The FMP caches those three feed are what B5–B8 depend on.

---

## 4. Remaining FMP dependencies with no replacement (blockers for 14 Oct)

**B1–B8 are blockers** (a visible break or a stale unlabelled figure once Production loses the key). B9–B13 are retire/cleanup items.

| # | Where (merged tree) | What breaks | Proposed fix (one line) |
|---|---|---|---|
| **B1** | `app/api/quote/route.ts:125-128` | Returns 500 whenever `FMP_API_KEY` is unset, **before** `fetchQuoteSnapshot` tries Tiingo (`lib/server/quoteData.ts:267`). Dashboard ticker and timeframe changes show "Failed to load data (try another ticker)." (`app/components/DashboardClient.tsx:741-743`). The stock page loses its live quote refresh | Drop the key gate, or move it inside the FMP leg, so Tiingo answers first; return 404/empty with 200 on a miss |
| **B2** | `lib/insightSnapshots.ts:227-229` (+ `lib/server/quoteData.ts:300`, FMP-only by design) | New insight posts (2 a day from the automation) get no SSR snapshot, or a null-price snapshot persisted forever | Build the snapshot from `historyForSurface` + SEC, and persist no Tiingo price (contract §7): store levels only, or compute the price at render |
| **B3** | `app/stock/[symbol]/earnings/page.tsx:313, 330, 511` | Price reaction chart, valuation-card price and title price read FMP history directly, with no Tiingo switch. They are empty once the FMP history cache (50 h) expires | Wrap them in `historyForSurface("CHARTS", …)` like the stock page, and add the Tiingo credit |
| **B4** | `lib/server/playsBuilder.ts:425, 815-816`; `lib/server/bullFlagsBuilder.ts:451, 839-840`; `lib/server/descendingTrianglesBuilder.ts:438, 841-842` | `/plays`, `/plays/bull-flags` and `/plays/descending-triangles` scan the FMP history cache. Nothing refreshes it with FMP off (PICKERS=tiingo stops the picker build writing it), so all three pages empty about 2 days after cutover | Read stored Tiingo bars (the `tiingoPickerHistory` / `readTiingoHistory` path) for the scan and the chart, and add the credit |
| **B5** | `lib/server/pickersBuilder.ts:3380` (`readCachedFmpEarningsBulk`), `:3521`; writer `app/api/jobs/warm-earnings/route.ts:375` | `/stocks-with-strong-earnings-growth` list membership is FMP `/stable/earnings` rows, so the list empties as rows expire | Compute the YoY EPS/revenue candidate from SEC quarterly fact sets (as the b-87a columns already do), or hide the page and 301 it like positive-last-earnings |
| **B6** | `app/components/PickerResultPage.tsx:1241` reading `lib/server/stockDataCache.ts:386` (writer `warm-stock-data`); reason text `app/components/PickerResultsGrid.tsx:593-597` | Picker Performance tab (1W/1M/6M/YTD/1Y) is FMP `stock-price-change`. After 26 h every cell is "—" with the false reason "Not enough price history for this period" | Compute the returns from stored Tiingo EOD bars at build time (they are in the picker build already), or hide the tab |
| **B7** | `lib/server/sectorUniverse.ts:150-157` (reads `readCachedFundamentalsBulk` / `readCachedScreenerFundamentals`) | Sector constituents are ranked by FMP market cap. After 26–30 h every cap is 0, so the top-N per sector becomes input order, and `/sector` and `/sector/*/news` show the wrong constituents | Rank by SEC cover-page shares × Tiingo last close (the same `marketCap()` the stock and video pages use) |
| **B8** | `lib/server/tiingoPool.ts:79` (marketCap/pe carried from FMP rows, kept alive by `keepPricePoolAlive`) feeding `lib/server/earningsCalendar.ts:1050` | The earnings-calendar Market Cap column, and sector-performance weights (`lib/server/sectorPanels.ts:198`), show a frozen FMP figure next to a Tiingo price, unlabelled | Null marketCap/pe on the Tiingo overlay and compute the cap from SEC × price (or show "—"), with no FMP carry-over |
| B9 | `app/components/TickerLogo.tsx:62-65` | Logo fallback #3 hot-links the FMP image CDN (no key, so the test doesn't catch it; ~1.2% of symbols plus new listings) | Owner ruling on licence. If retired, drop the source and let the monogram cover it |
| B10 | `app/api/stock-earnings-debug/[symbol]/route.ts` (whole file) | Public FMP route outside `/api/debug`; 500 without a key | Delete, or move under `/api/debug` with its guard |
| B11 | `app/pickers/PickersClient.tsx:518-522, 1195`; `app/stocks-with-positive-last-earnings/page.tsx` (emptyText) | "Fetch Earnings" button calls the FMP warm-earnings job from the browser and errors | Remove the button and the copy that points to it |
| B12 | `app/stock/[symbol]/page.tsx:118` | With no key, any Tiingo miss reports "unavailable", so unknown or delisted tickers read "temporarily unavailable" instead of "No data available" | When `STOCK_PAGE=tiingo` and there's no key, return `outcome: "no-data"` |
| B13 | `lib/stock-news-data.ts:171-175`; `app/stock/[symbol]/news/page.tsx:773` | Not FMP. On a NEWS_HERO miss the hero shows an unlabelled Yahoo quote (Yahoo is not a licensed source) | Show "—" with a reason on a Tiingo miss instead of the Yahoo quote |

FMP fallbacks that become dead code once Production is off FMP (no action needed for the test, but they should be retired with the flags): the FMP leg of `historyForSurface` (`lib/server/tiingoHistory.ts:121`), the stock-page FMP quote (`app/stock/[symbol]/page.tsx:103-150`), news meta quote (`app/stock/[symbol]/news/page.tsx:301-313`), benchmarks FMP leg (`lib/server/benchmarksBuilder.ts:258-310`), SPX `^GSPC` (`app/markets/spx/page.tsx:94`), video FMP leg (`lib/videoStockData.ts:164`), earnings-calendar `quoteOne` (`lib/server/earningsCalendar.ts:969-1022`) and month fetch (`:820`), `fmpProvider` (`NEWS_PROVIDER=fmp` rollback), `ipoCalendar` FMP leg (`lib/server/ipoCalendar.ts:287`), `indexChanges.ts` (only reachable from `/api/market` and debug), `latest-earnings-data.ts` (no page importer left).

**Production prerequisite (not a code change):** on 14 Oct Production itself needs every flag in §1 set. If `PRICE_PROVIDER_POOL` is still `fmp` there, `/api/market` 500s, and the `warm-price-pool` mover buckets stay on FMP.

---

## 5. Needs the B PRs merged (and deployed to Production) first

- **Step 5 (`claude/b-step5-pool-on-tiingo`)** carries the Tiingo universe key written without FMP (`lib/server/tiingoUniverse.ts`; `warm-price-pool` writes it before the key check), the widening to every stock-page symbol (5b), the pool overlay (`lib/server/tiingoPool.ts`), Tiingo movers (`lib/server/tiingoMovers.ts`), "Sector today" / week / month / YTD on EOD (`sectorPanels.ts`), `/api/market` 410, and the benchmarks "as of" stamp. Without it, `/sector`, the `/sector/*/news` panels, earnings-calendar prices, the dashboard movers and picker prices are FMP-pool reads and will FAIL the test.
- **Step 3 (`claude/b-step3-charts-history`)** carries the stock-page chart and `/api/history` on Tiingo (`lib/server/tiingoHistory.ts`, `PRICE_PROVIDER_CHARTS` / `HISTORY`), the Daily/Weekly toggle and the dashboard returns card. Without it, stock-page charts and every `/api/history` caller read FMP.
- **b-87a (`claude/b-87a-dash-reasons`)** carries the picker reason-on-every-empty-cell, the "Loss"/"Neg."/"n/a" word cells, FY markers, SEC P/E/EPS/payout (`pickersSecFundamentals.ts`, `pickerCellWhy.ts`) and removes the loading placeholder. Without it, the picker FAIL signs above ("blank cell with no reason") can't be judged.
- **Production must be running the merged code for at least one full cycle** before the preview test means anything. The preview reads Production's Redis, so the widened Tiingo universe, the Tiingo quote rows (`tiingo-quotes`, every 15 min) and the EOD bars (`tiingo-eod`, 00:45/02:45 UTC) exist only after Production's crons have run step 5 at least once, ideally after one `tiingo-eod` night. Run the test after that.
- B1 (`/api/quote`) and B12 are small enough to fold into step 5 or a follow-up before the test. Otherwise expect the dashboard FAIL in §2b and record it as known.
