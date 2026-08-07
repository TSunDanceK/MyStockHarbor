# Sector News — build record (2026-08-07)

Adds a **Sector News** flyout to the header's News dropdown and a new
`/sector` route family: one news page per sector, running the same news-score
engine as `/stock/[symbol]/news` but over a basket of constituents instead of a
single ticker.

Mirror of the Claude Project doc `claude/sector-news-plan-2026-08-07.md`.

---

## Routes

| Path | What it is |
|---|---|
| `/sector` | Hub: all 11 sectors, ranked by today's move, with 1D/1M/YTD |
| `/sector/[slug]` | Redirects to that sector's news page (same pattern as `/news` -> `/headlines`). Kept free so a fuller sector hub can land here later without redirect churn |
| `/sector/[slug]/news` | The page |

Slugs: `technology`, `healthcare`, `financial-services`, `consumer-cyclical`,
`consumer-defensive`, `energy`, `industrials`, `basic-materials`, `utilities`,
`real-estate`, `communication-services`.

---

## New files

| File | Job |
|---|---|
| `lib/sectors.ts` | The 11 sectors as one shared list (slug, FMP label, display name, blurb, aliases). Single source of truth, imported by the header, sitemap, `CompanyProfile` and the pages. Includes `normalise`-style lookup so "Health Care"/"Materials"/"Consumer Staples" fold onto the right slug |
| `lib/news-scoring.ts` | The shared, symbol-agnostic half of the news engine. Re-exports the LIVE implementations out of `lib/stock-news-data.ts` -- deliberately not a copy |
| `lib/sector-news-data.ts` | Multi-symbol FMP news fetch + sector feed shaping. `unstable_cache`, 1h per sector |
| `lib/sector-news-templates.ts` | Deterministic server-rendered prose (lead, "what this means", per-article "why it matters" fallback) |
| `lib/server/sectorUniverse.ts` | sector -> constituents by market cap. Redis-only, cached rollup |
| `lib/server/sectorPanels.ts` | Performance, movers, earnings-this-week, breadth. All Redis-only |
| `app/components/NewsScoreGauge.tsx` | The gauge, lifted verbatim out of the stock news page so both render one copy |

## Changed files

- `app/components/SiteHeader.tsx` — one `kind: "submenu"` entry in the News
  dropdown, `menuMinWidth: 210` / `submenuMinWidth: 250`, parent `isActive`
  extended. No component changes were needed: the flyout and the mobile
  drill-down are both fully data-driven.
- `app/sitemap.ts` — `sectorEntries` (hourly, 0.75) plus the same paths in
  `seoGuides`. Both, on purpose: the daily insight-post workflow verifies
  internal links against `seoGuides` (see `CLAUDE.md` step 4), so a page absent
  from it can never be linked from a post. `sectorEntries` is placed ahead of
  `seoGuideEntries` so the hourly version wins the URL dedupe.
- `app/components/CompanyProfile.tsx` — the Sector row is now an internal link.
  Needed an `external?: boolean` flag on the row type: the existing `href`
  branch was written for the Website row and hardcodes
  `target="_blank" rel="nofollow"`, which would have made the internal link
  pass no link equity.
- `app/stock/[symbol]/news/page.tsx` — **left untouched.** The shared gauge in
  `app/components/NewsScoreGauge.tsx` was lifted out of this file, but the file
  itself still defines its own copy, so the two now duplicate. Extracting it for
  real is a one-line import swap; deliberately deferred rather than editing a
  62KB live page as a drive-by.
- `lib/stock-news-data.ts` — `export` added to functions that already existed;
  `newestFirst` / `oneArticlePerDate` lifted from a function-local scope to
  module scope. **No behaviour change.**
- `lib/server/fundamentalsCache.ts` — `readCachedScreenerFundamentals` exported.
- `lib/server/historyCache.ts` — new `getCachedDailyHistoryBulk`: the pipelined
  half of `getDailyHistoryBulk` with the on-miss FMP fetch removed, so a page
  render can never spend a call on it.
- `app/api/debug/fmp-endpoints/route.ts` — three probes added (see below).

---

## Where the data comes from

**Constituents — zero FMP calls.** `readDynamicUniverse()` ∪ `PRESET_UNIVERSE`
-> `readCachedFundamentalsBulk` + `readCachedScreenerFundamentals` -> group by
`sector`, sort by market cap. Redis already held sector and market cap on the
same record; the only thing missing was a reverse index, which is derived in
process and cached under `msh:sector-index:v1` (6h TTL).

