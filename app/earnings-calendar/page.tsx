import Link from "next/link";
import { after } from "next/server";
import { permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import type React from "react";
import {
  getDayCandidates,
  populateNextMissingDate,
  claimCalendarScan,
  getMonthVisibility,
} from "@/lib/server/earningsCalendar";
import { resolveCalendarDay, dayStateMessage, easternDate } from "@/lib/server/calendarDayState";
import { readPricePoolBulk } from "@/lib/server/pricePool";
import { readTiingoEodLast } from "@/lib/server/marketData/read";
import { priceProviderFor } from "@/lib/server/marketData/provider";
import { TIINGO_CREDIT, TIINGO_URL } from "@/lib/server/tiingoSurfacePrice";
import { scaledAmount } from "@/lib/server/secPresentation";
import { toDashed } from "@/lib/symbolSpellings.mjs";
import {
  baseTicker, countPill, dayEyebrow, dayLong, defaultDay, hasClassSuffix, primaryPerFiler, sharesSince, tileDate, tileWeekday, weekDays,
} from "@/lib/server/earningsWeek";
import { registrantFor } from "@/lib/server/stockProfile";
import { isProductionDeployment } from "@/lib/server/deployTarget";
import { gridAdmits, gridCompanyName } from "@/lib/server/secTickerNames";
import { fillWeekFigures, readWeekFigures } from "@/lib/server/earningsWeekStore";
import EarningsTickerSearch from "./EarningsTickerSearch";
import EarningsWeek, { type WeekDay, type WeekRow } from "./EarningsWeek";
import EarningsComingUp, { type ComingUpFacts } from "./EarningsComingUp";
import { getCalendarForwardSections, type CalendarForwardSections } from "@/lib/server/dueInputs";

// ── "EARNINGS THIS WEEK" (#552 COWORK #170, owner pick) ────────────────────
// The month grid and its Prev / Today / Next are gone: "a backward running
// calendar is pointless". The page is the last seven days (who filed, with the
// figures they filed), then a compact "coming up". The URL and "Earnings
// calendar" in the title and description stay: that is what people search.
const PAGE_TITLE = "Earnings Calendar: Results Filed This Week | MyStockHarbor";
const PAGE_DESCRIPTION =
  "Earnings calendar: which companies filed results in the last 7 days, from their own SEC filings, " +
  "with revenue, EPS and the share move since, and which of the largest companies are estimated to report next.";
const PAGE_URL = "https://www.mystockharbor.com/earnings-calendar";
const OG_IMAGE_URL = "https://www.mystockharbor.com/og-image-v2.png";

export const dynamic = "force-dynamic";

type SearchParams = { year?: string; month?: string; date?: string };

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  // One URL. The old ?year=&month=&date= variants all carried this canonical.
  alternates: { canonical: PAGE_URL },
  robots: { index: true, follow: true },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: PAGE_URL,
    siteName: "MyStockHarbor",
    images: [{ url: OG_IMAGE_URL, width: 1200, height: 630, alt: "MyStockHarbor earnings calendar" }],
    locale: "en_GB",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: PAGE_TITLE, description: PAGE_DESCRIPTION, images: [OG_IMAGE_URL] },
};

/**
 * THE OLD DATE URLs (#552 COWORK #170 "Old date URLs"). The grid linked
 * ?year=&month= (month pages) and ?year=&month=&date= (a day); nothing else in
 * the site did, and every variant carried the bare canonical, so none was
 * indexed as its own page. A date inside the strip still opens that day
 * (`initial` below); anything else 301s to the page, so a stale bookmark lands
 * on the current week rather than on a month that no longer exists.
 */
export function oldUrlTarget(params: SearchParams, days: readonly string[]): { selected: string | null; redirect: boolean } {
  const date = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null;
  if (date && days.includes(date)) return { selected: date, redirect: false };
  return { selected: null, redirect: Boolean(params.date || params.year || params.month) };
}

const signed$ = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;

