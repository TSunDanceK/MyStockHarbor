import { NextResponse } from "next/server";

import { guardDebugRequest } from "@/lib/server/backfillAuth";
import { hasFmpCapacity, reserveFmpCallSlot } from "@/lib/server/historyCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Debug-only probe: which FMP endpoints does this plan actually serve, and how
// many symbols does each yield?
//
// WHY IT EXISTS
// -------------
// The discovery universe is mathematically saturated. Confirmed live 2026-08-06:
//
//   pool 353 + CURATED_UNIVERSE 54 = 407 = masterListSize     (exact)
//
// getNextDiscoveryBatch skips anything already in state.dynamic AND anything in
// CURATED_UNIVERSE, so with a 407-name master list there is nothing left for it
// to find -- ever. `[market] discovery admitted 0 symbols (attempted 0, ...)`.
// Raising UNIVERSE_CAP cannot help; the candidate pool is the binding
// constraint.
//
// HISTORICAL CONTEXT, CORRECTED 2026-08-22. The master list was 407 because
// buildExpandedDiscoveryMasterList unioned three FMP constituent endpoints with
// the static lists, and those endpoints answered 402 -- fetchFmpConstituentSymbols
// swallowed a non-ok response into [], so the failure was invisible.
//
// That function no longer exists and nothing in lib/ calls the plain constituent
// endpoints any more. The probes for them are kept as PLAN probes -- knowing
// which endpoints this plan serves is still worth one call each -- but they no
// longer describe anything live, and three of the notes below said they did.
// They nearly got re-reported as fresh bugs today, which is the cost of a note
// that outlives its subject.
//
// SAFETY
// ------
// * OWNER-ONLY (added 2026-08-07). Requires ?key=<EARNINGS_BACKFILL_KEY> and
//   reuses lib/server/backfillAuth's IP lockout (3 attempts / 10 min). Until
//   this route was ungated -- and since every invocation fires one FMP call per
//   probe OUTSIDE the per-minute guard, roughly 25 requests a minute was enough
//   to drain the entire 300/min budget. The crons and stock pages that DO
//   respect the guard would then start failing with no visible cause. That is a
//   cost/availability hole, not a data leak: the two points below were already
//   true and still are.
// * Fixed allowlist of endpoints -- no caller-supplied URLs, so this cannot be
//   used as an open proxy to FMP with the site's key.
// * Returns status codes and COUNTS plus a tiny sample, never a full symbol
//   list, so it is not a data-exfiltration surface.
// * Never echoes the API key, and strips it from any error text.
// * Every probe now goes through reserveFmpCallSlot(), so even an authorised
//   run can never outrun the shared budget, and bails early via hasFmpCapacity
//   if headroom is short. ~12 calls per invocation. Not on any cron; by hand.
//
// The key is deliberately EARNINGS_BACKFILL_KEY rather than CRON_SECRET: that
// one guards the warm jobs (warm-price-pool alone is ~175 sequential FMP calls
// per run), and its isAuthorized() fails OPEN when the var is unset. Sharing it
// with a browser-opened route would put the crons' credential in query strings,
// access logs and Referer headers. checkBackfillKey fails CLOSED.

type Probe = {
  id: string;
  path: string;
  note: string;
  /**
   * API vintage. Defaults to "stable", which is every probe that predates the
   * press-release set below. Press releases historically lived on v3 and may
   * still be served there when the stable path is restricted, so a probe that
   * only ever asks `stable/` cannot distinguish "not on this plan" from "not at
   * this address".
   */
  base?: "stable" | "api/v3" | "api/v4";
  /**
   * HTTP method. Defaults to GET, which is every probe except the HEAD one.
   *
   * A HEAD probe asks a different question from every other probe here: not
   * "what does this endpoint return" but "can the SIZE of what it returns be
   * learned without paying for the body".
   */
  method?: "GET" | "HEAD";
};

