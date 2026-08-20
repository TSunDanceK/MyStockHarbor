import Link from "next/link";
import { after } from "next/server";
import type { Metadata } from "next";
import type React from "react";
import { cache } from "react";
import {
  getMonthDaysWithEarnings,
  getDayEarningsForRender,
  getFullDayEarnings,
  populateNextMissingDate,
  isDateFullyPopulated,
  getWindowStartDate,
  getWindowEndDate,
  isDateInWindow,
  getCachedDayItems,
  daysInMonth,
} from "@/lib/server/earningsCalendar";
import EarningsDayList from "./EarningsDayList";
import EarningsTickerSearch from "./EarningsTickerSearch";
import EarningsUpcomingTicker, { type UpcomingEarningsItem } from "./EarningsUpcomingTicker";
import BackfillButton from "./BackfillButton";

const PAGE_TITLE = "Earnings Calendar | MyStockHarbor";
const PAGE_DESCRIPTION =
  "Navigable monthly earnings calendar - see how many companies report each day, then drill into any date for tickers, EPS/revenue estimates, price and market cap.";
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

// Rows for the "Next up" strip at the top of the page.
//
// Walks forward from today and takes the biggest names off each day's cache
// until it has enough. getCachedDayItems is read-only and never quotes an
// upstream API -- it returns whatever the background populate job has already
// materialised -- so this costs a handful of Redis reads and nothing else. A
// day that has not been filled yet simply contributes nothing rather than
// triggering a fetch, which keeps the ticker off the critical path of the
// window-filling logic entirely.
//
// Items are already market-cap sorted inside each day (see dedupeAndSortItems),
// so taking the head of each day gives recognisable companies while the overall
// order stays chronological -- which is the point of the strip.
const TICKER_DAYS_AHEAD = 14;
const TICKER_MAX_ITEMS = 18;
const TICKER_MAX_PER_DAY = 3;

async function getUpcomingTickerItems(todayDate: string): Promise<UpcomingEarningsItem[]> {
  try {
    const dates: string[] = [];
    const cursor = new Date(`${todayDate}T00:00:00Z`);
    if (Number.isNaN(cursor.getTime())) return [];

    for (let i = 0; i < TICKER_DAYS_AHEAD; i++) {
      const iso = cursor.toISOString().slice(0, 10);
      if (isDateInWindow(iso)) dates.push(iso);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    if (!dates.length) return [];

    const perDay = await Promise.all(
      dates.map(async (date) => {
        try {
          return { date, items: await getCachedDayItems(date) };
        } catch {
          return { date, items: [] };
        }
      })
    );

    const out: UpcomingEarningsItem[] = [];
    const seen = new Set<string>();

    for (const { date, items } of perDay) {
      const label = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });

      let takenToday = 0;
      for (const item of items) {
        if (takenToday >= TICKER_MAX_PER_DAY || out.length >= TICKER_MAX_ITEMS) break;
        const symbol = String(item.symbol || "").trim().toUpperCase();
        // A company reporting inside the window twice (a restated or corrected
        // date) would otherwise appear twice in one short strip.
        if (!symbol || seen.has(symbol)) continue;
        seen.add(symbol);
        out.push({
          symbol,
          company: String(item.company || symbol).trim(),
          date,
          dayLabel: date === todayDate ? "Today" : label,
        });
        takenToday++;
      }
      if (out.length >= TICKER_MAX_ITEMS) break;
    }

    return out;
  } catch {
    // The strip is decorative; it must never take the calendar down with it.
    return [];
  }
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

  const [daysWithEarnings, dayData, dateComplete, upcomingTickerItems] = await Promise.all([
    getMonthDaysWithEarnings(year, month),
    // Shared with generateMetadata via cache() -- this does not re-fetch.
    loadDay(selectedDate),
    isDateFullyPopulated(selectedDate),
    getUpcomingTickerItems(todayDate),
  ]);

  const selectedDateLabel = formatDateLabel(selectedDate);

  // Background auto-populate: after this response is sent, quietly fill in the
  // next not-yet-complete date in the window (front-to-back), a couple at a
  // time and respecting the hourly cap. Once the whole window is filled these
  // scans short-circuit at zero cost until it rolls forward.
  after(async () => {
    try {
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
              Earnings Calendar: {selectedDateLabel}
            </h1>

            <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92, marginBottom: 20 }}>
              {dayData.usListedCount > 0 ? (
                <>
                  <strong>{dayData.usListedCount}</strong> US-listed{" "}
                  {dayData.usListedCount === 1 ? "company reports" : "companies report"} on{" "}
                  {selectedDateLabel}. See how many report each day, then drill into any date for
                  tickers, EPS/revenue estimates, price and market cap.
                </>
              ) : (
                <>
                  See how many companies report each day, then drill into any date for tickers,
                  EPS/revenue estimates, price and market cap.
                </>
              )}
            </p>

            <EarningsTickerSearch />
          </section>

          <EarningsUpcomingTicker items={upcomingTickerItems} />

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
                  const hasEarnings = daysWithEarnings.has(cellDate);
                  const isSelected = cellDate === selectedDate;
                  const isToday = cellDate === todayDate;
                  const outOfWindow = cellDate < windowStart || cellDate > windowEnd;

                  // Greyed, non-clickable archived/out-of-range day: faded
                  // number + red ✕, no populate.
                  if (outOfWindow) {
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
                      {hasEarnings ? (
                        <span
                          aria-label="Companies report on this date"
                          title="Companies report on this date"
                          style={{
                            display: "block",
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: "#22c55e",
                            boxShadow: "0 0 6px rgba(34,197,94,0.55)",
                          }}
                        />
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
                {dayData.usListedCount} US-listed compan{dayData.usListedCount === 1 ? "y" : "ies"} reporting
                {!dateComplete && dayData.totalCandidates > 0 ? " · still populating…" : ""}
              </div>
            </div>

            <div style={{ padding: 16 }}>
              <EarningsDayList
                date={selectedDate}
                initialItems={dayData.items.slice(0, 50)}
                initialHasMore={dayData.items.length > 50}
                complete={dateComplete}
              />
            </div>
          </section>

          <div style={{ marginTop: 16 }}>
            <BackfillButton
              date={selectedDate}
              complete={dateComplete}
              hasEarnings={dayData.totalCandidates > 0}
            />
          </div>

          <p style={{ fontSize: 12.5, opacity: 0.55, marginTop: 16 }}>
            Data source: financialmodelingprep.com. Estimates can change
            before the report date — treat this as a starting point for
            further research, not investment advice.
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