// WHAT A PAGE VIEW COSTS IN REDIS COMMANDS, and why that is the point.
//
// This page is not an FMP problem -- the window self-limits, and the comment on
// the after() block below is right that the scans short-circuit once it is
// filled. It is a REDIS AND LAMBDA problem, and Redis command volume is what
// suspended the database on 2026-08-28.
//
// Counted per request, steady state (#552 COWORK #170, the week page):
//
//   day lists         1   the month index, memoised 6h per instance (2 across
//                         a month boundary, on a cold instance)
//   market cap        1   one HMGET of the price pool, for the sorts (strip and Coming up)
//   row figures       1   one MGET of the strip's 14 keys
//   latest closes     1   the Tiingo last-bar blob (Data Cache, 24h)
//   forward sections  1   the analysis-universe symbol key
//                  + 50   the committed cut's report-date records (memoised 5 min)
//   after(): gate     1   SET NX; the fill and the populate run on a win only
//                    --
//                    ~6   warm, plus the memoised fifty
//
// The month grid's per-day reads (the day blob, its completeness marker read
// twice) are gone with the grid: the strip reads the candidates directly.
//
// ── THE FOURTEEN TICKER READS ARE GONE AND FIFTY TOOK THEIR PLACE ────────
// EarningsUpcomingTicker was removed (see the section note at its render site),
// taking TICKER_DAYS_AHEAD x readDayItemsCache with it. The due strip and the
// expected section replaced it, and they are DEARER: fifty per-symbol records
// for the committed cut, read ONCE for both (getCalendarForwardSections) rather
// than once each.
//
// So the memo below matters more than it did, not less, and it is pointed at
// the fifty rather than at the fourteen.
//
// THE after() SCAN IS CHEAPER THAN IT LOOKS, corrected rather than assumed:
// once the frontier is parked past the window end, findNextIncompleteDate's
// loop runs ZERO times, so the short-circuit really is 3 commands rather than a
// walk of the ~95-day window. The gate below is not about those 3; it is about
// the thundering herd when the window DOES roll forward and every concurrent
// visitor starts filling it at once.
//
// WHY AN IN-PROCESS MEMO RATHER THAN unstable_cache. The obvious answer is
// Next's Data Cache, keyed by date, which would also help a cold instance --
// and lib/stock-news-data.ts and quoteData.ts both use it. It is not used here
// because THIS SEGMENT DECLARES force-dynamic, and whether that changes how
// unstable_cache behaves inside it is a framework question this sandbox cannot
// settle: there is no build (the ISR'd screener pages exceed Next's 60s
// per-page budget without Upstash credentials), no Redis and no deploy. Getting
// it wrong is either silent (a cache that never caches, achieving nothing) or
// loud in the worst way (DYNAMIC_SERVER_USAGE, which is the #310 outage shape).
//
// The memo below is this module's own established pattern -- monthCache,
// candidatesCache and nameMapCache in earningsCalendar.ts are all exactly this
// -- it needs no framework guarantee, and it can be RUN by an invariant check.
// It also targets the thing this PR is about: a page that costs the same for
// the thousandth visitor as the first. A warm instance now serves the second
// and subsequent views from memory.
const FORWARD_MEMO_MS = 5 * 60_000;
let forwardMemo: { key: string; at: number; value: CalendarForwardSections } | null = null;

/** Read-through memo. Exported shape kept pure so the check can run it. */
export function readMemo<T>(
  memo: { key: string; at: number; value: T } | null,
  key: string,
  nowMs: number,
  ttlMs: number
): T | null {
  if (!memo || memo.key !== key) return null;
  // ABSENT AND EXPIRED MUST BOTH MISS. A memo that returns a value for a key it
  // does not hold is a cache that serves the wrong day's earnings, which on
  // this page is a wrong answer rather than a stale one.
  // BOTH NUMBERS CHECKED. `nowMs - at >= undefined` is FALSE, so an unusable
  // TTL made the memo serve forever -- found by an assertion that called this
  // with three arguments instead of four and then failed on the expiry case.
  // The fail-open was in the code, not only in the test.
  if (!Number.isFinite(nowMs) || !Number.isFinite(ttlMs)) return null;
  if (nowMs - memo.at >= ttlMs) return null;
  return memo.value;
}


/**
 * The due strip and the expected section, memoised together for one day.
 *
 * ONE MEMO, BECAUSE THEY ARE ONE READ. getCalendarForwardSections issues the
 * fifty record GETs once and derives both answers; memoising them separately
 * would either double the reads or let the two drift a memo-window apart, and
 * the expected section EXCLUDES whatever the due strip is listing -- so two
 * ages of the same data would double-list a symbol.
 *
 * AN UNAVAILABLE RESULT IS NOT HELD. Same rule the ticker memo carried: holding
 * a failed read for five minutes turns one bad read into five minutes of a
 * page claiming it cannot answer, which is the absence-read-as-an-answer shape
 * this repo keeps finding.
 */