// `symbol`-bearing list endpoints worth knowing about, plus two known-good
// controls so a total failure is distinguishable from a plan restriction.
const PROBES: Probe[] = [
  { id: "sp500-constituent", path: "sp500-constituent", note: "STALE NOTE CORRECTED 2026-08-22: no longer used by anything. buildExpandedDiscoveryMasterList is gone; nothing in lib/ calls the plain constituent endpoints. Kept as a plan probe only. Answers 402." },
  { id: "nasdaq-constituent", path: "nasdaq-constituent", note: "Not used by anything either -- see the sp500 note above. Plan probe only." },
  { id: "dowjones-constituent", path: "dowjones-constituent", note: "Not used by anything either -- see the sp500 note above. Plan probe only." },
  { id: "most-actives", path: "most-actives", note: "CONTROL -- known working (price pool uses it)" },
  { id: "biggest-gainers", path: "biggest-gainers", note: "CONTROL -- known working" },
  {
    id: "company-screener-1b",
    path: "company-screener?marketCapMoreThan=1000000000&exchange=NASDAQ,NYSE&isActivelyTrading=true&limit=1000",
    note: "BEST CANDIDATE -- if this works it can supply hundreds of names",
  },
  {
    id: "company-screener-300m",
    path: "company-screener?marketCapMoreThan=300000000&exchange=NASDAQ,NYSE&isActivelyTrading=true&limit=1000",
    note: "wider net, same endpoint",
  },
  { id: "stock-list", path: "stock-list", note: "full symbol directory if available" },

  // ==== DATA PIPELINE REBUILD GATE (2026-09-01) ====================________
  // Eight tasks depend on the answers below and none should start without them.
  // Three claims have already been withdrawn in two days because they were
  // inferences from a sample rather than measurements.

  // Q1. DOES `limit` EXCEED 1000? If it caps, the coverage floor is set by FMP's
  // pagination rather than by us, and banding (Q2) becomes the only route to
  // wider coverage. Read `rows`: 1000 exactly means capped.
  {
    id: "Q1-screener-limit-3000",
    path: "company-screener?marketCapMoreThan=1000000000&exchange=NASDAQ,NYSE&isActivelyTrading=true&limit=3000",
    note: "Q1 GATE: rows === 3000 means the cap is ours to raise; rows === 1000 means FMP paginates and banding is the only route to wider coverage.",
  },

  // Q2. IS marketCapLowerThan SUPPORTED? THE TRAP: a 200 that ignores the
  // parameter and returns the same top-1000 is a FAIL that looks like a PASS.
  // The status code cannot answer this -- only the marketCap VALUES can, which
  // is why marketCapMin/Max and bandRespected are computed below and compared
  // against the unbanded company-screener-1b probe.
  {
    id: "Q2-screener-band-1b-2b",
    path: "company-screener?marketCapMoreThan=1000000000&marketCapLowerThan=2000000000&exchange=NASDAQ,NYSE&isActivelyTrading=true&limit=1000",
    note: "Q2 GATE: PASS only if every returned marketCap falls inside 1-2B AND the symbol set differs from company-screener-1b. Read bandRespected and marketCapMax, NOT httpStatus.",
  },

  // Q4. THE MOST IMPORTANT ONE. The plan moves five datasets off a clock and
  // onto the earnings calendar, worth ~885 MB/month. Safe for the statements,
  // which change on filing. ratios-ttm is trailing-twelve-month and partly
  // PRICE-derived, so it may legitimately move daily -- and if a meaningful
  // share of it does, it must NOT go on the earnings trigger.
  //
  // Two symbols, not one: a single response cannot distinguish "this field is
  // price-derived" from "this issuer happens to report it".
  {
    id: "Q4-ratios-ttm-AAPL",
    path: "ratios-ttm?symbol=AAPL",
    note: "Q4 GATE: read priceDerivedFields. A meaningful share moving with price means ratios-ttm stays on a clock while the other four move to the earnings trigger.",
  },
  {
    id: "Q4-ratios-ttm-KO",
    path: "ratios-ttm?symbol=KO",
    note: "Q4 second symbol -- one response cannot separate a price-derived FIELD from an issuer that happens to report it.",
  },

  // Q5. DOES isActivelyTrading FLIP FOR DELISTED NAMES? The whole delisting
  // mechanism rests on this boolean. FB became META; WFM was taken private.
  // ABSENCE from the screener is an equally good signal and worth recording as
  // the mechanism instead -- so both the profile and the screener are asked.
  {
    id: "Q5-profile-FB",
    path: "profile?symbol=FB",
    note: "Q5 GATE: does a renamed ticker still resolve, and what does isActivelyTrading say? Read sampleRow.isActivelyTrading. An empty array is itself the answer.",
  },
  {
    id: "Q5-profile-WFM",
    path: "profile?symbol=WFM",
    note: "Q5 second dead ticker (taken private, not renamed) -- the two delist for different reasons and may behave differently.",
  },
  {
    id: "Q5-profile-AAPL-control",
    path: "profile?symbol=AAPL",
    note: "Q5 CONTROL: a live name, so 'FB returns nothing' is distinguishable from 'the profile endpoint returns nothing'.",
  },

  // Q9. DOES THE IPO CALENDAR GIVE USABLE LEAD TIME? A new listing has to be
  // visible BEFORE it trades for the universe to admit it in advance. rowKeys
  // answers the second half: whether the row carries enough to admit on.
  {
    id: "Q9-ipo-calendar",
    path: "ipos-calendar",
    note: "Q9 GATE: read rows, oldestPublished/newestPublished for the date range, and rowKeys in full -- lead time is only useful if the row also carries enough to admit the symbol.",
  },

  // INDEX CHANGES (2026-08-22). lib/server/indexChanges.ts calls all three
  // `historical-*-constituent` endpoints and NONE of them were probed -- while
  // the plain sp500/nasdaq/dowjones-constituent variants all answer 402 on this
  // plan.
  //
  // THAT COMBINATION IS THE WHOLE POINT. fetchIndexChanges swallows a non-ok
  // response, exactly as fetchFmpConstituentSymbols does, so if the historical
  // variants are restricted too the feature returns an empty list and renders as
  // "no recent index changes" -- indistinguishable from a genuinely quiet week,
  // forever, with nothing reporting it
  // (claude/traps/absence-needs-the-producer-to-have-run.md).
  //
  // All three, not just S&P 500: they are three separate endpoints on the same
  // plan and there is no reason to assume they share an answer.
  {
    id: "historical-sp500-constituent",
    path: "historical-sp500-constituent",
    note: "USED LIVE by lib/server/indexChanges.ts -- a 402 here means that feature has been silently empty",
  },
  {
    id: "historical-nasdaq-constituent",
    path: "historical-nasdaq-constituent",
    note: "USED LIVE by lib/server/indexChanges.ts -- same question, separate endpoint",
  },
  {
    id: "historical-dowjones-constituent",
    path: "historical-dowjones-constituent",
    note: "USED LIVE by lib/server/indexChanges.ts -- same question, separate endpoint",
  },
  // Decides whether warmFundamentals' quote stage is permanently one call per
  // symbol or could be one call per 50.
  //
  // fetchQuoteFundamentals comments that stable/batch-quote answers 402 on this
  // plan and falls back accordingly -- but that claim was never probed here,
  // and a comment is not a measurement
  // (claude/traps/grep-finds-the-comment-not-the-code.md is the same shape:
  // prose standing in for the code's actual behaviour). If this returns 200 the
  // fallback is costing ~50x the calls it needs to and the rotation offset is a
  // workaround for a problem that does not exist; if it 402s, the offset is a
  // permanent requirement. The paired single-symbol quote is the control that
  // separates "batch is restricted" from "quotes are broken".
  {
    id: "batch-quote",
    path: "batch-quote?symbols=AAPL,MSFT,NVDA,AVGO,ORCL",
    note: "DECIDES the quote-stage cost model -- 402 here means one FMP call per symbol, permanently",
  },
  { id: "quote-single", path: "quote?symbol=AAPL", note: "CONTROL for batch-quote -- the per-symbol fallback path" },
  // Does the screener honour fund/ETF exclusion? The live universe picked up
  // AAGTX / AALTX / CFNAX -- five letters ending in X, the US mutual-fund
  // convention -- so the current filter (market cap + exchange + actively
  // trading) is clearly not equities-only. `fundLikeSymbols` below measures it.
  {
    id: "screener-no-funds",
    path: "company-screener?marketCapMoreThan=1000000000&exchange=NASDAQ,NYSE&isActivelyTrading=true&isEtf=false&isFund=false&limit=1000",
    note: "SHIPPED, not a candidate: screenerFundamentals.ts already sends isEtf=false&isFund=false (see its URL builder). Kept as a regression probe -- if the fund-like count climbs again, the filter has been dropped.",
  },

  // SECTOR NEWS (2026-08-07). Does stable/news/stock actually honour a
  // multi-symbol `symbols=` list? lib/sector-news-data.ts assumes it does (the
  // per-stock path passes one symbol into a parameter documented as a list),
  // and the whole ~22-44 calls/hour cost model rests on it. `uniqueSymbols`
  // answers it directly: a list-aware endpoint returns articles tagged across
  // many of the requested tickers, a single-symbol one does not. Note this
  // probe's rows are ARTICLES, not companies, so `rows` here means article
  // count.
  //
  // ANSWERED 2026-08-07: 10 symbols requested, 100 rows, uniqueSymbols 10.
  // It is list-aware. Kept as a regression check -- if FMP ever narrows this,
  // the sector pages get quietly worse rather than erroring, so it is worth
  // being able to re-confirm in one call.
  //
  // (The sector-performance question lives in buildDatedProbes below, because
  // those two endpoints need a date parameter.)
  {
    id: "news-stock-multi-symbol",
    path: "news/stock?symbols=AAPL,MSFT,NVDA,AVGO,ORCL,CRM,AMD,ADBE,CSCO,ACN&limit=100",
    note: "SECTOR NEWS -- does symbols= accept a LIST? (rows = articles, not companies)",
  },

  // EARNINGS NEWS (2026-08-22). Is there a DEDICATED source, so the earnings
  // section stops being a keyword filter over a general feed?
  //
  // Today /stock/[symbol]/news finds earnings stories by substring-matching 14
  // words against a general news feed. That is the wrong shape twice over: it
  // misclassifies (a story headlined "...Research Lab" landed in the earnings
  // section because its body said "headquartered", which contains "quarter"),
  // and it pays for 50 general articles per symbol to keep a handful of real
  // ones -- on the endpoint that is ~34% of the 30-day FMP byte cap.
  //
  // A company's own press releases ARE the earnings releases ("Micron
  // Technology, Inc. Reports Results for the Third Quarter of Fiscal 2026").
  // If any of these four answer 200, the filter is replaceable rather than
  // tunable, and almost certainly cheaper in bytes as well as more accurate.
  // If they all answer 402, the keyword filter is what there is and the limit
  // question is the only lever left -- which is exactly the fork that decides
  // whether tuning `limit=50` is worth doing at all.
  //
  // READ sampleRow AND titleSample, not just httpStatus: an endpoint that
  // returns 200 with generic wire copy rather than issuer releases answers the
  // question NO just as firmly as a 402 does.
  {
    id: "press-releases-by-symbol",
    path: "news/press-releases?symbols=MU,AAPL&limit=20",
    note: "BEST CANDIDATE -- issuer press releases per symbol; would replace the keyword filter outright",
  },
  {
    id: "press-releases-latest",
    path: "news/press-releases-latest?limit=50",
    note: "market-wide variant -- if list-aware like news/stock, one call could cover many symbols",
  },
  {
    id: "press-releases-v3",
    path: "press-releases/MU?limit=20",
    base: "api/v3",
    note: "SAME QUESTION, older vintage -- separates 'not on this plan' from 'not at this address'",
  },
  {
    id: "earnings-transcript-latest",
    path: "earning-call-transcript-latest?limit=10",
    note: "LONG SHOT -- transcripts are not headlines, but their presence dates the actual report",
  },
];

