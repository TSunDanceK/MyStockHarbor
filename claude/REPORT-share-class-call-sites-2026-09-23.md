# Report: share-class spelling, remaining call sites (2026-09-23)

PR: https://github.com/TSunDanceK/MyStockHarbor/pull/526 (not merged).
It follows #524 (9d0c1b9e), which converted three quote-path call sites and
printed 27 others without asserting them.

Note: `claude/HANDOVER-stock-page-art-and-quote-path-2026-09-23.md` is not in
the repo. It exists only in the Claude Project, which this session can't read.
This work was scoped from #524's commit body and `scripts/check-symbol-spelling.mjs`.

---

## 1. What changed

Every conversion happens at the vendor boundary, using `toDashed` from
`lib/symbolSpellings.mjs`. Only the FMP request changes. The displayed symbol,
the Redis/store keys and the payload labels keep the reader's spelling.

| File:line (after this PR) | Function | Fed by |
|---|---|---|
| `app/stock/[symbol]/page.tsx:77` | `fetchQuote` | route `[symbol]` → `upper` (page + generateMetadata) |
| `app/stock/[symbol]/page.tsx:186` | `fetchCompanyProfile` (stable + legacy v3 URL share `enc`) | route `[symbol]` |
| `app/stock/[symbol]/page.tsx:267` | `fetchShareHistory` (2 URLs) | route `[symbol]` |
| `app/stock/[symbol]/earnings/page.tsx:545` | `fetchQuoteForMeta` | route `[symbol]` via local `cleanSymbol` (keeps dots) |
| `app/stock/[symbol]/earnings/page.tsx:372` | `getEarningsData` → `fetchFmpJson('/earnings?symbol=…')` | route `[symbol]`. **Not in #524's census at all** (see §2) |
| `app/api/stock-analyst-rating/[symbol]/route.ts:152` | `GET` (2 FMP URLs) | its own `[symbol]` segment; called by `StockSymbolPageClient.tsx:887` with the page symbol |
| `app/api/stock-valuation/[symbol]/route.ts:204` | `GET` (4 FMP URLs) | its own `[symbol]` segment; called by `StockSymbolPageClient.tsx:852` |
| `lib/latest-earnings-data.ts:538` | `getLatestEarningsDataInner` (5 FMP URLs) | `/api/stock-earnings/[symbol]` and `/dashboard?symbol=`/cookie, both via dot-keeping cleaners |
| `lib/latest-earnings-data.ts:186` | `earningsRowsFromStoreOrFmp` | same. It now computes its own `encoded` instead of taking a pre-encoded argument (signature changed: `(symbol, key)`) |
| `lib/server/quoteData.ts:177` | `fetchQuoteFromFmpUncached` | `/api/quote?symbol=` (includes `StockSymbolPageClient.tsx:826`'s live refetch), `/dashboard?symbol=` |
| `lib/server/news/fmpProvider.ts:97` | `fetchForSymbol` (2 URLs) | `/stock/[symbol]/news`, `/api/internal-news?symbol=`. Active only when `NEWS_PROVIDER=fmp` |

### `scripts/check-symbol-spelling.mjs` §4

- **`UNDER_TEST` (line ~557):** gains 12 entries: the 2 requested, plus the
  10 functions above that a route can reach.
- **The identifier resolver (`resolve`, line ~386):** a `${encoded}` span is
  read through its `const` declaration in the *same* function, one hop only.
  `let` is refused. Without this, a converted `const encoded = …toDashed…`
  site scores as unconverted.
- **Detection of relative-path FMP helpers (`fmpHelperPath`, line ~414):** a
  template starting with `/` that is passed as the first argument to a
  `fetchFmp*` call counts as FMP. The earnings page's `/earnings?symbol=`
  request has no host in its text. It was invisible to #524's scan, which put
  it in neither the assertions nor the census. That is how 27 became 28.
- **Two new probes (`PROBE_INDIRECT`, `PROBE_HELPER`):** the extractor is
  tested on each new shape before any assertion trusts it. This follows the
  file's existing "extractor tested before trusted" rule.
- **`TRACED` map (line ~664):** a one-line traced verdict is printed beside
  each census line still unconverted. It is printed, not asserted. An unknown
  line prints `UNTRACED`.
- **Failure message:** now says "a dotted route such as /stock/BRK.B" instead
  of hardcoding `/stock/BRK.B/news`.

---

## 2. §4 mutants and results

Each mutant was applied alone, the check was run, and the file was restored.

| # | Mutant | Result |
|---|---|---|
| 1 | earnings `fetchQuoteForMeta` un-converted | CAUGHT: `fetchQuoteForMeta() converts before asking FMP (line 542)` FAIL |
| 2 | `/stock/[symbol]` `fetchQuote` un-converted | CAUGHT: `fetchQuote() converts before asking FMP (line 76)` FAIL |
| 3 | `fetchCompanyProfile` `enc` un-converted | CAUGHT (line 189) |
| 4 | `fetchShareHistory` `enc` un-converted | CAUGHT (lines 271, 273) |
| 5 | analyst-rating `encoded` un-converted | CAUGHT (lines 157, 160) |
| 6 | valuation `encoded` un-converted | CAUGHT (lines 218, 221, …) |
| 7 | earnings `/earnings` fallback un-converted | CAUGHT: `getEarningsData() … (line 372)` |
| 8 | `getLatestEarningsDataInner` `encoded` un-converted | CAUGHT (line 557) |
| 9 | `earningsRowsFromStoreOrFmp` `encoded` un-converted | CAUGHT (line 188) |
| 10 | `fetchQuoteFromFmpUncached` un-converted | CAUGHT (line 177) |
| 11 | `fetchForSymbol` un-converted | CAUGHT (line 103) |
| 12 | `const encoded` → `let encoded` (resolver must refuse) | CAUGHT: reads bare `${encoded}` and fails |
| 13 | resolver matches any `const` name | CAUGHT: resolves `enc = process.env.FMP_API_KEY` and fails |
| 14 | resolver disabled | CAUGHT: indirect probe plus every `const`-fed site fails |
| 15 | resolver searches the whole file instead of the enclosing function | **SURVIVED at first.** The probe had its namesake *after* the real declaration, so first-match found the right one by source order. The probe was reordered (namesake first) and the mutant is now CAUGHT |
| 16 | helper-path rule removed | CAUGHT: helper probe finds 0, and `getEarningsData() … is still there` fails |
| 17 | helper-path rule loosened to any call / any path | CAUGHT: helper probe finds 2 (it scored `/api/quote` as FMP) |

#524's six mutants still apply unchanged: those assertions weren't edited.

---

## 3. The 27 census lines: verdict and evidence

"ROUTE" means a route parameter, query string or cookie can deliver a dotted
symbol. "PRESET" means it receives `BRK.B` **today** from the hand-written
`PRESET_UNIVERSE` (`lib/server/presetUniverse.ts:54`), and also any dotted
ticker promoted by the search-demand beacon.

The beacon path works like this: `/api/track/ticker-interest` →
`normaliseTicker` (`lib/server/searchDemand.ts:64-80`), which keeps `.` and
**rejects** any symbol containing `-` → `pickersBuilder.ts:3288-3305`. The
PRESET sites are neither of the two buckets you named, so per "don't convert
blind" they are **reported, not converted** (see §6).

| # | Census line (pre-PR numbering) | Verdict | Evidence |
|---|---|---|---|
| 1 | `app/api/debug/static-profile/route.ts:72` `fetchStatic` | PRESET, not converted | `readPickersSymbolsIfCached()` ← `PICKERS_SYMBOLS_KEY` written from `signalRecords` (`pickersBuilder.ts:1072-1074`). `fillSlots(PRESET_UNIVERSE)` at `:3331` puts BRK.B first, and BRK.B gets bars because history dashes via `buildFmpSymbol`. The debug route takes only offset/limit |
| 2 | `app/api/jobs/warm-earnings/route.ts:346` `fetchFmpEarnings` | PRESET, not converted | The queue `msh:pickers:earnings:v1:queue` is filled by `queueEarningsWarmupSymbols(universe)` (`pickersBuilder.ts:3343`, SADD `:1387-1391`, regex keeps dots) and by `enqueueDynamicUniverseMissing` (`route.ts:289-331`). BRK.B is re-queued while its dotted earnings key stays empty |
| 3 | `app/api/market/route.ts:782` `fetchSingleQuote` | No dot, left | `CURATED_UNIVERSE` holds BRK.B (`:144`), but `getNextDiscoveryBatch` skips curated symbols (`:851`, `curatedSet.has`). The rest comes from FMP screener rows (`:700-710`), dashed at source. `GET()` takes no input |
| 4–5 | `app/api/stock-analyst-rating/[symbol]/route.ts:150,153` | **ROUTE, converted** | `params.symbol` → `cleanSymbol` (`/[^A-Z0-9.-]/`, keeps dot) → `encoded` |
| 6–9 | `app/api/stock-valuation/[symbol]/route.ts:211,214,223,229` | **ROUTE, converted** | same shape |
| 10 | `app/stock/[symbol]/earnings/page.tsx:536` `fetchQuoteForMeta` | **ROUTE, converted** (requested) | `generateMetadata` → `cleanSymbol(symbol)` (`:109-113`, keeps dot) |
| 11 | `app/stock/[symbol]/page.tsx:70` `fetchQuote` | **ROUTE, converted** (requested) | `params.symbol.toUpperCase()` at `:317` and `:386` |
| 12 | `app/stock/[symbol]/page.tsx:181` `fetchCompanyProfile` | **ROUTE, converted** | `fetchCompanyProfile(upper)` in the page's `Promise.all` |
| 13–14 | `app/stock/[symbol]/page.tsx:263,265` `fetchShareHistory` | **ROUTE, converted** | `fetchShareHistory(upper)` |
| 15 | `lib/latest-earnings-data.ts:185` `earningsRowsFromStoreOrFmp` | **ROUTE, converted** | only caller is `getLatestEarningsDataInner` |
| 16 | `lib/latest-earnings-data.ts:550` `getLatestEarningsDataInner` | **ROUTE, converted** | `getLatestEarningsData` ← `app/api/stock-earnings/[symbol]/route.ts:41` (cleaner keeps dot) and `app/dashboard/page.tsx:119/158` (`?symbol=` or `msh_sym` cookie via `lib/symbol.ts` `cleanSymbol`, keeps dot). Note: `earnings/page.tsx` imports `getLatestEarningsData` but never calls it |
| 17 | `lib/sector-news-data.ts:225` `fetchFmpSectorNewsWindow` | PRESET (conditional), not converted | `getSectorConstituents(slug, 40)` ← `sectorUniverse.ts:80-91` = `PRESET_UNIVERSE` + dynamic universe (`cleanSymbol` keeps dot). BRK.B reaches the request only if it survives the top-40 market-cap cut in Financial Services. Its `marketCap` comes from `fund:BRK.B`/screener, and the screener lookup misses the dotted key. **Uncertain:** whether the live `fund:BRK.B` row has a market cap |
| 18 | `lib/server/benchmarksBuilder.ts:131` `fetchFmpQuote` | No dot, left | only caller `:212`, over fixed lists `SPY/QQQ/DIA/IWM` (`:113-118`) and `BTCUSD/ETHUSD/SOLUSD/TRXUSD` (`:120-125`) |
| 19 | `lib/server/earningsCalendar.ts:1110` `quoteOne` | No dot, left | `quoteBatch` ← `getFullDayEarnings` ← FMP `earnings-calendar` rows. `looksNonUsOrDerivative` (`:445-448`, applied `:960`) drops any symbol containing `.` or `-`. The file's own `BRK.B` literal is in `POPULAR_SYMBOLS`, which is used only for ranking |
| 20–21 | `lib/server/fundamentalsCache.ts:510,544` `fetchQuoteFundamentals` | PRESET, not converted | `warmFundamentals` (only caller `:807`) ← warm-fundamentals job ← `getWarmTargetSymbols` (`warmTargets.ts:297-339`) = pickers symbols ∪ dynamic universe. BRK.B is a steady price-pool miss (`:790-800`), so it is re-asked every run it lands in the first 100. The batch at `:510` returns 402 on Starter, and `:544` is the leg that runs |
| 22 | `lib/server/fundamentalsCache.ts:568` `fetchProfile` | PRESET, not converted | the only caller `:687` over `profileMisses`. The screener cache is keyed dashed, so "BRK.B" always lands in `needsIndustry`. A null result is never parked (`:684-722`), so **one `PROFILE_MAX_PER_RUN` slot is spent on BRK.B every run** |
| 23 | `lib/server/indexChanges.ts:219` `fetchRecentIndexAdditions` | No dot (by FMP convention, not measured), left | symbols only from FMP `historical-*-constituent` rows (`:64-101`). All three endpoints return 402 on this plan (`:122-140`), so this line is unreached today |
| 24 | `lib/server/news/fmpProvider.ts:99` `fetchForSymbol` | **ROUTE, converted** | `/stock/[symbol]/news` (`symbol.toUpperCase()`) → `getStockNewsBaseData` → `fetchSymbolNewsWindow`. Also `/api/internal-news?symbol=`. Only when `NEWS_PROVIDER=fmp` (`lib/server/news/index.ts:78-80`) |
| 25 | `lib/server/pricePool.ts:681` `fetchStableQuote` | PRESET, not converted | `warmPricePool` (only caller `warm-price-pool/route.ts:175`) over warm targets. BRK.B is tier 1 through `deriveTier1(PRESET_UNIVERSE)` (`warmTargets.ts:419`). It returns empty, so `failStreak` increments and the symbol is deferred, then retried when the deferral lapses |
| 26 | `lib/server/pricePool.ts:759` `fetchPeTtm` | PRESET, not converted | `peSlice` ignores the deferred set, so the price deferral doesn't stop this call. **Not checked:** whether `mergePoolRow` advances `peTs` on a null P/E. If it doesn't, BRK.B heads `peSlice` every run |
| 27 | `lib/server/quoteData.ts:173` `fetchQuoteFromFmpUncached` | **ROUTE, converted** | `/api/quote?symbol=` (`route.ts:42`, upper-case only), including the live refetch on `/stock/BRK.B`. Also `/dashboard?symbol=`. `insightSnapshots`/`videoStockData` use hand-written frontmatter, and no dotted value exists there today |
| +1 | `app/stock/[symbol]/earnings/page.tsx:372` `getEarningsData` → `/earnings` | **ROUTE, converted** | not in the census (relative path). Runs only when `secEvents` is empty |

**Totals:**
- 15 of the 27 lines are converted.
- The +1 line outside the census is converted too.
- 4 lines are no-dot (left): #3, #18, #19, #23.
- 8 lines are PRESET (left): #1, #2, #17, #20, #21, #22, #25, #26.

The census now prints those 12 lines, each with its traced verdict. Lines 510
and 544 are one function, so the TRACED map has 11 entries.

Spot-checked by hand rather than taken from the tracing agents:
- `presetUniverse.ts:54` contains `"BRK.B"`
- `market/route.ts:851` skips curated symbols
- `earningsCalendar.ts:446` drops `.` and `-`
- `searchDemand.ts:76` rejects `-`
- `pickersBuilder.ts:3331-3333` fill order

---

## 4. How this was verified

- `npx tsc --noEmit`: clean.
- `npx eslint` on the 8 touched files: 2 warnings, 0 errors. That is identical to
  main on the same files.
- `node scripts/check-symbol-spelling.mjs`: ALL CHECKS PASSED.
- The **71** `scripts/check-*.mjs` harnesses that mention any touched file's
  name were all run. All exit 0.
- Mutants: see §2.
- Rendering: **NOT VERIFIED. This was attempted and failed, and it is the one open
item.**

The Vercel preview for `2c518ee` built READY:
`mystockharbor-6svdgokib-tsundanceks-projects.vercel.app`, deployment
`dpl_dZnYgFF7ygTuXvPhiBHY93czPss7`. Three ways of reaching it all failed:
- The Vercel connector's fetch returned a 302 to `vercel.com/sso-api`, even
  with a freshly minted `_vercel_share` link.
- The sandbox proxy refuses `*.vercel.app` outright (curl exit `000`,
  CONNECT refused). This matches CLAUDE.md's network note.
- Production is equally unreachable from here.

So step 3 of the brief, "/stock/BRK.B and /stock/BRK.B/earnings show prices
matching BRK-B; AAPL unchanged", is **for you to eye-check**. Open the
branch-alias preview (from Vercel's PR comment on #526) and check:

| URL | Expect |
|---|---|
| `/stock/BRK.B` | Server-rendered price present, matching `/stock/BRK-B`. The profile panel and share-count history are populated (they were empty before: `fetchCompanyProfile`/`fetchShareHistory` sent "BRK.B"). After hydration, the valuation and analyst-rating panels are populated, not the empty state |
| `/stock/BRK-B` | Unchanged. The reference numbers |
| `/stock/BRK.B/earnings` | `<title>` price equals `/stock/BRK-B/earnings`'s. **Caveat:** that title comes from the history bars (§5), which were already dashed, so it would have matched before this PR too. The earnings conversion is not visible in the title |
| `/api/quote?symbol=BRK.B` | A non-null `price` close to BRK-B's (was null: `fetchQuoteFromFmpUncached` sent "BRK.B") |
| `/api/stock-earnings/BRK.B` | Populated rows, not the "unavailable" note |
| `/stock/AAPL`, `/stock/AAPL/earnings`, `/api/quote?symbol=AAPL` | Identical to production. `toDashed("AAPL")` is `"AAPL"` |

Quote values move intraday and the ISR windows differ, so "matching" means
the same order of magnitude within the quote's hour, not the identical cent.

---

## 5. Why the news-page `<title>` price lags the body (report only, no code)

**The title never reads the quote.** `app/stock/[symbol]/news/page.tsx:324`
prints `seed.lastClose`. `computeIndicatorSeed` (`lib/indicators.ts:193-222`)
sets `lastClose` to `points[points.length-1].close`, the **newest bar of
`getDailyHistory`**. The FMP quote fetched by `fetchQuoteForMeta` (`:313-315`)
is passed in as `seed.price` and never read by the title. The earnings page
has the same shape (`earnings/page.tsx:558`). The `/stock/[symbol]` title has
no price in it.

**The cache on the meta path** is the Redis daily-history cache in
`lib/server/historyCache.ts`:
- Key prefix: `msh:history:v7` (`:45`).
- Success TTL: `REDIS_HISTORY_TTL_SECONDS = 50 * 60 * 60`, which is **50h**
  (`:72`), applied at write time via `getRedisHistoryTtlSeconds` (`:1221`).
  There is a weekend extension to the next Monday open (`:357-361`).
- Failure TTL: 15 min (`:116`).
- Refresh: a *forced* refetch runs once a day before the US open, in the
  `warm-picker-universe` cron at `2 7 * * *` UTC (`vercel.json`). That cron
  calls `GET_WARM` → `handlePickersRequest(req, { requestHistoryForce: true })`
  (`lib/server/pickersBuilder.ts:5319`). The code comment at `historyCache.ts:95-106` records
  that FMP serves no partial bar for the current day before the session.
- So for a pickers-universe symbol, the newest cached bar all session is the
  **previous session's close**. Nothing refreshes it intraday.
- The underlying FMP call's Next `revalidate: 300` (`:1303`) only matters on a
  Redis miss.

Above that sits the page's ISR, `revalidate = 3600` (1h), set in
`app/stock/[symbol]/layout.tsx:110`.

**The body is not on that clock.** Its price is `quote?.price ?? lastClose`
(`news/page.tsx:728`). The quote comes from `fetchFmpQuote`
(`lib/stock-news-data.ts:203`, `revalidate: 3600`) inside
`getCachedStockNewsBaseData` (`unstable_cache`, `revalidate: 3600`, `:2931-2942`).
It is up to about 1–2h stale, but it is an intraday price.

**Reading ONDS:**
- The title's $7.38 fits the prior session's close.
- The body's $7.72 fits a same-day quote.
- The gap lasts "all day" because the bar cache is refreshed once, pre-open.
- Not confirmed here: ONDS's actual 2026-09-22 close. The sandbox can't reach
  a price source.

**Consequence for #524's comment:** the comment above `fetchQuoteForMeta` in
`news/page.tsx:287-292` says the title "still showed a price because
computeIndicatorSeed falls back to the last close". It is inaccurate. There is
no fallback: the title always uses the last close. So `fetchQuoteForMeta` on
both pages spends an FMP call whose result the title discards.

The fix, if wanted: print `seed.price ?? seed.lastClose` in the title. It is
not applied here, per "report only". This PR's earnings-page comment states
the correct behaviour.

---

## 6. Unfinished / needs a decision

1. **The eight PRESET lines are not converted.** They are the fundamentals
   path. `ALLOWED_DOTTED`'s BRK.B entry says to remove it "when the
   fundamentals path normalises, not before". Converting only their URLs is
   the half-fix that entry warns about:
   - Results there are keyed by symbol.
   - The batch quote (`fundamentalsCache.ts:510`) comes back under FMP's
     spelling, which would then fail to match the dotted key.

   These eight cost FMP calls on every warm run today, for no data. The
   profile slot (line 22) and the P/E slice (line 26) are the worst. They
   need their own PR, which should decide whether `PRESET_UNIVERSE` should
   simply say `BRK-B`.
2. **The news/earnings title uses the history close, not the quote** (§5).
   Report only, not changed.
3. **Stooq removal:** held, per instruction.
4. **Rendering on the preview: NOT VERIFIED by me.** The checklist is in §4. Claude cannot reach the preview or production from this sandbox.
5. **FMP's dash preference is established per vendor, not per endpoint.** The
   evidence comes from `historical-price-eod` (`buildFmpSymbol`), the dashed
   screener rows, and `/stable/quote` (#524). Profile, income-statement,
   ratios-ttm, key-metrics-ttm, price-target-consensus, grades-consensus,
   earnings and news were converted on that basis, without a probe per
   endpoint. The preview check covers quote and profile. The rest are
   unmeasured.