async function getForwardSections(todayDate: string): Promise<CalendarForwardSections> {
  const hit = readMemo(
    forwardMemo && { key: forwardMemo.key, at: forwardMemo.at, value: forwardMemo.value },
    todayDate,
    Date.now(),
    FORWARD_MEMO_MS
  );
  if (hit) return hit;
  const value = await getCalendarForwardSections(todayDate);
  if (value.due.kind !== "unavailable") {
    forwardMemo = { key: todayDate, at: Date.now(), value };
  }
  return value;
}

export default async function EarningsCalendarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // THE US FILING DAY, Eastern: "today" is the day the SEC stamps filings with.
  const today = easternDate(new Date());
  const days = weekDays(today);
  const old = oldUrlTarget(params, days);
  if (old.redirect) permanentRedirect("/earnings-calendar");

  // The day lists: the month index the calendar already reads (one HGETALL,
  // memoised 6h per instance; two months across a boundary).
  // AND THE FORWARD SECTIONS FIRST (memoised 6h), so "Coming up"'s names join
  // the strip's in the ONE market-cap read below (#552 COWORK #179).
  const [raw, forward] = await Promise.all([
    Promise.all(days.map((d) => getDayCandidates(d))),
    getForwardSections(today),
  ]);
  const comingUpSymbols = [
    ...(forward.expected.kind === "listed" ? forward.expected.rows.map((r) => r.symbol) : []),
    ...(forward.due.kind === "listed" ? forward.due.entries.map((e) => e.symbol) : []),
  ];
  // A CLASS TICKER'S BASE ON THE SAME CIK (MKC-V → MKC) is offered too, so the
  // row can show the class readers know (#552 COWORK #174).
  const siblingsOf = (s: string) => {
    if (!hasClassSuffix(s)) return [];
    const base = baseTicker(s);
    const cik = registrantFor(s)?.cik;
    return cik && registrantFor(base)?.cik === cik && gridAdmits(base) ? [base] : [];
  };
  const symbols = [...new Set(raw.flat().flatMap((c) => [c.symbol, ...siblingsOf(c.symbol)]))];
  const capSymbols = [...new Set([...symbols, ...comingUpSymbols])];
  const [pool, eodLast, week] = await Promise.all([
    // Market cap, for the sorts only (one HMGET): the strip's and "Coming up"'s.
    capSymbols.length ? readPricePoolBulk(capSymbols).catch(() => new Map()) : Promise.resolve(new Map()),
    // The latest close (one HGETALL blob, Data Cache 24h).
    symbols.length ? readTiingoEodLast().catch(() => ({})) : Promise.resolve({}),
    // The figures and closes the background fill wrote (one MGET).
    readWeekFigures(days),
  ]);
  const comingUpFacts: ComingUpFacts = Object.fromEntries(comingUpSymbols.map((s) =>
    [s, { company: gridCompanyName(s), cap: pool.get(s)?.marketCap ?? null, cik: registrantFor(s)?.cik ?? null }]));

  // ONE ROW PER FILER, under its most-traded class; the figures are filled
  // from the record the announcement is under (`source`).
  const lists = raw.map((cands) =>
    primaryPerFiler(cands, {
      cikOf: (s) => registrantFor(s)?.cik ?? null,
      siblingsOf,
      volumeOf: (s) => pool.get(s)?.volume ?? null,
    }).map(({ row, symbol }) => ({ ...row, source: row.symbol, symbol, company: symbol === row.symbol ? row.company : gridCompanyName(symbol) || row.company })));
  const counts = new Map(days.map((d, i) => [d, lists[i].length] as const));
  const weekDaysView: WeekDay[] = days.map((date, i) => {
    const cands = lists[i];
    const [y, m] = date.split("-").map(Number);
    // WHAT AN EMPTY DAY MEANS, as the grid resolved it: a month that could not
    // be read is not a quiet day, and today before its filing day ends is "not
    // yet" (calendarDayState).
    const state = resolveCalendarDay({
      items: cands.map((c) => ({ ...c, price: null, marketCap: null })),
      totalCandidates: cands.length,
      complete: true,
      monthVisibility: getMonthVisibility(y, m),
      dayOpen: date >= today,
    });
    const figures = week.figures.get(date) ?? {};
    const closes = week.closes.get(date) ?? {};
    const capOf = (s: string) => pool.get(s)?.marketCap ?? null;
    const rows: WeekRow[] = [...cands]
      // SORT: market cap, largest first; an unknown cap last.
      .sort((a, b) => (capOf(b.symbol) ?? -1) - (capOf(a.symbol) ?? -1))
      .map((c) => {
        const f = figures[c.symbol]?.f ?? null;
        const before = closes[c.symbol];
        const last = (eodLast as Record<string, { d: string; c: number }>)[toDashed(c.symbol)] ?? null;
        return {
          symbol: c.symbol,
          company: c.company,
          revenue: f && f.revenue !== null ? scaledAmount(f.revenue) : null,
          revenueYoY: f?.revenueYoY ?? null,
          eps: f && f.epsDiluted !== null ? signed$(f.epsDiluted) : null,
          since: sharesSince(before && before.d ? { date: before.d, close: before.c } : null, last ? { date: last.d, close: last.c } : null),
        };
      });
    const emptyLine = rows.length
      ? null
      : state.kind === "none-scheduled"
        ? `No results filed on ${dayLong(date)}.`
        // "not yet" (today, still open) and the read-failure words: the day state's own.
        : dayStateMessage(state);
    return {
      date,
      weekday: tileWeekday(date),
      dateLabel: tileDate(date),
      count: cands.length,
      pill: countPill(cands.length, date === today),
      isToday: date === today,
      eyebrow: dayEyebrow(date, cands.length),
      emptyLine,
      rows,
    };
  });
  const initial = old.selected ?? defaultDay(days, counts, today);

  // Background: keep the day blobs filling (the sector panels and the day API
  // read them), and fill the strip's figures, behind ONE gate across all
  // instances (SET NX, five minutes).
  after(async () => {
    try {
      if (!(await claimCalendarScan())) return;
      await fillWeekFigures(new Map(days.map((d, i) => [d, lists[i].map((c) => ({ symbol: c.symbol, source: c.source }))])), { maxSymbols: 30 });
      await populateNextMissingDate({ maxDates: 2 });
    } catch {
      // best-effort background job; failures shouldn't affect any page load
    }
  });

  const selectedView = weekDaysView.find((d) => d.date === initial);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://www.mystockharbor.com/#organization",
        name: "MyStockHarbor",
        url: "https://www.mystockharbor.com",
        logo: { "@type": "ImageObject", url: "https://www.mystockharbor.com/logo.png" },
      },
      {
        "@type": "CollectionPage",
        "@id": `${PAGE_URL}#webpage`,
        url: PAGE_URL,
        name: "Earnings this week",
        description: PAGE_DESCRIPTION,
        isPartOf: { "@type": "WebSite", "@id": "https://www.mystockharbor.com/#website", name: "MyStockHarbor", url: "https://www.mystockharbor.com" },
        publisher: { "@id": "https://www.mystockharbor.com/#organization" },
        ...(selectedView && selectedView.rows.length
          ? {
              mainEntity: {
                "@type": "ItemList",
                name: `Companies that filed results on ${dayLong(selectedView.date)}`,
                numberOfItems: selectedView.rows.length,
                itemListElement: selectedView.rows.slice(0, 50).map((r, index) => ({
                  "@type": "ListItem",
                  position: index + 1,
                  name: `${r.company} (${r.symbol})`,
                  url: `https://www.mystockharbor.com/stock/${encodeURIComponent(r.symbol)}/earnings`,
                })),
              },
            }
          : {}),
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${PAGE_URL}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://www.mystockharbor.com/" },
          { "@type": "ListItem", position: 2, name: "Earnings Calendar", item: PAGE_URL },
        ],
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main className="earnCalMain">
        <div className="earnCalWrap">
          <div style={{ marginBottom: 20 }}>
            <Link href="/" className="earnCalBack">← Back to Dashboard</Link>
          </div>

          <section className="earnCalIntroCard">
            <div className="earnCalEyebrow">Earnings</div>
            <h1 className="earnCalTitle">Earnings this week</h1>
            <p className="earnCalLede">
              Who filed results in the last 7 days, and who is estimated to report next. From SEC filings.
            </p>
            <EarningsTickerSearch />
          </section>

          {/* THE "SHARES SINCE" CLOSES ARE TIINGO'S: the shared linked credit, in the card's fine print. */}
          <EarningsWeek
            days={weekDaysView}
            initial={initial}
            // AN INTERNAL CONTROL (#552 COWORK #174): off on production; a
            // preview keeps it for the owner. The route behind it stays keyed.
            backfill={!isProductionDeployment()}
            credit={priceProviderFor("POOL") === "tiingo" && weekDaysView.some((d) => d.rows.length > 0) ? (
              <a href={TIINGO_URL} target="_blank" rel="noopener noreferrer">{TIINGO_CREDIT}</a>
            ) : null}
          />

          {/* THE "NEXT UP" TICKER IS STILL GONE. It walked forward through a
              window that ends today, so every row read "Today" under a "Next up"
              heading. "Who reports soon" is this card: measured, and marked as
              an estimate. */}
          <EarningsComingUp expected={forward.expected} due={forward.due} today={today} facts={comingUpFacts} />

          {/* FINE PRINT: the source of the list, and of "Shares since". */}
          <p className="earnCalFine" data-fine-print="">
            Dates are the day each company filed its results announcement with the SEC
            (Form 8-K, Item 2.02). Companies filing results only as Form 6-K are not
            listed here. Revenue and EPS are the filed figures for the period announced;
            they appear once the quarterly report carrying them is filed. This is a starting point for further research, not investment advice.
          </p>

          <section className="earnCalExplore">
            <div className="earnCalExploreTitle">Continue exploring</div>
            <p className="earnCalExploreLine">
              Track upcoming listings, read the latest chart insights, or scan the
              supply-chain bottlenecks behind the market.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/upcoming-ipos" style={exploreLinkStyle}>Upcoming IPOs →</Link>
              <Link href="/insights" style={exploreLinkStyle}>Insights →</Link>
              <Link href="/bottlenecks" style={exploreLinkStyle}>Bottlenecks →</Link>
            </div>
          </section>
        </div>

        <style>{`
          .earnCalMain { min-height: 100vh; background: #06080d; color: #f1f5f9; font-family: system-ui, Arial; padding: 40px 20px; overflow-x: hidden; }
          .earnCalWrap { max-width: 1160px; margin: 0 auto; }
          .earnCalBack { color: #93c5fd; text-decoration: none; font-weight: 700; font-size: var(--fs-label); }
          .earnCalIntroCard { background: #0b1220; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 24px; box-shadow: 0 12px 30px rgba(0,0,0,0.28); margin-bottom: 24px; }
          .earnCalEyebrow { font-size: var(--fs-label); font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; color: #93c5fd; }
          .earnCalTitle { margin: 6px 0 10px; font-size: 2.125rem; line-height: 1.1; font-weight: 900; }
          .earnCalLede { font-size: var(--fs-read); line-height: var(--lh-read); color: rgba(226,232,240,0.9); margin: 0 0 18px; }
          .earnCalFine { font-size: var(--fs-fine); line-height: 1.6; color: rgba(203,213,225,0.7); margin: 0 0 8px; }
          .earnCalExplore { margin-top: 28px; background: #0b1220; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 20px; box-shadow: 0 12px 30px rgba(0,0,0,0.28); }
          .earnCalExploreTitle { font-size: 1.125rem; font-weight: 900; margin-bottom: 6px; }
          .earnCalExploreLine { font-size: var(--fs-read); line-height: var(--lh-read); color: rgba(226,232,240,0.78); margin: 0 0 14px; }
          @media (max-width: 400px) {
            .earnCalMain { padding: 20px 10px; }
          }
          @media (max-width: 640px) {
            .earnCalMain { padding: 24px 14px; }
            .earnCalIntroCard { padding: 18px; }
            .earnCalTitle { font-size: 1.625rem; }
          }
        `}</style>
      </main>
    </>
  );
}

const exploreLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 42,
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid rgba(59,130,246,0.32)",
  background: "rgba(59,130,246,0.10)",
  color: "#dbeafe",
  textDecoration: "none",
  fontWeight: 800,
  fontSize: "var(--fs-label)",
  whiteSpace: "nowrap",
};