// The two sector-performance probes need a date, and the first run (2026-08-07)
// got this wrong in a way worth not repeating: `sector-performance-snapshot`
// was sent bare and answered
//
//   400 "Query Error: Invalid or missing query parameter - date"
//
// which reads as failure but is the opposite. Every genuinely plan-restricted
// endpoint in that same response (sp500/nasdaq/dowjones-constituent) answered
// 402 "Restricted Endpoint ... upgrade your plan". A 400 naming a missing
// parameter means the plan check PASSED and the request reached validation --
// so the endpoint is probably available and was simply never exercised.
//
// Built per request rather than hardcoded so the diagnostic cannot rot into
// asking about a date months in the past.
function buildDatedProbes(now: Date): Probe[] {
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // Ask about the last completed session, not today: before the close there is
  // no snapshot to return, and an empty 200 is ambiguous with a bad request.
  // Walk back at least one day, then off any weekend. Holidays aren't handled
  // -- an empty 200 on a holiday still proves availability, which is the
  // question being asked.
  const day = new Date(now);
  day.setUTCDate(day.getUTCDate() - 1);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) {
    day.setUTCDate(day.getUTCDate() - 1);
  }

  const to = iso(day);
  const from = iso(new Date(day.getTime() - 30 * 24 * 60 * 60 * 1000));

  // THE GATE for claude/news-as-stored-dataset-spec-2026-08-22.md, and the only
  // question that matters before any of it gets built.
  //
  // `from=` is in /stable/news/stock's signature. Nothing has ever confirmed it
  // FILTERS rather than being accepted and silently ignored, and the whole
  // stored-dataset design rests on it: without incremental fetching there is no
  // incremental refresh, and the design collapses to tuning `limit`.
  //
  // A PAIR, not a single probe, because a lone `from=` request proves nothing.
  // 200 with rows looks like success whether the parameter worked or was
  // dropped on the floor; only the baseline says which. Read `oldestPublished`
  // on both rows:
  //
  //   from-row oldest >= yesterday          -> it filters. Design cleared.
  //   from-row oldest == baseline oldest    -> ignored. Stop.
  //   from-row oldest anywhere before `from`-> ignored. Stop.
  //
  // Same shape as the 400-vs-402 lesson above: the response CODE is not the
  // answer, the response CONTENT is.
  const gateFrom = gateFromDate(now);

  // DOES historical-price-eod/full CARRY A LIVE-UPDATING BAR FOR TODAY?
  //
  // This decides whether a price-pool-synthesised intraday bar APPENDS or
  // REPLACES, and getting it wrong corrupts every indicator at once:
  // parseFmpHistoricalRows sorts by date and does NOT collapse duplicates, so
  // two Points carrying today's date both survive into the series feeding
  // MA/RSI/MACD/ATR and the support-resistance detector.
  //
  // A SHORT WINDOW, not the full 1400 days. historical-price-eod/full is ~180 KB
  // a call and 63% of the 30-day byte cap (9.33 of 14.86 GB, measured on FMP's
  // dashboard); asking for a week answers the same question for a fraction of
  // it. If from/to are not honoured here the probe costs one full payload --
  // acceptable once for a diagnostic, and `rows` in the result says which
  // happened.
  //
  // PAIRED with a quote for the SAME symbol, because the question is not only
  // "is there a bar dated today" but "does its close track the live price".
  const todayIso = iso(now);
  const weekAgoIso = iso(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));

  // The window earningsCalendar.ts actually fetches: today-3d through
  // end-of-month+3. Reproduced rather than approximated, so the row count the
  // probe reports is the row count production pays for.
  const calFrom = iso(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000));
  const calTo = iso(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0) + 3 * 24 * 60 * 60 * 1000)
  );

  return [
    // Q6. WHAT IS IN THE EARNINGS CALENDAR'S 697 KB? It is the trigger the whole
    // event-driven model reads, so the question behind the size is coverage: a
    // symbol missing from the calendar would never get its fundamentals
    // refreshed again. Same window earningsCalendar.ts uses (today-3d through
    // end-of-month+3) so the numbers describe what production actually fetches.
    //
    // Read rows, uniqueSymbols, the date range, and epsEstimatedRows: a
    // calendar full of rows carrying no estimate is a different kind of
    // coverage from one that is simply small.
    {
      id: "Q6-earnings-calendar",
      path: `earnings-calendar?from=${calFrom}&to=${calTo}`,
      note: "Q6 GATE: rows/uniqueSymbols/epsEstimatedRows decide whether the calendar can be the refresh trigger for every symbol or only a subset. A symbol absent here would never refresh again under the event-driven model.",
    },

    // CAN A COUNT BE HAD WITHOUT RETRIEVING THE ARTICLES?
    //
    // /stable/news/stock is the largest line on the byte meter. If HEAD returned
    // a Content-Length, the size of a window could be sampled cheaply -- and a
    // 4-week headline chart could be derived rather than paid for in reach.
    //
    // THE OTHER HALF OF THAT QUESTION IS ALREADY ANSWERED, and answered NO. The
    // news response is a bare JSON array with eight per-row keys and no envelope
    // (see `rowKeys` on the baseline probe below), so there is no `total` field
    // to read. A count can only come from counting rows, which means having them.
    //
    // So HEAD is the last route to a free count, and the bar is high: it passes
    // ONLY if it returns a Content-Length that MATCHES the GET's actual body
    // length. Three ways it fails and two of them look like success --
    //
    //   * 405 / 404: unsupported. Clear.
    //   * 200 with no content-length: looks fine, tells you nothing.
    //   * 200 with a content-length that does not match the GET body: the worst
    //     case, because it is a number, and a wrong number is worse than none.
    //
    // Deliberately the SAME URL as the baseline below, so the two are directly
    // comparable rather than approximately so.
    {
      id: "news-stock-HEAD",
      path: "news/stock?symbols=MU&limit=50",
      method: "HEAD",
      note: "Free-count probe. PASS only if contentLength is present AND equals bodyBytes on news-stock-BASELINE-no-from.",
    },
    {
      id: "history-today-bar",
      path: `historical-price-eod/full?symbol=MU&from=${weekAgoIso}&to=${todayIso}`,
      note: `TODAY-BAR probe -- is there a bar dated ${todayIso}, and does its close track the live quote? MUST be run mid-session; see readTodayBarProbe.`,
    },
    {
      id: "history-today-bar-QUOTE",
      path: "quote?symbol=MU",
      note: "CONTROL for history-today-bar -- same symbol, same moment. The live price the newest bar is compared against.",
    },
    {
      id: "news-stock-BASELINE-no-from",
      path: "news/stock?symbols=MU&limit=50",
      note: "GATE CONTROL -- the same request WITHOUT from=. Compare oldestPublished against the row below. Also the byte-length reference for news-stock-HEAD.",
    },
    {
      id: "news-stock-GATE-from",
      path: `news/stock?symbols=MU&limit=50&from=${gateFrom}`,
      note: `GATE -- does from= filter? PASS only if oldestPublished >= ${gateFrom}. Equal to the baseline means IGNORED.`,
    },
    {
      id: "sector-performance-snapshot",
      path: `sector-performance-snapshot?date=${to}`,
      note: `SECTOR NEWS -- 1 call for all 11 sectors if this works on Starter (date=${to})`,
    },
    {
      id: "historical-sector-performance",
      path: `historical-sector-performance?sector=Technology&from=${from}&to=${to}`,
      note: `SECTOR NEWS -- longer windows; NOTE averageChange is equal-weighted and split per exchange, so it is a DIFFERENT metric from the cap-weighted proxy the pages compute (${from}..${to})`,
    },
  ];
}

