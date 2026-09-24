import Link from "next/link";
import { after } from "next/server";
import type { Metadata } from "next";
import type React from "react";
import { cache } from "react";
import {
  getMonthDayCounts,
  getDayEarningsForRender,
  getFullDayEarnings,
  populateNextMissingDate,
  claimCalendarScan,
  isDateFullyPopulated,
  getWindowStartDate,
  getWindowEndDate,
  isDateInWindow,
  daysInMonth,
  getMonthVisibility,
} from "@/lib/server/earningsCalendar";
import { resolveCalendarDay, dayStateMessage, easternDate, outOfWindowCell } from "@/lib/server/calendarDayState";
import { PRICE_COVERAGE_NOTE } from "@/lib/server/gridPriceCoverage";
import EarningsDayList from "./EarningsDayList";
import EarningsTickerSearch from "./EarningsTickerSearch";
import EarningsDueStrip from "./EarningsDueStrip";
import EarningsExpectedSection from "./EarningsExpectedSection";
import { getCalendarForwardSections, type CalendarForwardSections } from "@/lib/server/dueInputs";
import BackfillButton from "./BackfillButton";

const PAGE_TITLE = "Earnings Calendar | MyStockHarbor";

// ── THE HOUSE COPY RULE, WHICH IS NOT A STYLE PREFERENCE ──────────────────
// Present tense about the public record. "have filed", never "will report",
// and never a date a company is expected to report on. Two routes to a real
// forward calendar were measured and both failed -- cadence prediction landed
// 2 of 48 filers inside their own p90 band, and 8-K scheduling announcements
// put 0 of 276 in the band a calendar would need (lib/server/dueToReport.ts).
// So the page describes what HAS been filed and what is outstanding; it does
// not predict.
//
// The old description promised "price and market cap" without qualification.
// That is now conditional -- see lib/server/gridPriceCoverage.ts -- and a meta
// description is a claim Google quotes, so it says what the page actually
// offers rather than what it used to.
const PAGE_DESCRIPTION =
  "Which companies have filed results on each date, taken from their own SEC filings, " +
  "alongside the largest companies whose results are not yet on file. Based on the " +
  "public filing record, not a forecast of when a company will report.";
const PAGE_URL = "https://www.mystockharbor.com/earnings-calendar";
const OG_IMAGE_URL = "https://www.mystockharbor.com/og-image-v2.png";

export const dynamic = "force-dynamic";

