// EVERY REDIS WRITE SITE, CLASSIFIED (#553 COWORK #82, 2026-10-01).
//
// scripts/check-redis-write-sites.mjs fails when a write site in lib/ or app/
// is missing from this list, or when an entry here no longer matches a site,
// so the list cannot go stale the way the 21 Sep debug list did.
//
// `key` is the first argument as written at the call site (whitespace
// collapsed, cut at 60 characters). `cls`:
//   listed  -- a whole-collection value: must be on the debug tool's
//              CANDIDATES (app/api/debug/redis-write-sizes); `candidate` is the
//              identifier or literal it appears under there.
//   chunked -- many values per request, with a fixed per-request bound (`bound`).
//   guarded -- measures its own request and refuses or logs an over-budget one.
//   row     -- one entity's value per request (one symbol, day, feed, page).
//   small   -- a lock, flag, stamp, counter or short list.
// Sizes are from the CODE-B #75 census (2026-10-01) where measured.
export const WRITE_SITES = [
  { file: "lib/ai-stock-analysis.ts", key: "getRedisKey(symbol", cls: "row" },
  { file: "lib/indexnowAuto.ts", key: "key", cls: "small" },
  { file: "lib/insightSnapshots.ts", key: "key", cls: "row" },
  { file: "lib/server/benchmarksBuilder.ts", key: "`${REDIS_PREFIX}:${scope}`", cls: "listed", candidate: '"msh:benchmarks:stock"' },
  { file: "lib/server/bullFlagsBuilder.ts", key: "PLAYS_REDIS_KEY", cls: "listed", candidate: "BULL_FLAGS_REDIS_KEY" },
  { file: "lib/server/bullFlagsBuilder.ts", key: "PLAYS_LOCK_KEY", cls: "small" },
  { file: "lib/server/capexContracts.ts", key: "CONTRACTS_KEY", cls: "listed", candidate: "CONTRACTS_KEY" },
  { file: "lib/server/capexReceivers.ts", key: "RECEIVERS_KEY", cls: "listed", candidate: "RECEIVERS_KEY" },
  { file: "lib/server/capexSpending.ts", key: "SPENDING_KEY", cls: "listed", candidate: "SPENDING_KEY" },
  { file: "lib/server/dailyPageLimit.ts", key: "key", cls: "small", count: 2 },
  { file: "lib/server/descendingTrianglesBuilder.ts", key: "DESCENDING_REDIS_KEY", cls: "listed", candidate: "DESCENDING_REDIS_KEY" },
  { file: "lib/server/descendingTrianglesBuilder.ts", key: "DESCENDING_LOCK_KEY", cls: "small" },
  { file: "lib/server/earningsCalendar.ts", key: "`${QUOTED_SYMBOL_PREFIX}:${symbol}`", cls: "row" },
  { file: "lib/server/earningsCalendar.ts", key: "key", cls: "small" },
  { file: "lib/server/earningsCalendar.ts", key: "`${DAY_COMPLETE_PREFIX}:${date}`", cls: "small" },
  { file: "lib/server/earningsCalendar.ts", key: "`${DAY_ITEMS_PREFIX}:${date}`", cls: "row" },
  { file: "lib/server/earningsCalendar.ts", key: "CALENDAR_SCAN_GATE_KEY", cls: "small" },
  { file: "lib/server/earningsSchedule.ts", key: "SCHEDULE_KEY", cls: "listed", candidate: "SCHEDULE_KEY" },
  { file: "lib/server/earningsStore.ts", key: "`${EARNINGS_REDIS_KEY_PREFIX}${clean}`", cls: "row" },
  { file: "lib/server/feedCache.ts", key: "`${REDIS_PREFIX}:${key}`", cls: "row" },
  { file: "lib/server/fundamentalsCache.ts", key: "`${SCREENER_FUND_KEY_PREFIX}${symbol}`", cls: "chunked", bound: "500 rows x <=207 B = 0.09 MB" },
  { file: "lib/server/fundamentalsCache.ts", key: "QUOTE_OFFSET_KEY", cls: "small" },
  { file: "lib/server/fundamentalsCache.ts", key: "`${FUND_KEY_PREFIX}${sym}`", cls: "chunked", bound: "universe rows x <=193 B = 0.12 MB" },
  { file: "lib/server/historyCache.ts", key: "NEWEST_BAR_STAMP_HASH", cls: "small" },
  { file: "lib/server/historyCache.ts", key: "key", cls: "small" },
  { file: "lib/server/historyCache.ts", key: "getHistoryRedisKey(normalized", cls: "row" },
  { file: "lib/server/ipoSecStore.ts", key: "IPO_FILINGS_REDIS_KEY", cls: "listed", candidate: "IPO_FILINGS_REDIS_KEY" },
  { file: "lib/server/jobGuard.ts", key: "dayKey(nowMs", cls: "small" },
  { file: "lib/server/jobGuard.ts", key: "key", cls: "small" },
  { file: "lib/server/jobRuns.ts", key: "`${JOB_RUN_PREFIX}:${job}`", cls: "small" },
  { file: "lib/server/marketData/jobs.ts", key: "TIINGO_QUOTES_KEY", cls: "listed", candidate: "TIINGO_QUOTES_KEY" },
  // Two sites (#553 COWORK #124): the night's re-pull and the already-complete backfill, both EOD_WRITE_CHUNK rows per pipeline.
  { file: "lib/server/marketData/jobs.ts", key: "tiingoEodKey(sym", cls: "chunked", bound: "EOD_WRITE_CHUNK rows per pipeline; pinned below", count: 2 },
  { file: "lib/server/marketData/jobs.ts", key: "TIINGO_EOD_META_KEY", cls: "small" },
  // Step 5 (#553 COWORK #98): the newest bar per symbol, one HSET a complete night (~150 B a row).
  // Two sites: the night's whole rewrite, and the backfill's HSET of at most EOD_WRITE_CHUNK new fields per pipeline (#553 COWORK #124).
  { file: "lib/server/marketData/jobs.ts", key: "TIINGO_EOD_LAST_KEY", cls: "listed", candidate: "TIINGO_EOD_LAST_KEY", count: 2 },
  // Step 5: the Tiingo jobs' symbols-only universe (~6 B a symbol), one SET per in-session warm-price-pool run,
  // and off hours only when the key is absent or older than 6 h (#553 COWORK #120).
  { file: "lib/server/tiingoUniverse.ts", key: "TIINGO_UNIVERSE_KEY", cls: "small" },
  { file: "lib/server/news/secFilingsStore.ts", key: "secFilingsNewsKey(symbol", cls: "row" },
  { file: "lib/server/newsStore.ts", key: "key", cls: "row" },
  { file: "lib/server/pickerChartsCache.ts", key: "PICKER_CHARTS_KEY", cls: "listed", candidate: "PICKER_CHARTS_KEY" },
  { file: "lib/server/pickersBuilder.ts", key: "chunkKeys[i]", cls: "chunked", bound: "chunkByBytes at REQUEST_BYTE_BUDGET" },
  { file: "lib/server/pickersBuilder.ts", key: "PICKERS_SYMBOLS_KEY", cls: "listed", candidate: "PICKERS_SYMBOLS_KEY" },
  { file: "lib/server/pickersBuilder.ts", key: "PICKERS_MANIFEST_KEY", cls: "listed", candidate: "PICKERS_MANIFEST_KEY" },
  { file: "lib/server/pickersBuilder.ts", key: "PICKERS_LAST_GOOD_MANIFEST_KEY", cls: "listed", candidate: "PICKERS_MANIFEST_KEY" },
  { file: "lib/server/pickersBuilder.ts", key: "PICKERS_REDIS_KEY", cls: "guarded" },
  { file: "lib/server/pickersBuilder.ts", key: "PICKERS_LOCK_KEY", cls: "small" },
  { file: "lib/server/pickersBuilder.ts", key: "`${EARNINGS_DUE_KEY_PREFIX}${symbol}`", cls: "small" },
  { file: "lib/server/pickersSecFundamentals.ts", key: "key", cls: "chunked", bound: "100 rows per HSET" },
  { file: "lib/server/playsBuilder.ts", key: "PLAYS_REDIS_KEY", cls: "listed", candidate: "PLAYS_REDIS_KEY" },
  { file: "lib/server/playsBuilder.ts", key: "PLAYS_LOCK_KEY", cls: "small" },
  { file: "lib/server/pricePool.ts", key: "PRICE_POOL_KEY", cls: "listed", candidate: "PRICE_POOL_KEY", count: 2 },
  { file: "lib/server/priceTiers.ts", key: "`${FOLD_KEY_PREFIX}${route}`", cls: "small" },
  { file: "lib/server/priceTiers.ts", key: "TIER1_KEY", cls: "listed", candidate: "TIER1_KEY" },
  { file: "lib/server/quoteData.ts", key: "getQuoteCacheKey(symbol", cls: "row" },
  { file: "lib/server/referenceCache.ts", key: "`${REFERENCE_KEY_PREFIX}${key}`", cls: "row" },
  { file: "lib/server/searchDemand.ts", key: "`${DEDUP_PREFIX}${ih}:${symbol}`", cls: "small" },
  { file: "lib/server/secColdCik.ts", key: "SEC_COLD_CIK_KEY", cls: "small" },
  { file: "lib/server/secColdFetch.ts", key: "coldNoneKey(clean", cls: "small" },
  { file: "lib/server/secColdFill.ts", key: "lockKey(symbol", cls: "small" },
  { file: "lib/server/secCoverReview.ts", key: "SEC_COVER_REVIEW_HASH", cls: "small" },
  { file: "lib/server/secFactStore.ts", key: "factKey(set.symbol", cls: "row" },
  { file: "lib/server/secFactStore.ts", key: "SEC_FIGURES_CHANGED_KEY", cls: "small" },
  { file: "lib/server/secFilingJob.ts", key: "FILING_STATE_KEY", cls: "row" },
  { file: "lib/server/secFilingJob.ts", key: "FILING_DUE_KEY", cls: "small" },
  { file: "lib/server/secFilingJob.ts", key: "FILING_CATCHUP_KEY", cls: "small" },
  { file: "lib/server/secListing.ts", key: "LAST_SEEN_CIK_KEY", cls: "listed", candidate: "LAST_SEEN_CIK_KEY" },
  { file: "lib/server/secListing.ts", key: "LISTING_CHANGES_KEY", cls: "small" },
  { file: "lib/server/secManifest.ts", key: "SEC_MANIFEST_KEY", cls: "listed", candidate: "SEC_MANIFEST_KEY" },
  { file: "lib/server/secManifest.ts", key: "SEC_FACTS_INDEX_BACKFILLED_KEY", cls: "small" },
  { file: "lib/server/secReportDatesStore.ts", key: "reportDatesKey(rec.symbol", cls: "row" },
  { file: "lib/server/secResultsDays.ts", key: "SEC_RESULTS_DAYS_KEY", cls: "chunked", bound: "200 fields per HSET", count: 2 },
  { file: "lib/server/secSicChange.ts", key: "SEC_SIC_CHANGES_KEY", cls: "small" },
  { file: "lib/server/secSuccessionFlags.ts", key: "SEC_SUCCESSION_EVENTS_HASH", cls: "small" },
  { file: "lib/server/secSuccessionFlags.ts", key: "SEC_SUCCESSION_FLAGS_HASH", cls: "small" },
  { file: "lib/server/secTickerMap.ts", key: "TICKER_REDIS_KEY", cls: "listed", candidate: "TICKER_REDIS_KEY", count: 2 },
  { file: "lib/server/sectorPanels.ts", key: "PERFORMANCE_KEY", cls: "listed", candidate: "SECTOR_PERFORMANCE_KEY" },
  { file: "lib/server/sectorPanels.ts", key: "key", cls: "small" },
  { file: "lib/server/sectorUniverse.ts", key: "SECTOR_INDEX_KEY", cls: "listed", candidate: "SECTOR_INDEX_KEY" },
  { file: "lib/server/stalenessQueue.ts", key: "seededKey(dataset", cls: "small" },
  { file: "lib/server/stockDataCache.ts", key: "`${KEY_PREFIX}${symbol}`", cls: "chunked", bound: "REFRESH_SLICE_SIZE (40) rows x <=713 B = 0.03 MB" },
  { file: "lib/server/symbolEviction.ts", key: "`${PRESET_ALARM_KEY_PREFIX}${symbol}`", cls: "small" },
  { file: "lib/server/symbolEviction.ts", key: "key", cls: "small" },
  { file: "lib/server/symbolEviction.ts", key: "STALE_BAR_DAYS_HASH", cls: "small" },
  { file: "lib/server/trapBlock.ts", key: "ipKey(ip", cls: "small" },
  { file: "lib/server/trapBlock.ts", key: "ja4Key(ja4 as string", cls: "small" },
  { file: "lib/server/warmTargets.ts", key: "WARM_TARGETS_KEY", cls: "listed", candidate: "WARM_TARGETS_KEY" },
  { file: "lib/server/warmTargets.ts", key: "WARM_TARGETS_FALLBACK_KEY", cls: "listed", candidate: "WARM_TARGETS_FALLBACK_KEY" },
  { file: "lib/youtube.ts", key: "UPLOADS_PLAYLIST_KEY", cls: "small" },
  { file: "lib/youtube.ts", key: "`${LAST_GOOD_LIST_PREFIX}:${limit}`", cls: "row" },
  { file: "lib/youtube.ts", key: "`${LAST_GOOD_VIDEO_PREFIX}:${videoId}`", cls: "row" },
  { file: "app/api/jobs/warm-earnings/route.ts", key: "EARNINGS_LOCK_KEY", cls: "small" },
  { file: "app/api/jobs/warm-earnings/route.ts", key: "EARNINGS_ENQUEUE_GUARD_KEY", cls: "small" },
  { file: "app/api/jobs/warm-earnings/route.ts", key: "`${EARNINGS_REDIS_KEY_PREFIX}${symbol}`", cls: "row" },
  { file: "app/api/jobs/warm-price-pool/route.ts", key: "PRICE_POOL_LOCK_KEY", cls: "small" },
  { file: "app/api/market/route.ts", key: "REDIS_KEY", cls: "listed", candidate: '"msh:market:state"' },
];

/** The write-call pattern the check scans for (receiver, verb, first argument). */
export const WRITE_RE = /\b([A-Za-z_][\w]*(?:\(\))?)\.(set|hset|mset|setex)\(\s*([^,)]+)/g;
/** Receivers that are Redis clients or pipelines (Map/Set .set calls are not writes). */
export const REDIS_RECEIVER = /redis|^r$|^p$|pipe|pipeline|client|mustRedis|writePipeline|^tx$/i;
export const normKey = (s) => s.replace(/\s+/g, " ").trim().slice(0, 60);
