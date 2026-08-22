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

  return [
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

  const probes = [...PROBES, ...buildDatedProbes(new Date())];

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
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const text = await res.text();

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
        rowKeys: null,
        sampleRow: null,
        titleSample: null,
        targetSamples: null,
        message: scrub(error instanceof Error ? error.message : "fetch failed", apiKey),
      });
    }
  }

  const working = results.filter((r) => r.uniqueSymbols > 0);
  const bestForDiscovery = [...working].sort((a, b) => b.uniqueSymbols - a.uniqueSymbols)[0] ?? null;

  return NextResponse.json({
    probedAt: new Date().toISOString(),
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