type SearchParams = { year?: string; month?: string; date?: string };

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildCalendarWeeks(year: number, month: number): (number | null)[][] {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const startWeekday = firstDay.getUTCDay();
  const total = daysInMonth(year, month);

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= total; day++) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function monthLabel(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDateLabel(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// View resolution
//
// Split out of the page body on 2026-08-17 so generateMetadata() and the page
// component agree on which date is being rendered without duplicating the
// clamping rules. resolveCalendarView is pure and sync; loadDay is wrapped in
// React's cache() so the two callers share one fetch per request.
//
// Why this exists: the page previously shipped a static title, description and
// <h1> ("Earnings Calendar") on a page whose entire value is that it is *dated*.
// See claude/health-check-firewall-indexing-analytics-2026-08-17.md.
//
// A sector rollup lived here briefly (#253-#255) and was removed in #256 -- the
// sector data is only warmed for the screener universe, so it classified 2 of 52
// reporters on 2026-08-17 and 8 of 44 on the 20th. Reinstating it is a data
// problem (warm profiles across the earnings window), not a rendering one.
// ---------------------------------------------------------------------------

type CalendarView = {
  year: number;
  month: number;
  monthPrefix: string;
  todayDate: string;
  selectedDate: string;
  isToday: boolean;
};

function resolveCalendarView(params: SearchParams): CalendarView {
  const now = new Date();
  const todayYear = now.getUTCFullYear();
  const todayMonth = now.getUTCMonth() + 1;
  const todayDate = `${todayYear}-${pad2(todayMonth)}-${pad2(now.getUTCDate())}`;

  const windowStart = getWindowStartDate();
  const windowEnd = getWindowEndDate();
  const firstYM = windowStart.slice(0, 7);
  const lastYM = windowEnd.slice(0, 7);

  const yearParam = Number(params.year);
  const monthParam = Number(params.month);

  let year = Number.isFinite(yearParam) && yearParam > 0 ? yearParam : todayYear;
  let month =
    Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : todayMonth;

  // Clamp the viewed month into the window (a hand-typed or stale URL outside
  // the window snaps back to the nearest edge rather than 404-ing).
  let viewedYM = `${year}-${pad2(month)}`;
  if (viewedYM < firstYM) viewedYM = firstYM;
  if (viewedYM > lastYM) viewedYM = lastYM;
  year = Number(viewedYM.slice(0, 4));
  month = Number(viewedYM.slice(5, 7));

  const monthPrefix = `${year}-${pad2(month)}`;
  const requestedDate =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null;

  // The first day of the viewed month that's actually inside the window
  // (e.g. if the window starts on the 15th, the 1st-14th are greyed and not
  // selectable).
  const firstInWindowDay = `${monthPrefix}-01` < windowStart ? windowStart : `${monthPrefix}-01`;

  const selectedDate =
    requestedDate && requestedDate.startsWith(monthPrefix) && isDateInWindow(requestedDate)
      ? requestedDate
      : year === todayYear && month === todayMonth && isDateInWindow(todayDate)
        ? todayDate
        : firstInWindowDay;

  return {
    year,
    month,
    monthPrefix,
    todayDate,
    selectedDate,
    isToday: selectedDate === todayDate,
  };
}

// cache() keeps generateMetadata and the page component to one fetch of the
// selected day per request rather than two.
const loadDay = cache((selectedDate: string) => getDayEarningsForRender(selectedDate));
// SHARED WITH THE RENDER, so the completeness marker is read ONCE rather than
// twice. getFullDayEarnings already reads it internally and the page then read
// it again through isDateFullyPopulated -- two GETs for one fact.
const loadDayComplete = cache((selectedDate: string) => isDateFullyPopulated(selectedDate));

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const view = resolveCalendarView(await searchParams);
  const dateLabel = formatDateLabel(view.selectedDate);

  let title = PAGE_TITLE;
  let description = PAGE_DESCRIPTION;

  try {
    const day = await loadDay(view.selectedDate);
    const count = day.usListedCount;

    if (count > 0) {
      title = `Earnings Calendar: ${dateLabel} | MyStockHarbor`;
      description =
        `${count} US-listed compan${count === 1 ? "y reports" : "ies report"} on ${dateLabel}` +
        ". EPS and revenue estimates, price and market cap, plus the fortnight ahead.";
    } else {
      title = `Earnings Calendar: ${dateLabel} | MyStockHarbor`;
      description = `No US-listed companies report on ${dateLabel}. Browse the full earnings calendar for the weeks ahead, with EPS and revenue estimates, price and market cap.`;
    }
  } catch {
    // Fall back to the static strings rather than failing the render.
  }

  return {
    title,
    description,
    // Deliberately still the bare canonical. Every ?date= and ?year=&month=
    // variant folds onto one URL: this site's constraint is crawl demand (582
    // URLs discovered and never crawled as of 17 Aug 2026), so minting a URL
    // per day would add thin pages to a backlog Google is already not working
    // through. The title/description carry the date instead.
    alternates: { canonical: PAGE_URL },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: PAGE_URL,
      siteName: "MyStockHarbor",
      images: [
        {
          url: OG_IMAGE_URL,
          width: 1200,
          height: 630,
          alt: "MyStockHarbor earnings calendar",
        },
      ],
      locale: "en_GB",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE_URL],
    },
  };
}

