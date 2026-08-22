import { NextResponse } from "next/server";

import {
  checkBackfillKey,
  checkBackfillLockout,
  clearBackfillFailures,
  getClientIp,
  recordBackfillFailure,
} from "@/lib/server/backfillAuth";
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
// The master list is 407 because buildExpandedDiscoveryMasterList unions three
// FMP constituent endpoints with the static lists, and those endpoints appear to
// answer 402 on this plan -- fetchFmpConstituentSymbols swallows a non-ok
// response into [], so the failure is invisible. This route makes it visible,
// and tests whether any endpoint on this plan CAN supply a larger candidate set.
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
  { id: "sp500-constituent", path: "sp500-constituent", note: "currently used by buildExpandedDiscoveryMasterList" },
  { id: "nasdaq-constituent", path: "nasdaq-constituent", note: "currently used" },
  { id: "dowjones-constituent", path: "dowjones-constituent", note: "currently used" },
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
    note: "CANDIDATE FIX -- same filter plus isEtf=false&isFund=false",
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

  return [
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
  const ip = getClientIp(request);

  const lockout = await checkBackfillLockout(ip);
  if (lockout.locked) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts" },
      { status: 429, headers: { "retry-after": String(lockout.retryAfterSeconds) } }
    );
  }

  const submitted = new URL(request.url).searchParams.get("key") ?? "";
  if (!checkBackfillKey(submitted)) {
    await recordBackfillFailure(ip);
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  await clearBackfillFailures(ip);

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing FMP_API_KEY" }, { status: 500 });
  }

  const results = [];
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

  return NextResponse.json({
    probedAt: probedAtDate.toISOString(),
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