// STEP 1 (2026-08-06 follow-up session): is company-screener's price/volume
// live-ish or a stale multi-day average? The debug sample above only ever
// shows row[0] (NVDA, the largest name by market cap), which is useless for
// checking liquidity-dependent staleness. Track a couple of fixed, non-mega-cap
// symbols through every screener-shaped probe so they can be diffed against
// /api/quote (the same FMP `stable/quote` the price pool and stock pages use)
// without widening this route into a symbol-lookup proxy -- the set is fixed
// and tiny, same safety posture as the rest of this file.
const TARGET_SYMBOLS = ["NVDA", "F", "COO"];

// Leave room for the crons and live page traffic. This route is a diagnostic;
// it should always lose a race against real work.
const FMP_MIN_HEADROOM_CALLS = 60;

/** Oldest / newest publish timestamp across a probe's rows, or null. */
function publishedRange(rows: Record<string, unknown>[] | null): {
  oldest: string | null;
  newest: string | null;
} {
  if (!rows) return { oldest: null, newest: null };
  // A real min/max over every row rather than reading the first and last. FMP
  // returns news newest-first today, but a probe that ASSUMES the ordering it
  // is trying to verify is not a measurement.
  const times = rows
    .map((row) => String(row?.publishedDate ?? row?.date ?? "").trim())
    .filter(Boolean)
    .map((value) => ({ value, t: new Date(value).getTime() }))
    .filter((entry) => Number.isFinite(entry.t));
  if (!times.length) return { oldest: null, newest: null };
  return {
    oldest: times.reduce((a, b) => (b.t < a.t ? b : a)).value,
    newest: times.reduce((a, b) => (b.t > a.t ? b : a)).value,
  };
}

/**
 * The `from=` value the gate probe sends.
 *
 * ONE definition, used by the probe that sends it and by the reader that judges
 * against it. Two copies of "yesterday" that drift by a day would make the gate
 * report FAIL on a working parameter, which is the worst outcome available here
 * -- it would kill a sound design (claude/traps/two-validators-for-one-value.md).
 */