// WHAT A PAGE VIEW COSTS IN REDIS COMMANDS, and why that is the point.
//
// This page is not an FMP problem -- the window self-limits, and the comment on
// the after() block below is right that the scans short-circuit once it is
// filled. It is a REDIS AND LAMBDA problem, and Redis command volume is what
// suspended the database on 2026-08-28.
//
// Counted per request, steady state, on a cold instance:
//
//   getMonthDaysWithEarnings  2   month rows + the stock-list name map
//   loadDay                   2   day items + the completeness marker
//   isDateFullyPopulated      1   the SAME completeness marker, read again
//   forward sections          1   the analysis-universe symbol key
//                          + 50   the committed cut's report-date records
//   after(): populate         3   hour usage, fill frontier, frontier re-park
//                            --
//                            59
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

  // Rolling window bounds and the months that hold them. Everything outside
  // [windowStart, windowEnd] is greyed out and non-navigable.
  const windowStart = getWindowStartDate();
  const windowEnd = getWindowEndDate();
  const firstYM = windowStart.slice(0, 7);
  const lastYM = windowEnd.slice(0, 7);

  const { year, month, monthPrefix, todayDate, selectedDate } = resolveCalendarView(params);

  const prevMonthDate = new Date(Date.UTC(year, month - 2, 1));
  const nextMonthDate = new Date(Date.UTC(year, month, 1));
  const prevHref = `/earnings-calendar?year=${prevMonthDate.getUTCFullYear()}&month=${prevMonthDate.getUTCMonth() + 1}`;
  const nextHref = `/earnings-calendar?year=${nextMonthDate.getUTCFullYear()}&month=${nextMonthDate.getUTCMonth() + 1}`;
  const todayHref = `/earnings-calendar`;

  // Nav limits: can't page before the month holding the window start, nor
  // after the month holding the window end.
  const prevDisabled = monthPrefix <= firstYM;
  const nextDisabled = monthPrefix >= lastYM;

  const [dayCounts, dayData, dateComplete, forward] =
    await Promise.all([
      getMonthDayCounts(year, month),
      // Shared with generateMetadata via cache() -- this does not re-fetch.
      loadDay(selectedDate),
      loadDayComplete(selectedDate),
      getForwardSections(todayDate),
      // ── THE DUE STRIP, ALWAYS ON TODAY ─────────────────────────────────
      // `todayDate`, never `selectedDate`. The strip answers "whose period has
      // ended with nothing filed for it AS OF NOW" -- a present-tense fact
      // about the public record. Passing the date the visitor happens to be
      // browsing would turn it into "who was outstanding on 3 August", which
      // is a different claim, and on a FUTURE date it would be a forecast --
      // the one thing lib/server/dueToReport.ts's header exists to forbid.
      //
      // It reads the analysis-universe key plus the 50 records of the
      // committed cut. It does NOT read the SEC manifest: that value is
      // ~417 KB and check-sec-daily-index names the only two job routes
      // allowed to touch it, explicitly excluding render paths. See
      // coverageOfCut in lib/server/dueInputs.ts.
    ]);

  // ── WHAT AN EMPTY DAY MEANS, RESOLVED ONCE ───────────────────────────────
  // This page used to ask `dayData.usListedCount > 0` and render one of two
  // sentences. That is a bare emptiness test, and it is the defect #483 fixed
  // ONE LAYER DOWN and this page then reintroduced at the top: a date whose
  // month read FAILED and a genuinely quiet Sunday both produce zero rows, and
  // both got the quiet-Sunday words.
  //
  // #483 shipped the two signals needed to tell them apart -- `complete` and
  // getMonthVisibility -- and NOTHING IN lib/ OR app/ CONSULTED EITHER. A
  // distinction nothing reads is not a fix, which is why this is wired here
  // rather than documented again.
  //
  // READ AFTER loadDay, DELIBERATELY. getDayCandidates resolves the whole month
  // behind the date, so the visibility map is populated by the await above;
  // reading it before would report "unseen" for every date on every render.
  const dayState = resolveCalendarDay({
    items: dayData.items,
    totalCandidates: dayData.totalCandidates,
    complete: dateComplete,
    monthVisibility: getMonthVisibility(year, month),
    // TODAY'S US FILING DAY, STILL OPEN (#552 COWORK #23): "nothing yet", not a
    // gap. On or after the Eastern date, never before it.
    dayOpen: selectedDate >= easternDate(new Date()),
  });
  const dayStateNote = dayStateMessage(dayState);

  const selectedDateLabel = formatDateLabel(selectedDate);

  // Background auto-populate: after this response is sent, quietly fill in the
  // next not-yet-complete date in the window (front-to-back), a couple at a
  // time and respecting the hourly cap. Once the whole window is filled these
  // scans short-circuit at zero cost until it rolls forward.
  after(async () => {
    try {
      // ONE SCAN PER GATE_SECONDS ACROSS ALL INSTANCES, not one per visitor.
      //
      // The steady-state scan is only 3 commands, so this is not really about
      // those. It is about the window ROLLING FORWARD: at that moment every
      // concurrent visitor starts walking the frontier and calling
      // getFullDayEarnings, and they all do the same work against the same
      // dates. QUOTE_HOURLY_CAP bounds the FMP side globally; nothing bounded
      // the Redis side or the duplicated effort.
      //
      // SET NX is the whole mechanism: the claim and the test are one round
      // trip, so two instances cannot both win it. Failing to claim is the
      // normal outcome and costs one command.
      if (!(await claimCalendarScan())) return;

      // Finish quoting the viewed date beyond the seed the render painted
      // (cap-limited, mostly cache hits), then keep the window frontier moving.
      if (!dateComplete) {
        await getFullDayEarnings(selectedDate, { forceRefresh: true });
      }
      await populateNextMissingDate({ maxDates: 2 });
    } catch {
      // best-effort background job; failures shouldn't affect any page load
    }
  });

  const weeks = buildCalendarWeeks(year, month);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://www.mystockharbor.com/#organization",
        name: "MyStockHarbor",
        url: "https://www.mystockharbor.com",
        logo: {
          "@type": "ImageObject",
          url: "https://www.mystockharbor.com/logo.png",
        },
      },
      {
        "@type": "CollectionPage",
        "@id": `${PAGE_URL}#webpage`,
        url: PAGE_URL,
        name: `Earnings Calendar: ${selectedDateLabel}`,
        description: PAGE_DESCRIPTION,
        isPartOf: {
          "@type": "WebSite",
          "@id": "https://www.mystockharbor.com/#website",
          name: "MyStockHarbor",
          url: "https://www.mystockharbor.com",
        },
        publisher: { "@id": "https://www.mystockharbor.com/#organization" },
        // The page held a list of dated financial events and previously told
        // Google nothing about any of them. Capped at the 50 rows that are
        // actually server-rendered, so the markup describes what's on the page.
        ...(dayData.items.length
          ? {
              mainEntity: {
                "@type": "ItemList",
                name: `US-listed companies reporting earnings on ${selectedDateLabel}`,
                numberOfItems: dayData.usListedCount,
                itemListElement: dayData.items.slice(0, 50).map((item, index) => ({
                  "@type": "ListItem",
                  position: index + 1,
                  name: `${item.company} (${item.symbol})`,
                  url: `https://www.mystockharbor.com/stock/${encodeURIComponent(item.symbol)}/earnings`,
                })),
              },
            }
          : {}),
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${PAGE_URL}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: "https://www.mystockharbor.com/",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Earnings Calendar",
            item: PAGE_URL,
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main
        className="earnCalMain"
        style={{
          minHeight: "100vh",
          background: "#06080d",
          color: "#f1f5f9",
          fontFamily: "system-ui, Arial",
          padding: "40px 20px",
          overflowX: "hidden",
        }}
      >
        <div style={{ maxWidth: 1160, margin: "0 auto" }}>
          <div style={{ marginBottom: 24 }}>
            <Link
              href="/"
              style={{
                color: "#93c5fd",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              ← Back to Dashboard
            </Link>
          </div>

          <section
            className="earnCalIntroCard"
            style={{
              background: "#0b1220",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              padding: 24,
              boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
              marginBottom: 24,
            }}
          >
            <h1
              className="earnCalTitle"
              style={{
                marginTop: 0,
                marginBottom: 12,
                fontSize: 34,
                lineHeight: 1.1,
                fontWeight: 900,
              }}
            >
              {selectedDate === todayDate
                ? "Earnings filed today"
                : `Earnings filed on ${selectedDateLabel}`}
            </h1>

            <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92, marginBottom: 20 }}>
              {/* 2026-09-23 (#552, COWORK #26 items 2-3): "EPS/revenue
                  estimates" dropped -- the grid no longer shows estimates. The
                  day-state note (e.g. the "cannot be listed right now" gap
                  message) is no longer repeated here; it is shown once, in the
                  day panel below. */}
              {dayState.kind === "listed" ? (
                <>
                  <strong>{dayState.items.length}</strong> US-listed{" "}
                  {dayState.items.length === 1 ? "company has" : "companies have"} results on file
                  for {selectedDateLabel}. See how many have filed on each day, then drill into any
                  date for tickers, price and market cap.
                </>
              ) : (
                <>
                  See how many companies have filed on each day, then drill into any date for
                  tickers, price and market cap.
                </>
              )}
            </p>

            <EarningsTickerSearch />
          </section>

          {/* ── THE "NEXT UP" TICKER WAS HERE AND IS GONE ──────────────────
              Not a design preference. The window was inverted to
              [today-90, today] on 2026-09-15, and the ticker walked FORWARD
              fourteen days through isDateInWindow -- so only `today` ever
              passed, and every row it rendered was stamped "Today" under a
              "Next up" heading. Several different companies, all labelled the
              same wrong thing.

              Its function -- "who is reporting soon" -- is now served honestly
              by EarningsExpectedSection below the grid, which is measured,
              banded and labelled as an estimate. */}
          <EarningsDueStrip state={forward.due} />

          <section
            style={{
              background: "#0b1220",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
              marginBottom: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 800 }}>{monthLabel(year, month)}</div>
              <div style={{ display: "flex", gap: 8 }}>
                {/* prefetch=false on every Link in this section: without it,
                    Next.js silently issues a background request for each
                    link the instant it's in the viewport. The month grid
                    below puts ~30-35 day cells on screen at once, so a
                    single page view was quietly firing 30+ extra requests
                    to this same route. See lib/server/earningsCalendar.ts. */}
                {prevDisabled ? (
                  <span style={navBtnDisabledStyle} aria-disabled="true">
                    ← Prev
                  </span>
                ) : (
                  <Link href={prevHref} prefetch={false} style={navBtnStyle}>
                    ← Prev
                  </Link>
                )}
                <Link href={todayHref} prefetch={false} style={navBtnStyle}>
                  Today
                </Link>
                {nextDisabled ? (
                  <span style={navBtnDisabledStyle} aria-disabled="true">
                    Next →
                  </span>
                ) : (
                  <Link href={nextHref} prefetch={false} style={navBtnStyle}>
                    Next →
                  </Link>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {WEEKDAY_LABELS.map((label) => (
                <div
                  key={label}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    color: "#8a97ad",
                    textAlign: "center",
                    padding: "4px 0",
                  }}
                >
                  {label}
                </div>
              ))}

              {weeks.map((week, weekIdx) =>
                week.map((day, dayIdx) => {
                  if (day === null) {
                    return <div key={`${weekIdx}-${dayIdx}`} />;
                  }

                  const cellDate = `${year}-${pad2(month)}-${pad2(day)}`;
                  const count = dayCounts.get(cellDate) ?? 0;
                  const isSelected = cellDate === selectedDate;
                  const isToday = cellDate === todayDate;
                  const outside = outOfWindowCell(cellDate, windowStart, windowEnd);

                  // A FUTURE day is neutral: a faded number, nothing else. A
                  // red ✕ there read as "failed" (#552 COWORK #23).
                  if (outside === "future") {
                    return (
                      <div
                        key={cellDate}
                        aria-disabled="true"
                        title="Nothing filed yet"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 4,
                          padding: "10px 4px",
                          minHeight: 62,
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.05)",
                          background: "transparent",
                          color: "#64748b",
                          cursor: "default",
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.45 }}>{day}</span>
                      </div>
                    );
                  }

                  // Greyed, non-clickable archived day (before the window):
                  // faded number + ✕, no populate.
                  if (outside === "archived") {
                    return (
                      <div
                        key={cellDate}
                        aria-disabled="true"
                        title="Outside the active earnings window"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 4,
                          padding: "10px 4px",
                          minHeight: 62,
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.05)",
                          background: "rgba(255,255,255,0.015)",
                          color: "#64748b",
                          cursor: "default",
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.4 }}>{day}</span>
                        <span style={{ fontSize: 14, fontWeight: 900, color: "#ef4444", opacity: 0.6 }}>
                          ✕
                        </span>
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={cellDate}
                      href={`/earnings-calendar?year=${year}&month=${month}&date=${cellDate}`}
                      prefetch={false}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        padding: "10px 4px",
                        minHeight: 62,
                        borderRadius: 10,
                        textDecoration: "none",
                        border: isSelected
                          ? "1px solid rgba(147,197,253,0.6)"
                          : "1px solid rgba(255,255,255,0.08)",
                        background: isSelected ? "rgba(147,197,253,0.14)" : "rgba(255,255,255,0.02)",
                        color: isSelected ? "#93c5fd" : "#e2e8f0",
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: isToday ? 900 : 700 }}>
                        {day}
                        {isToday ? " •" : ""}
                      </span>
                      {count > 0 ? (
                        // THE COUNT, NOT ONLY A DOT (#552 COWORK #23): the intro
                        // promises "how many companies have filed on each day".
                        <span
                          aria-label={`${count} ${count === 1 ? "company has" : "companies have"} results on file`}
                          title={`${count} ${count === 1 ? "company has" : "companies have"} results on file`}
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            lineHeight: 1,
                            padding: "3px 7px",
                            borderRadius: 999,
                            color: "#bbf7d0",
                            background: "rgba(34,197,94,0.18)",
                            border: "1px solid rgba(34,197,94,0.45)",
                          }}
                        >
                          {count}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, opacity: 0.3 }}>—</span>
                      )}
                    </Link>
                  );
                })
              )}
            </div>
          </section>

          <section
            style={{
              background: "#0b1220",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
            }}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{formatDateLabel(selectedDate)}</div>
              <div style={{ fontSize: 12.5, opacity: 0.6, marginTop: 3 }}>
                {dayState.kind === "listed"
                  ? `${dayState.items.length} US-listed compan${dayState.items.length === 1 ? "y has" : "ies have"} results on file`
                  : dayStateNote}
                {dayState.kind === "listed" && !dateComplete && dayData.totalCandidates > 0
                  ? " · still populating…"
                  : ""}
              </div>
            </div>

            <div style={{ padding: 16 }}>
              <EarningsDayList
                date={selectedDate}
                initialItems={dayData.items.slice(0, 50)}
                initialHasMore={dayData.items.length > 50}
                complete={dateComplete}
              />
              {/* ONCE, AND ONLY WHEN A ROW IS ACTUALLY BLANK. Printed under the
                  table rather than in every cell: fifty rows each saying "not
                  covered" is noise, and a tooltip is invisible on a phone. The
                  condition matters as much as the words -- a standing note on a
                  day where every row IS covered would explain a gap that is not
                  there, which is its own small lie. */}
              {dayData.items.some((i) => i.priceCoverage === "outside-bar-universe") ? (
                <p style={{ fontSize: 12.5, opacity: 0.6, marginTop: 12, marginBottom: 0 }}>
                  {PRICE_COVERAGE_NOTE}
                </p>
              ) : null}
            </div>
          </section>

          <div style={{ marginTop: 16 }}>
            {/* NOT gated on dateComplete: that is the flag the poisoning
                corrupts, and gating the manual override on it disabled the
                override exactly when it was needed. See BackfillButton. */}
            <BackfillButton date={selectedDate} hasEarnings={dayData.totalCandidates > 0} />
          </div>

          {/* ── THE THIRD AND WEAKEST CLAIM, PLACED LAST ────────────────────
              The page reads filed -> outstanding -> expected, strongest first.
              This sits BELOW the grid so the whole confirmed body separates it
              from the due strip: that strip exists to never look like a
              forecast, and putting an estimate beside it is the fastest way to
              undo it. Rendered unconditionally, for the same reason the due
              strip is -- "nothing clears the bar" and "we cannot read the
              record" are different sentences and both need saying. */}
          <EarningsExpectedSection state={forward.expected} />

          {/* SEC, NOT FMP (#535 COWORK #18 §3). The grid lists announcements
              filed with the SEC; a 6-K carries no item code, and the text rule
              measured too many false positives to list as results (COWORK #23,
              rule C), so those filers are named as absent rather than guessed. */}
          <p style={{ fontSize: 12.5, opacity: 0.55, marginTop: 16 }}>
            Dates are the day each company filed its results announcement with the SEC
            (Form 8-K, Item 2.02). Companies filing results only as Form 6-K are not
            listed here. This is a starting point for further research, not investment advice.
          </p>

          {/* Continue exploring — server-rendered internal links into other
              indexable hub pages, to help crawl discovery from this
              high-ticker-volume page. */}
          <section
            style={{
              marginTop: 28,
              background: "#0b1220",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>Continue exploring</div>
            <div style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.75, marginBottom: 14 }}>
              Track upcoming listings, read the latest chart insights, or scan the
              supply-chain bottlenecks behind the market.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/upcoming-ipos" style={exploreLinkStyle}>
                Upcoming IPOs →
              </Link>
              <Link href="/insights" style={exploreLinkStyle}>
                Insights →
              </Link>
              <Link href="/bottlenecks" style={exploreLinkStyle}>
                Bottlenecks →
              </Link>
            </div>
          </section>
        </div>

        <style>{`
          @media (max-width: 640px) {
            .earnCalMain {
              padding: 24px 14px !important;
            }
            .earnCalIntroCard {
              padding: 18px !important;
            }
            .earnCalTitle {
              font-size: 26px !important;
            }
          }
        `}</style>
      </main>
    </>
  );
}

const navBtnStyle: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: 9,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.03)",
  color: "#e2e8f0",
  textDecoration: "none",
  fontWeight: 700,
  fontSize: 12.5,
};

const navBtnDisabledStyle: React.CSSProperties = {
  ...navBtnStyle,
  opacity: 0.3,
  cursor: "default",
};

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
  fontSize: 13,
  whiteSpace: "nowrap",
};