Reading BOTH fundamentals sources matters: the per-symbol `fundamentals` rows
only cover what `warmFundamentals` has reached (`PROFILE_MAX_PER_RUN = 120`),
while the screener rows land for every symbol the daily company-screener call
returns. Coverage counts are carried on the index and surfaced on the page
rather than hidden.

**News — ~2 FMP calls per sector per hour.** FMP's `stable/news/stock` takes
`symbols=` as a LIST; the per-stock path just happens to pass one. The sector
feed calls it with the top 40 constituents in 2 chunks of 20, then reuses the
existing dedupe / low-value filters / scorers unchanged. Across all 11 sectors
that is ~22-44 calls per HOUR against a 300-calls-per-MINUTE ceiling, and every
call goes through `reserveFmpCallSlot()` so it shares the same guard as the
crons.

**Panels — zero FMP calls.**

| Panel | Source |
|---|---|
| Sector performance (1D) | `readPricePoolBulk` `changePct`, market-cap weighted, rows older than 30 min excluded |
| Sector performance (1W/1M/YTD) | `readCachedStockDataBulk` `perf1w`/`perf1m`/`perfYtd` |
| Top movers | `readPricePoolBulk` over the constituents, staleness-filtered |
| Most-mentioned | counted from `fmpSymbols` on the feed already fetched |
| Earnings this week | `getCachedDayItems` for the next 7 days, intersected with the constituent set |
| Breadth (% above 50/200 DMA) | `getCachedDailyHistoryBulk` over the top 20, cached 3h under `msh:sector-breadth:v1:{slug}` |

---

## Two deliberate divergences from the stock news page

1. **Feed cap is per-date AND per-company, not one-per-date.** The stock feed
   collapses to one article per calendar date because several same-day stories
   about one company are usually the same story. A sector feed aggregating 40
   companies has genuinely distinct same-day stories about different companies,
   so `limitPerDate()` allows up to 3 per date but never two about the same
   company on the same date. Actual earnings-result headlines are exempt, same
   as the stock path.
2. **No AI insight card in v1.** The per-article "Why this matters" IS reused
   unchanged -- each article is about a company, so the existing symbol-shaped
   endpoint gets that constituent's ticker, which is exactly what it expects.
   The page-level AI insight is NOT wired up: `/api/stock-news/insight` and the
   prompts in `lib/ai-news-briefs.ts` interpolate a symbol and company name into
   their copy, so a sector would need a real prompt mode rather than a string
   swap. Instead the page ships a deterministic, server-rendered "What this
   means for {sector}" card built from the score, breadth, performance,
   most-mentioned names and the earnings calendar -- fully indexable, no AI cost
   per sector page. Adding a sector mode to the AI route later is a clean
   follow-up; nothing here blocks it.

---

## Open item: run the probes

Three probes were added to the (ungated, counts-only) `/api/debug/fmp-endpoints`
route. Hit it once on the preview or production and act on the result:

1. `sector-performance-snapshot` — if this works on FMP Starter it is **one
   call for all 11 sectors** and is a more accurate performance number than the
   constituent-weighted proxy the pages currently compute. If it 402s, the proxy
   stands and the pages already say so in the UI ("constituent-weighted ... not
   an index print").
2. `historical-sector-performance` — same question for longer windows.
3. `news-stock-multi-symbol` — confirms `symbols=` really is list-aware.
   `uniqueSymbols` on that probe answers it: a list-aware endpoint returns
   articles tagged across many of the requested tickers. If it turns out to
   honour only the first symbol, `fetchFmpSectorNews` needs to fan out per
   symbol instead (more calls, same shape).

---

## Not done (flagged, not silently skipped)

- **`/sector/*` is NOT opted into the 40-page daily cap** in `middleware.ts`
  (that branch is scoped to `/stock/`). The page is Redis-backed with one cached
  FMP call per sector per hour, so it isn't per-request expensive. Equivalent
  burst protection would be a Vercel Firewall dashboard rule mirroring the
  existing "Rate limit /stock category" one — a dashboard change, not code.
- **The ~400 lines of dead, drifted scoring code** in
  `app/stock/[symbol]/news/page.tsx` (`scoreNews`/`scoreEarnings`/
  `scoreNewsItem` copies that nothing calls and that no longer match the live
  lib versions) were left alone. Separate cleanup.
- **`npm ci` currently fails on `main`** — `package-lock.json` is out of sync
  with `package.json` (missing `@upstash/redis`, `botid`, `gray-matter`,
  `klinecharts`, `remark`, `remark-html`). Pre-existing, unrelated to this
  change, and not touched here since regenerating the lockfile is its own
  decision. Local verification used `npm install --no-save --no-package-lock`.
