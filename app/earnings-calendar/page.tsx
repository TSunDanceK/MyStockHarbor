import Link from "next/link";
import type { Metadata } from "next";
import type React from "react";
import { getMonthDayCounts, getDayEarningsPage, daysInMonth } from "@/lib/server/earningsCalendar";
import EarningsDayList from "./EarningsDayList";
import EarningsTickerSearch from "./EarningsTickerSearch";

const PAGE_TITLE = "Earnings Calendar | MyStockHarbor";
const PAGE_DESCRIPTION =
  "Navigable monthly earnings calendar - see how many companies report each day, then drill into any date for tickers, EPS/revenue estimates, price and market cap.";
const PAGE_URL = "https://www.mystockharbor.com/earnings-calendar";
const OG_IMAGE_URL = "https://www.mystockharbor.com/og-image-v2.png";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  robots: { index: true, follow: true },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
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
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [OG_IMAGE_URL],
  },
};

export const dynamic = "force-dynamic";

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

export default async function EarningsCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; date?: string }>;
}) {
  const params = await searchParams;

  const now = new Date();
  const todayYear = now.getUTCFullYear();
  const todayMonth = now.getUTCMonth() + 1;
  const todayDate = `${todayYear}-${pad2(todayMonth)}-${pad2(now.getUTCDate())}`;

  const yearParam = Number(params.year);
  const monthParam = Number(params.month);

  const year = Number.isFinite(yearParam) && yearParam > 0 ? yearParam : todayYear;
  const month = Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : todayMonth;

  const monthPrefix = `${year}-${pad2(month)}`;
  const requestedDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null;

  const selectedDate =
    requestedDate && requestedDate.startsWith(monthPrefix)
      ? requestedDate
      : year === todayYear && month === todayMonth
        ? todayDate
        : `${monthPrefix}-01`;

  const prevMonthDate = new Date(Date.UTC(year, month - 2, 1));
  const nextMonthDate = new Date(Date.UTC(year, month, 1));
  const prevHref = `/earnings-calendar?year=${prevMonthDate.getUTCFullYear()}&month=${prevMonthDate.getUTCMonth() + 1}`;
  const nextHref = `/earnings-calendar?year=${nextMonthDate.getUTCFullYear()}&month=${nextMonthDate.getUTCMonth() + 1}`;

  const [dayCounts, dayPage] = await Promise.all([
    getMonthDayCounts(year, month),
    getDayEarningsPage(selectedDate, 0),
  ]);

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
        name: "Earnings Calendar",
        description: PAGE_DESCRIPTION,
        isPartOf: {
          "@type": "WebSite",
          "@id": "https://www.mystockharbor.com/#website",
          name: "MyStockHarbor",
          url: "https://www.mystockharbor.com",
        },
        publisher: { "@id": "https://www.mystockharbor.com/#organization" },
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
              Earnings Calendar
            </h1>

            <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92, marginBottom: 20 }}>
              See how many companies report each day, then drill into any date
              for tickers, EPS/revenue estimates, price and market cap.
            </p>

            <EarningsTickerSearch />
          </section>

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
                    to this same route -- enough on its own to trip the
                    Vercel firewall's per-IP rate limit on ordinary browsing.
                    See lib/server/earningsCalendar.ts for the matching
                    server-side guard (hourly cap on new ticker quotes). */}
                <Link href={prevHref} prefetch={false} style={navBtnStyle}>
                  ← Prev
                </Link>
                <Link href="/earnings-calendar" prefetch={false} style={navBtnStyle}>
                  Today
                </Link>
                <Link href={nextHref} prefetch={false} style={navBtnStyle}>
                  Next →
                </Link>
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
                  const count = dayCounts[cellDate] ?? 0;
                  const isSelected = cellDate === selectedDate;
                  const isToday = cellDate === todayDate;

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
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "1px 7px",
                            borderRadius: 999,
                            background: "rgba(34,197,94,0.14)",
                            color: "#4ade80",
                          }}
                        >
                          {count}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, opacity: 0.35 }}>—</span>
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
                {dayPage.totalCandidates} US-listed compan{dayPage.totalCandidates === 1 ? "y" : "ies"} reporting
              </div>
            </div>

            <div style={{ padding: 16 }}>
              <EarningsDayList
                date={selectedDate}
                initialItems={dayPage.items}
                initialTotalCandidates={dayPage.totalCandidates}
                initialFetchedCount={dayPage.fetchedCount}
                initialHasMore={dayPage.hasMore}
                initialNextBatch={dayPage.nextBatch}
              />
            </div>
          </section>

          <p style={{ fontSize: 12.5, opacity: 0.55, marginTop: 16 }}>
            Data source: financialmodelingprep.com. Estimates can change
            before the report date — treat this as a starting point for
            further research, not investment advice.
          </p>
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
