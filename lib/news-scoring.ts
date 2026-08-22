// ---------------------------------------------------------------------------
// The shared, symbol-agnostic half of the news engine.
//
// WHY THIS FILE EXISTS
// --------------------
// lib/stock-news-data.ts is two things bolted together: a per-symbol data
// fetcher (quote, history, company name, symbol-filtered FMP news) and a
// scoring/filtering/feed-shaping engine that is pure over a NewsItem[] and
// knows nothing about symbols at all. The sector news pages
// (lib/sector-news-data.ts) need the second half and none of the first.
//
// Rather than COPY the scorers -- which is exactly how
// app/stock/[symbol]/news/page.tsx ended up carrying ~400 lines of dead,
// drifted duplicates of scoreNews/scoreEarnings/scoreNewsItem that no longer
// match the live versions -- this module re-exports the real implementations
// from their existing home. One implementation, two consumers, no drift
// possible. The only change made to lib/stock-news-data.ts was adding `export`
// to functions that were already there, plus lifting newestFirst /
// oneArticlePerDate from a function-local scope to module scope. No behaviour
// changed for the existing stock news pages.
//
// If this engine is ever genuinely split out, move the bodies here and leave
// stock-news-data.ts importing from this file -- the seam is already correct.
// ---------------------------------------------------------------------------

export type {
  NewsItem,
  NewsScoreResult,
  EarningsScoreResult,
  ScoreTone,
  FmpStockNewsItem,
} from "@/lib/stock-news-data";

export {
  // Text hygiene
  stripHtmlTags,
  containsHtmlMarkup,
  cleanRssDescription,
  // Item-level classification
  keywordHits,
  isVideoOrLowQualitySource,
  isEarningsNewsItem,
  isEarningsExceptionSource,
  isLowValueNewsItem,
  isMajorWireSource,
  isActualEarningsResultNews,
  // Ranking / dedupe
  scoreNewsItem,
  dedupeNews,
  mergeNewsPools,
  newestFirst,
  // Aggregate scoring
  scoreNews,
  scoreEarnings,
  rankEarningsNews,
  getEarningsQualityGuardrails,
  scoreToTone,
  scoreToNewsLabel,
  scoreToEarningsLabel,
} from "@/lib/stock-news-data";