export function gateFromDate(now: Date): string {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type GateRow = {
  id: string;
  ok: boolean;
  httpStatus: number | null;
  rows: number | null;
  oldestPublished: string | null;
};

/**
 * Does `from=` on /stable/news/stock actually filter?
 *
 * THE ONLY QUESTION THAT MATTERS before claude/news-as-stored-dataset-spec-2026-08-22.md
 * gets built, and the reason it needs reading rather than eyeballing: a 200 with
 * 50 rows looks identical whether the parameter worked or was accepted and
 * dropped. Only the comparison against the no-`from` baseline separates them.
 *
 * Deliberately reports UNKNOWN rather than guessing when either probe failed or
 * carried no dates. An inconclusive gate must not read as a pass -- that is the
 * whole shape of the failure this project keeps paying for
 * (claude/traps/absence-needs-the-producer-to-have-run.md).
 */
export function readNewsFromGate(
  baseline: GateRow | undefined,
  gated: GateRow | undefined,
  fromDate: string
): { verdict: "PASS" | "FAIL" | "UNKNOWN"; detail: string; clearedToBuild: boolean } {
  if (!baseline || !gated || !baseline.ok || !gated.ok) {
    return {
      verdict: "UNKNOWN",
      detail:
        `One or both gate probes did not return 200 (baseline ${baseline?.httpStatus ?? "missing"}, ` +
        `from ${gated?.httpStatus ?? "missing"}). The gate is unanswered, which is NOT a pass.`,
      clearedToBuild: false,
    };
  }
  if (!baseline.oldestPublished || !gated.oldestPublished) {
    return {
      verdict: "UNKNOWN",
      detail:
        "A gate probe returned rows with no usable publish dates, so the comparison cannot be made. " +
        "The gate is unanswered, which is NOT a pass.",
      clearedToBuild: false,
    };
  }

  const fromMs = new Date(`${fromDate}T00:00:00Z`).getTime();
  const gatedOldestMs = new Date(gated.oldestPublished).getTime();

  if (!Number.isFinite(fromMs) || !Number.isFinite(gatedOldestMs)) {
    return {
      verdict: "UNKNOWN",
      detail:
        "Unparseable dates in the gate comparison, so it cannot be made. " +
        "The gate is unanswered, which is NOT a pass.",
      clearedToBuild: false,
    };
  }

  if (gatedOldestMs >= fromMs) {
    return {
      verdict: "PASS",
      detail:
        `from=${fromDate} returned nothing older than ${gated.oldestPublished}, while the same request ` +
        `without it reached back to ${baseline.oldestPublished}. The parameter filters. ` +
        "Incremental fetching is possible and the stored-dataset design is cleared to build.",
      clearedToBuild: true,
    };
  }

  return {
    verdict: "FAIL",
    detail:
      `from=${fromDate} still returned an item published ${gated.oldestPublished}, which predates it ` +
      `(baseline oldest: ${baseline.oldestPublished}). The parameter is accepted and IGNORED. ` +
      "Incremental fetching is impossible; the stored-dataset design stops here and the remaining " +
      "lever is tuning `limit`.",
    clearedToBuild: false,
  };
}

export type HeadRow = {
  id: string;
  httpStatus: number | null;
  contentLength: number | null;
  bodyBytes: number;
};

/**
 * Can the size of a news response be learned without retrieving it?
 *
 * READ RATHER THAN EYEBALLED, because two of the three failure modes look like
 * success. A 200 is not a pass, and a present Content-Length is not a pass
 * either -- only a Content-Length that MATCHES the GET's real body length is,
 * because a wrong number is worse than no number: it would be believed.
 *
 * The tolerance is deliberately tight (1%). This is not a measurement subject
 * to noise; the same URL fetched twice seconds apart should return the same
 * bytes, and a large gap means the header is describing something other than
 * what GET actually sends -- a compressed length against a decompressed body,
 * most likely, which is precisely the layer confusion this project has paid for
 * before (claude/traps/measuring-the-wrong-layer.md).
 */
export function readHeadProbe(
  head: HeadRow | undefined,
  get: HeadRow | undefined
): { verdict: "PASS" | "FAIL" | "UNKNOWN"; detail: string; freeCountPossible: boolean } {
  if (!head) {
    return {
      verdict: "UNKNOWN",
      detail: "The HEAD probe did not run (skipped for budget, or absent). Not a pass.",
      freeCountPossible: false,
    };
  }
  if (head.httpStatus === null) {
    return { verdict: "UNKNOWN", detail: "The HEAD probe threw before returning a status. Not a pass.", freeCountPossible: false };
  }
  if (head.httpStatus === 405 || head.httpStatus === 404 || head.httpStatus >= 400) {
    return {
      verdict: "FAIL",
      detail:
        `HEAD returned ${head.httpStatus}. The method is not supported here, so a size cannot be ` +
        "learned without the body. Combined with the response being a bare array with no envelope " +
        "and therefore no total field, there is no free count: a count requires retrieving the " +
        "articles, and a 4-week chart has to be paid for in reach rather than derived.",
      freeCountPossible: false,
    };
  }
  if (head.contentLength === null) {
    return {
      verdict: "FAIL",
      detail:
        `HEAD returned ${head.httpStatus} but no Content-Length. A 200 with no length is the ` +
        "failure that looks like success -- it answers the question with nothing. Same conclusion: " +
        "no free count.",
      freeCountPossible: false,
    };
  }
  if (!get || !get.bodyBytes) {
    return {
      verdict: "UNKNOWN",
      detail:
        `HEAD reported Content-Length ${head.contentLength}, but the GET baseline it must be ` +
        "checked against did not return a body. An unverified length is not a pass.",
      freeCountPossible: false,
    };
  }

  const delta = Math.abs(head.contentLength - get.bodyBytes);
  const ratio = delta / get.bodyBytes;
  if (ratio <= 0.01) {
    return {
      verdict: "PASS",
      detail:
        `HEAD's Content-Length (${head.contentLength}) matches the GET body (${get.bodyBytes}) ` +
        `within ${(ratio * 100).toFixed(2)}%. A response's size CAN be sampled without retrieving ` +
        "it. Note this gives a byte size, not an article count -- deriving one from the other " +
        "assumes a stable bytes-per-article, which is a separate thing to measure before relying on.",
      freeCountPossible: true,
    };
  }
  return {
    verdict: "FAIL",
    detail:
      `HEAD's Content-Length (${head.contentLength}) does NOT match the GET body ` +
      `(${get.bodyBytes}) -- off by ${delta} bytes, ${(ratio * 100).toFixed(1)}%. This is the worst ` +
      "of the three outcomes: a number that would be believed and is wrong. Most likely a " +
      "compressed length against a decompressed body. Do not build on it.",
    freeCountPossible: false,
  };
}

export type TodayBarRow = {
  id: string;
  ok: boolean;
  rows: number | null;
  newestPublished: string | null;
  sampleRow: Record<string, unknown> | null;
};

/**
 * Is the newest EOD bar today's, and is it live?
 *
 * REFUSES TO ANSWER OUTSIDE MARKET HOURS, which is the most important thing in
 * here. Run at 07:00 UTC this finds no bar dated today and would read as "it
 * appends" -- the wrong answer, arrived at confidently, because before the open
 * there is genuinely nothing to find. Absence means something only once there
 * has been an opportunity for presence
 * (claude/traps/absence-needs-the-producer-to-have-run.md).
 *
 * The regular session is 13:30-20:00 UTC while New York is on EDT. The window
 * below is deliberately narrower at both ends: a probe run in the first or last
 * minutes of the session is the least informative moment to ask.
 */
export function readTodayBarProbe(
  history: TodayBarRow | undefined,
  quote: TodayBarRow | undefined,
  now: Date
): {
  verdict: "LIVE" | "APPENDS" | "UNKNOWN";
  detail: string;
  synthesisedBarMust: "replace" | "append" | "undecided";
} {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const weekday = now.getUTCDay();
  const midSession =
    weekday >= 1 && weekday <= 5 && utcMinutes >= 14 * 60 && utcMinutes <= 19 * 60 + 45;

  if (!midSession) {
    return {
      verdict: "UNKNOWN",
      detail:
        `Run at ${now.toISOString()} — outside the Mon-Fri 14:00-19:45 UTC window this probe is ` +
        "valid in. Before the open there is no today bar to find, so a 'no' here would mean nothing " +
        "and would read as 'it appends'. Re-run mid-session.",
      synthesisedBarMust: "undecided",
    };
  }
  if (!history?.ok || !quote?.ok) {
    return {
      verdict: "UNKNOWN",
      detail: "One or both probes did not return 200. Not an answer.",
      synthesisedBarMust: "undecided",
    };
  }
  if (!history.newestPublished) {
    return {
      verdict: "UNKNOWN",
      detail: `The history probe returned ${history.rows ?? 0} rows with no usable dates. Not an answer.`,
      synthesisedBarMust: "undecided",
    };
  }

  const today = now.toISOString().slice(0, 10);
  const newestDay = history.newestPublished.slice(0, 10);

  if (newestDay < today) {
    return {
      verdict: "APPENDS",
      detail:
        `Mid-session, the newest EOD bar is ${newestDay} — not ${today}. Today's bar only appears ` +
        "after the close, so a synthesised intraday bar APPENDS. Add a duplicate-date guard to " +
        "parseFmpHistoricalRows anyway: this answer holds only until FMP changes it, and the " +
        "failure would be silent.",
      synthesisedBarMust: "append",
    };
  }

  const barClose = Number(history.sampleRow?.close);
  const livePrice = Number(quote.sampleRow?.price);
  const comparable = Number.isFinite(barClose) && Number.isFinite(livePrice) && livePrice > 0;
  const drift = comparable ? Math.abs(barClose - livePrice) / livePrice : null;

  return {
    verdict: "LIVE",
    detail:
      `Mid-session, a bar dated ${newestDay} already exists. ` +
      (drift === null
        ? "Its close could not be compared against the quote. "
        : `Its close (${barClose}) sits ${(drift * 100).toFixed(2)}% from the live quote ` +
          `(${livePrice}), so it is ${drift < 0.005 ? "tracking the live price" : "present but not tracking closely — either way it exists"}. `) +
      "A synthesised intraday bar must REPLACE it, never append: two Points carrying the same date " +
      "both survive parseFmpHistoricalRows, which sorts by date and does not collapse duplicates, " +
      "and every indicator downstream reads the series positionally.",
    synthesisedBarMust: "replace",
  };
}

function scrub(text: string, apiKey: string) {
  return apiKey ? text.split(apiKey).join("<key>") : text;
}

export async function GET(request: Request) {
  const denied = await guardDebugRequest(request);
  if (denied) return denied;

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing FMP_API_KEY" }, { status: 500 });
  }

  // ---- GATE ANALYSIS HELPERS (2026-09-01) --------------------------------
  //
  // Each of these turns a raw array into the ONE number its question is decided
  // by. They live here rather than in the probe notes because a note describing
  // a number nobody computed is how three claims got withdrawn this week.

  /** Q2/Q3: the market-cap span of a screener response, and its tail. */
  const marketCapStats = (rows: Record<string, unknown>[] | null) => {
    if (!rows?.length) return { min: null, max: null, lastSymbol: null, lastMarketCap: null };
    const caps = rows
      .map((r) => Number(r?.marketCap))
      .filter((n) => Number.isFinite(n) && n > 0);
    const last = rows[rows.length - 1];
    return {
      min: caps.length ? Math.min(...caps) : null,
      max: caps.length ? Math.max(...caps) : null,
      // THE REAL COVERAGE FLOOR, and nothing recorded it before. The existing
      // screener probe samples the first five rows and reports nothing about
      // the tail, so "what is the smallest company we actually see" has never
      // been measurable. SCREENER_MIN_MARKET_CAP is set to $1B but is INERT --
      // the $300M and $1B calls returned byte-identical responses, which means
      // `limit` truncates before the floor ever binds. This number is where the
      // truncation actually lands.
      lastSymbol: String(last?.symbol ?? "") || null,
      lastMarketCap: Number.isFinite(Number(last?.marketCap)) ? Number(last?.marketCap) : null,
    };
  };

  /**
   * Q4: which ratios-ttm fields move with PRICE rather than with a filing.
   *
   * Named by pattern rather than by a hand-kept list: a hardcoded list of field
   * names goes stale the first time FMP adds one, and a field nobody classified
   * would silently count as filing-driven -- the direction of error that would
   * wrongly clear ratios-ttm for the earnings trigger.
   */
  const PRICE_DERIVED = /price|yield|marketcap|enterprisevalue|ev(to|per)|pe$|peg|pb$|ps$|capitalization/i;
  const ratiosTtmAnalysis = (rows: Record<string, unknown>[] | null) => {
    const row = rows?.[0];
    if (!row) return null;
    const keys = Object.keys(row).filter((k) => k !== "symbol");
    const priceDerived = keys.filter((k) => PRICE_DERIVED.test(k));
    return {
      totalFields: keys.length,
      priceDerivedCount: priceDerived.length,
      priceDerivedPct: keys.length ? Math.round((priceDerived.length / keys.length) * 100) : 0,
      priceDerivedFields: priceDerived,
      // Every field with its value, because the classifier is a heuristic and
      // the owner has to be able to overrule it by reading the actual numbers.
      allFields: row,
    };
  };

  /** Q6: coverage of the earnings calendar, which the event-driven model triggers on. */
  const calendarAnalysis = (rows: Record<string, unknown>[] | null) => {
    if (!rows?.length) return null;
    const dates = rows.map((r) => String(r?.date ?? "")).filter(Boolean).sort();
    return {
      totalRows: rows.length,
      uniqueSymbols: new Set(rows.map((r) => String(r?.symbol ?? "").toUpperCase()).filter(Boolean)).size,
      oldestDate: dates[0] ?? null,
      newestDate: dates[dates.length - 1] ?? null,
      // A row with no estimate still triggers a refresh, but it cannot be used
      // to anticipate one -- so the two counts answer different questions and
      // both are reported.
      epsEstimatedRows: rows.filter((r) => r?.epsEstimated !== null && r?.epsEstimated !== undefined).length,
    };
  };

  /**
   * Explicit rather than inferred, because the gate verdicts below read this
   * array by id and an implicitly-any array cannot be read that way. Both push
   * sites carry the same key set -- the success path and the catch path -- and
   * this type is what keeps them that way: a field added to one and not the
   * other now fails to compile, which is the same class of hole the gate
   * verdicts exist to close.
   */
  type ProbeResult = {
    id: string;
    note: string;
    httpStatus: number | null;
    ok: boolean;
    isArray: boolean;
    rows: number | null;
    uniqueSymbols: number;
    fundLikeSymbols: number;
    fundLikeSample: string[];
    sample: string[];
    method: "GET" | "HEAD";
    contentLength: number | null;
    bodyBytes: number;
    rowKeys: string[] | null;
    sampleRow: Record<string, unknown> | null;
    titleSample: string[] | null;
    oldestPublished: string | null;
    newestPublished: string | null;
    targetSamples: Record<string, unknown>[] | null;
    marketCapMin: number | null;
    marketCapMax: number | null;
    lastRowSymbol: string | null;
    lastRowMarketCap: number | null;
    ratiosTtm: {
      totalFields: number;
      priceDerivedCount: number;
      priceDerivedPct: number;
      priceDerivedFields: string[];
      allFields: Record<string, unknown>;
    } | null;
    earningsCalendar: {
      totalRows: number;
      uniqueSymbols: number;
      oldestDate: string | null;
      newestDate: string | null;
      epsEstimatedRows: number;
    } | null;
    message: string | null;
  };

  const results: ProbeResult[] = [];
  let skippedForBudget = 0;

  const probedAtDate = new Date();
  const probes = [...PROBES, ...buildDatedProbes(probedAtDate)];

  for (const probe of probes) {
    const joiner = probe.path.includes("?") ? "&" : "?";
    const url = `https://financialmodelingprep.com/${probe.base ?? "stable"}/${probe.path}${joiner}apikey=${encodeURIComponent(apiKey)}`;

    // Diagnostics must never crowd out the crons or a live page render.
    if (!(await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS))) {
      skippedForBudget += 1;
      continue;
    }

    try {
      await reserveFmpCallSlot();
      const res = await fetch(url, {
        method: probe.method ?? "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      // A HEAD response has no body by definition, so res.text() returns "" and
      // every downstream field falls out null/0 for it. That is correct, not a
      // failure: the only things a HEAD probe reports are its status and its
      // headers.
      const text = await res.text();
      const contentLength = (() => {
        const raw = Number(res.headers.get("content-length"));
        return Number.isFinite(raw) && raw > 0 ? raw : null;
      })();
      const bodyBytes = text ? Buffer.byteLength(text, "utf8") : 0;

      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      const arr = Array.isArray(json) ? (json as Record<string, unknown>[]) : null;
      const symbols = arr
        ? Array.from(
            new Set(
              arr
                .map((row) => String(row?.symbol ?? "").trim().toUpperCase())
                .filter(Boolean)
            )
          )
        : [];

      // Five letters ending in X is the US mutual-fund share-class convention
      // (AAGTX, CFNAX). Not a perfect test -- a handful of real equities match --
      // but a count in the dozens means funds are getting through, and zero
      // means the filter is doing its job.
      const fundLike = symbols.filter((sym) => /^[A-Z]{4}X$/.test(sym) || /^[A-Z]{5}X$/.test(sym));

      // Fixed, tiny lookup for the STEP 1 liveness check -- not caller input.
      const targetSamples = arr
        ? TARGET_SYMBOLS.map((sym) => arr.find((row) => String(row?.symbol ?? "").toUpperCase() === sym)).filter(
            (row): row is Record<string, unknown> => Boolean(row)
          )
        : [];

      results.push({
        id: probe.id,
        note: probe.note,
        httpStatus: res.status,
        ok: res.ok,
        isArray: Array.isArray(json),
        rows: arr ? arr.length : null,
        uniqueSymbols: symbols.length,
        fundLikeSymbols: fundLike.length,
        fundLikeSample: fundLike.slice(0, 6),
        sample: symbols.slice(0, 5),
        // THE IMPORTANT PART, added 2026-08-06 after the obvious question was
        // asked: a list endpoint returning 1000 SYMBOLS in one call is only a
        // minor saving, but if it also returns per-symbol DATA then it can
        // replace the per-symbol fan-out that dominates the FMP budget --
        // warmPricePool alone makes ~166 sequential quote calls per run because
        // "no multi-symbol endpoint works on Starter". Worth knowing exactly
        // which fields come back rather than assuming.
        rowKeys: arr && arr[0] ? Object.keys(arr[0]) : null,
        sampleRow: arr && arr[0] ? arr[0] : null,
        // For the news-shaped probes, the headline question is not "did it
        // answer" but "is what came back actually issuer releases". Three
        // titles settles that at a glance; a 200 full of generic wire copy is
        // a NO, and httpStatus alone cannot say so.
        titleSample: arr
          ? arr
              .slice(0, 3)
              .map((row) => String(row?.title ?? "").trim())
              .filter(Boolean)
          : null,
        // THE FIELD THE GATE IS READ FROM. Computed as a real minimum over
        // every row rather than taken from the last one: FMP returns news
        // newest-first today, but a probe that assumes the ordering it is
        // trying to verify is not a measurement. Both `publishedDate` and
        // `date` are accepted because the two vintages differ.
        method: probe.method ?? "GET",
        // BOTH, always, and never one standing in for the other. A
        // content-length that disagrees with the body it describes IS the
        // finding, and reporting only the header would hide it
        // (claude/traps/measuring-the-wrong-layer.md).
        contentLength,
        bodyBytes,
        oldestPublished: publishedRange(arr).oldest,
        newestPublished: publishedRange(arr).newest,
        // Fixed lookup of TARGET_SYMBOLS within this probe's rows, so
        // liquidity-dependent staleness can be checked for names other than
        // whichever mega-cap happens to sort first.
        targetSamples: targetSamples.length ? targetSamples : null,
        // ---- GATE FIELDS (2026-09-01) ----
        // Computed for every probe rather than only the screener ones: it costs
        // nothing on a response with no marketCap, and a field that only exists
        // on some probes is one a reader has to know to look for.
        marketCapMin: marketCapStats(arr).min,
        marketCapMax: marketCapStats(arr).max,
        lastRowSymbol: marketCapStats(arr).lastSymbol,
        lastRowMarketCap: marketCapStats(arr).lastMarketCap,
        // Q4 and Q6 only produce a value for their own probes; null elsewhere.
        ratiosTtm: probe.id.startsWith("Q4-") ? ratiosTtmAnalysis(arr) : null,
        earningsCalendar: probe.id.startsWith("Q6-") ? calendarAnalysis(arr) : null,
        // Non-array responses are where the plan message lives (402/403 bodies).
        message: arr ? null : scrub(text, apiKey).slice(0, 200),
      });
    } catch (error) {
      results.push({
        id: probe.id,
        note: probe.note,
        httpStatus: null,
        ok: false,
        isArray: false,
        rows: null,
        uniqueSymbols: 0,
        fundLikeSymbols: 0,
        fundLikeSample: [],
        sample: [],
        method: probe.method ?? "GET",
        contentLength: null,
        bodyBytes: 0,
        rowKeys: null,
        sampleRow: null,
        titleSample: null,
        oldestPublished: null,
        newestPublished: null,
        targetSamples: null,
        marketCapMin: null,
        marketCapMax: null,
        lastRowSymbol: null,
        lastRowMarketCap: null,
        ratiosTtm: null,
        earningsCalendar: null,
        message: scrub(error instanceof Error ? error.message : "fetch failed", apiKey),
      });
    }
  }

  const working = results.filter((r) => r.uniqueSymbols > 0);
  const bestForDiscovery = [...working].sort((a, b) => b.uniqueSymbols - a.uniqueSymbols)[0] ?? null;

  // THE GATE, read rather than left for the eye. See readNewsFromGate.
  const gateFrom = gateFromDate(probedAtDate);
  const newsFromGate = {
    question: "Does from= on /stable/news/stock filter, or is it accepted and ignored?",
    from: gateFrom,
    blocks: "claude/news-as-stored-dataset-spec-2026-08-22.md",
    ...readNewsFromGate(
      results.find((r) => r.id === "news-stock-BASELINE-no-from"),
      results.find((r) => r.id === "news-stock-GATE-from"),
      gateFrom
    ),
  };

  const newsHeadProbe = {
    question: "Can the size of a news response be learned without retrieving the articles?",
    alreadyAnswered:
      "There is no `total` field to read: the news response is a bare array with eight per-row " +
      "keys and no envelope. HEAD is the only remaining route to a free count.",
    ...readHeadProbe(
      results.find((r) => r.id === "news-stock-HEAD"),
      results.find((r) => r.id === "news-stock-BASELINE-no-from")
    ),
  };

  const todayBar = {
    question: "Does historical-price-eod/full carry a live-updating bar for today, or only after the close?",
    decides: "Whether a price-pool-synthesised intraday bar appends or replaces.",
    ...readTodayBarProbe(
      results.find((r) => r.id === "history-today-bar"),
      results.find((r) => r.id === "history-today-bar-QUOTE"),
      probedAtDate
    ),
  };

  // ---- THE GATE VERDICTS (2026-09-01) -------------------------------------
  //
  // Computed AFTER the loop because two of them are comparisons between probes,
  // and a per-probe verdict cannot express that. Q2 is the reason: a 200 that
  // silently ignores marketCapLowerThan returns the same top-1000 as the
  // unbanded call, so the banded probe ALONE looks like a pass no matter what.
  const byId = (id: string) => results.find((r) => r.id === id);

  const q1 = byId("Q1-screener-limit-3000");
  const q2 = byId("Q2-screener-band-1b-2b");
  const q2Base = byId("company-screener-1b");
  const q3 = byId("company-screener-1b");

  const gate = {
    Q1_screenerLimitAbove1000: (() => {
      if (!q1 || q1.rows === null) return { verdict: "UNKNOWN", detail: "Probe did not return an array." };
      if (q1.rows > 1000) {
        return { verdict: "PASS", detail: `limit=3000 returned ${q1.rows} rows, so the cap is ours to raise.` };
      }
      return {
        verdict: "FAIL",
        detail:
          `limit=3000 returned ${q1.rows} rows. FMP paginates at 1000, so the coverage floor is set by ` +
          `FMP rather than by us and banding (Q2) is the only route to wider coverage.`,
      };
    })(),

    Q2_marketCapLowerThanSupported: (() => {
      if (!q2 || !q2.rows) return { verdict: "UNKNOWN", detail: "Banded probe returned no rows." };
      const inBand = q2.marketCapMax !== null && q2.marketCapMax <= 2_000_000_000 && (q2.marketCapMin ?? 0) >= 1_000_000_000;
      // THE HALF THAT MATTERS. Identical row counts AND an identical first
      // symbol is what an ignored parameter looks like.
      const differsFromUnbanded =
        !q2Base || q2.rows !== q2Base.rows || q2.sample[0] !== q2Base.sample[0];
      if (inBand && differsFromUnbanded) {
        return {
          verdict: "PASS",
          detail:
            `${q2.rows} rows, all between ${q2.marketCapMin} and ${q2.marketCapMax}, and the set differs ` +
            `from the unbanded call. Banding works, so coverage below the truncation point is reachable.`,
        };
      }
      return {
        verdict: "FAIL",
        detail:
          `inBand=${inBand} differsFromUnbanded=${differsFromUnbanded}. marketCapMax=${q2.marketCapMax}. ` +
          `A 200 that ignores the parameter returns the same top-1000 -- which is why this reads the VALUES, ` +
          `not the status code.`,
      };
    })(),

    Q3_coverageFloor: q3
      ? {
          verdict: q3.lastRowMarketCap === null ? "UNKNOWN" : "PASS",
          detail:
            `The 1000th row of the live screener call is ${q3.lastRowSymbol} at marketCap ` +
            `${q3.lastRowMarketCap}. That -- not SCREENER_MIN_MARKET_CAP -- is the real coverage floor, ` +
            `because limit truncates before the floor binds.`,
        }
      : { verdict: "UNKNOWN", detail: "Screener probe missing." },

    Q4_ratiosTtmPriceDerived: (() => {
      const rows = results.filter((r) => r.id.startsWith("Q4-") && r.ratiosTtm);
      if (!rows.length) return { verdict: "UNKNOWN", detail: "No ratios-ttm probe returned a row." };
      const worst = Math.max(...rows.map((r) => r.ratiosTtm!.priceDerivedPct));
      return {
        // Deliberately not a PASS/FAIL: the question is not whether the endpoint
        // works but whether it BELONGS on an earnings trigger, and that is a
        // judgement about a proportion. The number is the finding.
        verdict: worst > 0 ? "FAIL" : "PASS",
        detail:
          `${worst}% of ratios-ttm fields are price-derived by name. If that share is meaningful, ` +
          `ratios-ttm must stay on a clock while income-statement, cash-flow, dividends and ` +
          `analyst-estimates move to the earnings trigger. Read priceDerivedFields and allFields ` +
          `before deciding -- the classifier is a heuristic.`,
      };
    })(),

    Q5_delistedDetection: (() => {
      const fb = byId("Q5-profile-FB");
      const wfm = byId("Q5-profile-WFM");
      const ctl = byId("Q5-profile-AAPL-control");
      if (!ctl?.rows) return { verdict: "UNKNOWN", detail: "Control returned nothing -- the endpoint, not the tickers, is the problem." };
      const describe = (r: typeof fb, name: string) =>
        !r ? `${name}: probe missing` :
        !r.rows ? `${name}: absent from the endpoint entirely` :
        `${name}: present, isActivelyTrading=${String((r.sampleRow as Record<string, unknown> | null)?.isActivelyTrading)}`;
      return {
        verdict: "PASS",
        detail:
          `${describe(fb, "FB")}. ${describe(wfm, "WFM")}. Control AAPL returned ${ctl.rows} row(s). ` +
          `Absence is an equally usable signal to a false boolean -- record whichever it is as the mechanism.`,
      };
    })(),

    Q6_earningsCalendarCoverage: (() => {
      const q6 = byId("Q6-earnings-calendar");
      if (!q6?.earningsCalendar) return { verdict: "UNKNOWN", detail: "Calendar probe returned no rows." };
      const c = q6.earningsCalendar;
      return {
        verdict: "PASS",
        detail:
          `${c.totalRows} rows, ${c.uniqueSymbols} unique symbols, ${c.oldestDate} to ${c.newestDate}, ` +
          `${c.epsEstimatedRows} carrying a non-null epsEstimated. A symbol absent from this list would ` +
          `never have its fundamentals refreshed again under the event-driven model.`,
      };
    })(),

    Q9_ipoLeadTime: (() => {
      const q9 = byId("Q9-ipo-calendar");
      if (!q9?.rows) return { verdict: "UNKNOWN", detail: "IPO calendar returned no rows." };
      return {
        verdict: "PASS",
        detail:
          `${q9.rows} rows. Read rowKeys on the probe for what a row carries -- lead time is only useful ` +
          `if the row also carries enough to admit the symbol to the universe.`,
      };
    })(),

    // Q10 is the today-bar probe, which already reports its own window validity.
    // It is valid ONLY Mon-Fri 14:00-19:45 UTC; outside that window it reports
    // UNKNOWN and that result must not be written up as a finding.
    Q10_todayBarAppendsOrReplaces: {
      verdict: todayBar.verdict,
      detail: `${todayBar.detail} (This probe is only meaningful inside Mon-Fri 14:00-19:45 UTC.)`,
    },
  };

  return NextResponse.json({
    probedAt: probedAtDate.toISOString(),
    gate,
    todayBar,
    newsFromGate,
    newsHeadProbe,
    // Non-zero means the FMP budget was tight and some probes were skipped
    // rather than queued -- rerun in a quieter minute before reading anything
    // into a missing result.
    skippedForBudget,
    // The headline: can anything here supply a bigger candidate pool than the
    // 407-name static master list?
    largestSymbolSource: bestForDiscovery
      ? { id: bestForDiscovery.id, uniqueSymbols: bestForDiscovery.uniqueSymbols }
      : null,
    currentMasterListSize: 407,
    results,
  });
}
