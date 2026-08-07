import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SECTORS, getSectorBySlug, sectorNewsPath } from "@/lib/sectors";
import { getSectorNewsBaseData, type SectorNewsBaseData } from "@/lib/sector-news-data";
import {
  getSectorBreadth,
  getSectorEarningsThisWeek,
  getSectorMovers,
  getSectorPerformanceRow,
  type SectorBreadth,
  type SectorEarningsEntry,
  type SectorMovers,
} from "@/lib/server/sectorPanels";
import {
  buildSectorLead,
  buildSectorRead,
  buildSectorWhyItMatters,
} from "@/lib/sector-news-templates";
import type { NewsItem } from "@/lib/news-scoring";
import ShareButton from "@/app/components/ShareButton";
import NewsScoreGauge, { scorePanelStyle } from "@/app/components/NewsScoreGauge";
import {
  WatermarkVisibilityProvider,
  HideWatermarksBar,
  NewsScoreWatermark,
} from "@/app/components/WatermarkVisibility";
import WhyThisMatters from "@/app/stock/[symbol]/news/WhyThisMatters";

export const runtime = "nodejs";
// Matches app/stock/[symbol]/news/page.tsx: the underlying data is already
// unstable_cache'd for an hour in lib/sector-news-data.ts, but Vercel's Full
// Route Cache would otherwise serve HTML built at deploy time indefinitely.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
};

const SITE = "https://www.mystockharbor.com";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const sector = getSectorBySlug(slug);

  if (!sector) {
    return { title: "Sector News | MyStockHarbor", robots: { index: false, follow: true } };
  }

  const url = `${SITE}${sectorNewsPath(sector.slug)}`;
  const title = `${sector.name} Sector News, Sentiment Score & What It Means | MyStockHarbor`;
  const description = `Latest ${sector.name.toLowerCase()} sector news with beginner-friendly summaries. Sector news score, most-mentioned stocks, breadth, movers and who reports next.`;

  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: {
      title: `${sector.name} Sector News & Sentiment | MyStockHarbor`,
      description,
      url,
      siteName: "MyStockHarbor",
      type: "article",
      images: [
        {
          url: `${SITE}/og-image-v2.png`,
          width: 1200,
          height: 630,
          alt: "MyStockHarbor sector news dashboard",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${sector.name} Sector News & Sentiment | MyStockHarbor`,
      description,
      images: [`${SITE}/og-image-v2.png`],
    },
  };
}

// --- small local formatters (mirrors the per-stock news page) ---------------

function compactSource(source: string | null) {
  if (!source) return "News";
  return source.replace(/\.(com|net|org|co\.uk)$/i, "").slice(0, 28);
}

function stripAnyHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDate(value: string | null) {
  if (!value) return "Recent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recent";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `$${value.toFixed(2)}`;
}

function moveColour(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "#f8fafc";
  if (value > 0.05) return "#86efac";
  if (value < -0.05) return "#fca5a5";
  return "#f8fafc";
}

function snippet(item: NewsItem, sectorName: string) {
  const text = item.description ? stripAnyHtml(item.description) : "";
  if (text.length > 40) return text.length > 320 ? `${text.slice(0, 317)}...` : text;
  return `${compactSource(item.source)} is covering a development in the ${sectorName.toLowerCase()} sector. The useful question is usually whether peers move with it or whether it stays company-specific.`;
}

/** The constituent this article is primarily about, when FMP tagged one. */
function primarySymbol(item: NewsItem, constituents: string[]) {
  const set = new Set(constituents);
  for (const symbol of item.fmpSymbols ?? []) {
    if (set.has(symbol)) return symbol;
  }
  return null;
}

function structuredNews(items: NewsItem[]) {
  return items.slice(0, 10).map((item, index) => ({
    "@type": "NewsArticle",
    position: index + 1,
    headline: stripAnyHtml(item.title).slice(0, 110),
    url: item.link,
    datePublished: item.pubDate ?? undefined,
    publisher: item.source ? { "@type": "Organization", name: item.source } : undefined,
  }));
}

// --- page -------------------------------------------------------------------

export default async function SectorNewsPage({ params }: Props) {
  const { slug } = await params;
  const sector = getSectorBySlug(slug);

  if (!sector) notFound();

  const data = await getSectorNewsBaseData(sector.slug);

  if (!data) notFound();

  const [performance, movers, earnings, breadth] = await Promise.all([
    getSectorPerformanceRow(sector.slug),
    getSectorMovers(sector.slug),
    getSectorEarningsThisWeek(sector.slug),
    getSectorBreadth(sector.slug),
  ]);

  const { newsScore, earningsScore, detailedNews, compactNews, mentions, constituents } = data;

  const leadSummary = buildSectorLead({
    sector,
    newsScore,
    articleCount: data.rankedNews.length,
    constituentCount: constituents.length,
    dayMove: performance?.day ?? null,
    rank: performance?.rank ?? null,
  });

  const sectorRead = buildSectorRead({
    sector,
    newsScore,
    earningsLabel: earningsScore.label,
    breadth,
    performance,
    topMentions: mentions,
    earningsCount: earnings.length,
  });

  const url = `${SITE}${sectorNewsPath(sector.slug)}`;
  const screenerHref = `/stock-screener?sector=${encodeURIComponent(sector.fmpLabel)}`;

  return (
    <WatermarkVisibilityProvider>
      <main
        style={{
          minHeight: "100vh",
          background:
            "radial-gradient(circle at top left, rgba(37,99,235,0.18), transparent 22%), radial-gradient(circle at top right, rgba(34,197,94,0.10), transparent 22%), #06080d",
          color: "#f1f5f9",
          fontFamily: "system-ui, Arial",
        }}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  "@id": `${SITE}/#organization`,
                  name: "MyStockHarbor",
                  url: SITE,
                  logo: { "@type": "ImageObject", url: `${SITE}/logo.png` },
                },
                {
                  "@type": "WebSite",
                  "@id": `${SITE}/#website`,
                  name: "MyStockHarbor",
                  url: SITE,
                  publisher: { "@id": `${SITE}/#organization` },
                },
                {
                  "@type": "WebPage",
                  "@id": `${url}#webpage`,
                  url,
                  name: `${sector.name} Sector News | MyStockHarbor`,
                  description: leadSummary,
                  isPartOf: { "@id": `${SITE}/#website` },
                  breadcrumb: { "@id": `${url}#breadcrumb` },
                  mainEntity: { "@id": `${url}#collection` },
                },
                {
                  "@type": "CollectionPage",
                  "@id": `${url}#collection`,
                  url,
                  name: `${sector.name} Sector News`,
                  description: `Latest ${sector.name.toLowerCase()} sector news with a sector news score, most-mentioned stocks, breadth and upcoming earnings.`,
                  isPartOf: { "@id": `${SITE}/#website` },
                  hasPart: structuredNews([...detailedNews, ...compactNews]),
                },
                {
                  "@type": "BreadcrumbList",
                  "@id": `${url}#breadcrumb`,
                  itemListElement: [
                    { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
                    { "@type": "ListItem", position: 2, name: "Sector News", item: `${SITE}/sector` },
                    { "@type": "ListItem", position: 3, name: `${sector.name} Sector News`, item: url },
                  ],
                },
              ],
            }),
          }}
        />

        <div className="newsWrap">
          <section className="newsHeroShell" style={heroShellStyle}>
            <div style={heroTopBarStyle}>
              <div style={newsDeskTagStyle}>SECTOR NEWS DESK</div>
              <ShareButton
                url={url}
                title={`${sector.name} Sector News & Sentiment | MyStockHarbor`}
                text={`${sector.name} sector news — sentiment score, breadth and what's driving it 📊 MyStockHarbor`}
              />
            </div>

            <div className="newsHeroLeft" style={heroLeftStyle}>
              <h1 className="newsHeroTitle" style={heroTitleStyle}>
                {sector.name} Sector News, News Score &amp; What It Could Mean
              </h1>
              <p className="newsHeroLead" style={heroLeadStyle}>
                {leadSummary}
              </p>
              <p style={heroBlurbStyle}>{sector.blurb}</p>

              <div style={headlineTakeStyle}>
                <strong style={{ color: "#93c5fd" }}>HEADLINE TAKE:</strong> {newsScore.reason}
              </div>

              <SectorPillRow currentSlug={sector.slug} />

              <div className="newsHeroCtaRow" style={heroCtaRowStyle}>
                <Link href={screenerHref} className="newsHeroBtn" style={heroPrimaryCtaStyle}>
                  SCREEN {sector.shortName.toUpperCase()} STOCKS
                </Link>
                <Link href="/platforms" className="newsHeroBtn" style={heroSecondaryCtaStyle}>
                  TRADE THIS SECTOR
                </Link>
              </div>
              <div style={heroSubCopyStyle}>
                Filter the full screener down to this sector, or head to Platforms when you are
                ready to act.
              </div>
            </div>

            <div className="newsHeroRight" style={heroRightStyle}>
              <div style={scorePanelStyle(newsScore.tone)}>
                <NewsScoreWatermark />
                <NewsScoreGauge newsScore={newsScore} kicker="SECTOR NEWS SCORE" />
              </div>

              <div style={miniScoreGridStyle}>
                <div style={miniScoreCardStyle(performanceTone(performance?.day))}>
                  <div style={miniScoreTitleStyle}>Sector Today</div>
                  <div
                    style={{ ...miniScoreNumberStyle, color: moveColour(performance?.day ?? null) }}
                  >
                    {formatPercent(performance?.day ?? null)}
                  </div>
                  <div style={miniScoreLabelStyle}>
                    {typeof performance?.rank === "number"
                      ? `Ranked ${performance.rank} of 11 today`
                      : "Ranking unavailable"}
                  </div>
                </div>
                <div style={miniScoreCardStyle(newsScore.tone)}>
                  <div style={miniScoreTitleStyle}>Confidence</div>
                  <div style={miniScoreNumberStyle}>{newsScore.confidence}</div>
                  <div style={miniScoreLabelStyle}>Headline depth</div>
                </div>
              </div>

              <div style={miniScoreGridStyle}>
                <div style={heroMetricStyle}>
                  <div style={heroMetricLabelStyle}>1 Month</div>
                  <div
                    style={{ ...heroMetricValueStyle, color: moveColour(performance?.month ?? null) }}
                  >
                    {formatPercent(performance?.month ?? null)}
                  </div>
                </div>
                <div style={heroMetricStyle}>
                  <div style={heroMetricLabelStyle}>Year To Date</div>
                  <div
                    style={{ ...heroMetricValueStyle, color: moveColour(performance?.ytd ?? null) }}
                  >
                    {formatPercent(performance?.ytd ?? null)}
                  </div>
                </div>
              </div>

              <div style={coverageNoteStyle}>
                Constituent-weighted across the {constituents.length} largest {sector.name.toLowerCase()}{" "}
                names we track — not an index print.
              </div>
            </div>
          </section>

          <section className="newsGrid">
            <div className="newsMainColumn" style={{ display: "grid", gap: 18 }}>
              <SectorFeed sector={sector.name} data={data} />

              <section style={editorialCardStyle}>
                <div style={sectionEyebrowStyle}>Putting it together</div>
                <h2 style={sectionTitleStyle}>What this means for {sector.name.toLowerCase()}</h2>
                <div style={{ display: "grid", gap: 12, marginTop: 6 }}>
                  {sectorRead.map((paragraph) => (
                    <p key={paragraph.slice(0, 40)} style={bodyCopyStyle}>
                      {paragraph}
                    </p>
                  ))}
                </div>
                <div style={sourceFooterStyle}>
                  Context only, not advice. Figures are drawn from cached market data and can lag
                  live prices by a few minutes.
                </div>
              </section>
            </div>

            <aside className="newsSidebar" style={{ display: "grid", gap: 18, position: "sticky", top: 18 }}>
              <section style={sidebarCardStyle}>
                <div style={sectionEyebrowStyle}>Why the score looks like this</div>
                <h2 style={sectionTitleSmallStyle}>News Score Breakdown</h2>
                <p style={bodyCopyStyle}>{newsScore.reason}</p>
                <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                  <div style={signalBoxStyle("green")}>
                    <div style={signalBoxTitleStyle}>Positive drivers</div>
                    {newsScore.positives.length ? (
                      newsScore.positives.map((item) => (
                        <div key={item} style={signalBoxItemStyle}>
                          {item}
                        </div>
                      ))
                    ) : (
                      <div style={signalBoxEmptyStyle}>
                        No strong positive driver stood out across the sector&apos;s higher-value
                        headlines.
                      </div>
                    )}
                  </div>
                  <div style={signalBoxStyle("red")}>
                    <div style={signalBoxTitleStyle}>Negative drivers</div>
                    {newsScore.negatives.length ? (
                      newsScore.negatives.map((item) => (
                        <div key={item} style={signalBoxItemStyle}>
                          {item}
                        </div>
                      ))
                    ) : (
                      <div style={signalBoxEmptyStyle}>
                        No strong negative driver stood out across the sector&apos;s higher-value
                        headlines.
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <MostMentionedCard mentions={mentions} sectorName={sector.name} />
              <SectorEarningsCard entries={earnings} sectorName={sector.name} label={earningsScore.label} />
              <SectorMoversCard movers={movers} sectorName={sector.name} />
              <SectorBreadthCard breadth={breadth} sectorName={sector.name} />
            </aside>
          </section>

          <section className="newsBottomStrip" style={bottomStripStyle}>
            <div>
              <div style={bottomStripTitleStyle}>Go deeper on {sector.name.toLowerCase()}</div>
              <div style={bottomStripTextStyle}>
                Screen this sector against the full universe, compare it with the other ten, or move
                to Platforms when you are ready to place a trade.
              </div>
            </div>
            <div className="newsBottomActions" style={bottomStripActionsStyle}>
              <Link href={screenerHref} style={bottomActionStyle("blue")}>
                Screen {sector.shortName}
              </Link>
              <Link href="/sector" style={bottomActionStyle("green")}>
                All Sector News
              </Link>
              <Link href="/platforms" style={bottomActionStyle("red")}>
                TRADE THIS SECTOR
              </Link>
            </div>
          </section>

          <HideWatermarksBar />
        </div>

        <style>{`
          .newsWrap { max-width: 1240px; margin: 0 auto; padding: 24px 40px 42px; }
          .newsGrid { display: grid; grid-template-columns: minmax(0, 1.22fr) minmax(320px, 0.78fr); gap: 22px; margin-top: 22px; align-items: start; }
          .newsHeroShell { display: grid; grid-template-columns: minmax(0, 1.24fr) minmax(280px, 0.76fr); gap: 18px; }
          .newsHeroTitle { margin: 14px 0 0 0; max-width: 760px; word-break: break-word; }
          .newsHeroLead { margin: 14px 0 0 0; max-width: 780px; }
          .newsHeroCtaRow { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 18px; }
          .newsBottomStrip { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: center; }
          .sectorPillRow { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
          @media (max-width: 1180px) { .newsWrap { padding: 22px 24px 38px; } .newsHeroShell { grid-template-columns: 1fr !important; } .newsGrid { grid-template-columns: 1fr !important; } .newsSidebar { position: static !important; top: auto !important; } }
          @media (max-width: 820px) { .newsWrap { padding: 18px 16px 32px; } .newsHeroTitle { font-size: 34px !important; line-height: 1.06 !important; letter-spacing: -0.045em !important; } .newsHeroLead { font-size: 15px !important; line-height: 1.7 !important; } .newsHeroCtaRow { flex-direction: column !important; align-items: stretch !important; } .newsHeroBtn { width: 100%; justify-content: center !important; } .newsBottomStrip { flex-direction: column !important; align-items: stretch !important; } .newsBottomActions { width: 100%; } }
          @media (max-width: 560px) { .newsWrap { padding: 14px 12px 26px; } .newsHeroShell { grid-template-columns: 1fr !important; border-radius: 22px !important; padding: 16px !important; } .newsHeroTitle { font-size: 28px !important; line-height: 1.08 !important; letter-spacing: -0.035em !important; } .newsHeroLead { font-size: 14px !important; line-height: 1.65 !important; } .compactNewsRow .compactNewsHeadline { order: 5; flex: 1 1 100% !important; width: 100% !important; margin-top: 8px !important; } .newsBottomActions { display: grid !important; grid-template-columns: 1fr !important; width: 100%; } .newsBottomActions a { width: 100%; justify-content: center !important; } .newsMainColumn, .newsSidebar { min-width: 0; } .newsSidebar section, .newsMainColumn section, .compactNewsRow, .newsHeroRight > div { min-width: 0; } }
        `}</style>
      </main>
    </WatermarkVisibilityProvider>
  );
}

// --- sub-components ---------------------------------------------------------

/**
 * The sector equivalent of StockNewsTickerJump on the per-stock page. That one
 * is a client-side autocomplete because there are thousands of tickers; there
 * are eleven sectors, so this is a plain server-rendered link row -- no client
 * JS, and eleven crawlable internal links in the initial HTML.
 */
function SectorPillRow({ currentSlug }: { currentSlug: string }) {
  return (
    <div className="sectorPillRow">
      {SECTORS.map((entry) => {
        const active = entry.slug === currentSlug;
        return (
          <Link
            key={entry.slug}
            href={sectorNewsPath(entry.slug)}
            style={active ? sectorPillActiveStyle : sectorPillStyle}
            aria-current={active ? "page" : undefined}
          >
            {entry.shortName}
          </Link>
        );
      })}
    </div>
  );
}

function SectorFeed({ sector, data }: { sector: string; data: SectorNewsBaseData }) {
  const { detailedNews, compactNews, newsScore, constituents } = data;
  const sectorDef = getSectorBySlug(data.slug);

  return (
    <section style={editorialCardStyle}>
      <div style={sectionEyebrowStyle}>Latest briefing</div>
      <h2 style={sectionTitleStyle}>What&apos;s happening in {sector.toLowerCase()}</h2>

      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        {detailedNews.length ? (
          detailedNews.map((item, index) => {
            const symbol = primarySymbol(item, constituents);

            return (
              <article
                key={`${item.link}-${index}`}
                style={{
                  ...newsLeadCardStyle,
                  borderLeft:
                    index === 0
                      ? "3px solid rgba(59,130,246,0.75)"
                      : "3px solid rgba(255,255,255,0.08)",
                }}
              >
                {item.image ? (
                  <div style={newsThumbWrapStyle}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.image} alt="" loading="lazy" style={newsThumbImgStyle} />
                  </div>
                ) : null}

                <div style={newsMetaRowStyle}>
                  <span style={newsSourcePillStyle}>{compactSource(item.source)}</span>
                  <span style={newsDateStyle}>{formatDate(item.pubDate)}</span>
                  {symbol ? (
                    <Link href={`/stock/${encodeURIComponent(symbol)}/news`} style={tickerPillStyle}>
                      {symbol}
                    </Link>
                  ) : null}
                </div>

                <h3 style={newsHeadlineStyle}>{stripAnyHtml(item.title)}</h3>
                <p style={newsSummaryStyle}>{snippet(item, sector)}</p>

                {/* The per-article AI read is reused unchanged: each article IS
                    about a company, so the existing symbol-shaped endpoint gets
                    the constituent's ticker rather than a sector string. */}
                {symbol ? (
                  <WhyThisMatters
                    symbol={symbol}
                    companyName={symbol}
                    trend={`${sector} sector`}
                    newsScoreLabel={newsScore.label}
                    item={{
                      title: item.title,
                      link: item.link,
                      source: item.source,
                      pubDate: item.pubDate,
                      description: item.description,
                    }}
                    fallbackText={buildSectorWhyItMatters({
                      sector: sectorDef ?? SECTORS[0],
                      symbol,
                      title: item.title,
                      tone: newsScore.tone,
                    })}
                  />
                ) : (
                  <p style={whyStaticStyle}>
                    {buildSectorWhyItMatters({
                      sector: sectorDef ?? SECTORS[0],
                      symbol: null,
                      title: item.title,
                      tone: newsScore.tone,
                    })}
                  </p>
                )}

                <div
                  style={{
                    ...sourceFooterStyle,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    Article excerpt provided by the FMP news feed. AI is used only for the optional
                    &quot;Why this matters&quot; read.
                  </span>
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={readArticleLinkStyle}
                  >
                    Read full article ↗
                  </a>
                </div>
              </article>
            );
          })
        ) : (
          <div style={newsLeadCardStyle}>
            <h3 style={{ ...newsHeadlineStyle, marginTop: 0 }}>No fresh headline set available</h3>
            <p style={newsSummaryStyle}>
              The news feed across the largest {sector.toLowerCase()} names is light right now. The
              score, breadth and calendar panels below still apply.
            </p>
          </div>
        )}
      </div>

      {compactNews.length ? (
        <div style={{ marginTop: 16 }}>
          <div style={compactFeedLabelStyle}>More across the sector</div>
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {compactNews.map((item, index) => {
              const symbol = primarySymbol(item, constituents);
              return (
                <article
                  key={`${item.link}-compact-${index}`}
                  className="compactNewsRow"
                  style={compactNewsRowStyle}
                >
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt="" loading="lazy" style={compactThumbStyle} />
                  ) : null}
                  <div style={{ minWidth: 88, flexShrink: 0 }}>
                    <div style={compactSourceStyle}>{symbol ?? compactSource(item.source)}</div>
                    <div style={compactDateStyle}>{formatDate(item.pubDate)}</div>
                  </div>
                  <div className="compactNewsHeadline" style={{ minWidth: 0, flex: 1 }}>
                    <div style={compactHeadlineStyle}>{stripAnyHtml(item.title)}</div>
                  </div>
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={compactMutedLinkStyle}
                  >
                    Read ↗
                  </a>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function MostMentionedCard({
  mentions,
  sectorName,
}: {
  mentions: Array<{ symbol: string; count: number }>;
  sectorName: string;
}) {
  return (
    <section style={sidebarCardStyle}>
      <div style={sectionEyebrowStyle}>Who is driving the coverage</div>
      <h2 style={sectionTitleSmallStyle}>Most-Mentioned Stocks</h2>

      {mentions.length ? (
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {mentions.map((entry) => (
            <Link
              key={entry.symbol}
              href={`/stock/${encodeURIComponent(entry.symbol)}/news`}
              style={listRowStyle}
            >
              <span style={listRowSymbolStyle}>{entry.symbol}</span>
              <span style={listRowValueStyle}>
                {entry.count} {entry.count === 1 ? "story" : "stories"}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p style={bodyCopyStyle}>
          No single {sectorName.toLowerCase()} name is dominating the current news flow.
        </p>
      )}
    </section>
  );
}

function SectorEarningsCard({
  entries,
  sectorName,
  label,
}: {
  entries: SectorEarningsEntry[];
  sectorName: string;
  label: string;
}) {
  return (
    <section style={sidebarCardStyle}>
      <div style={sectionEyebrowStyle}>Next seven days</div>
      <h2 style={sectionTitleSmallStyle}>Earnings This Week</h2>
      <p style={bodyCopyStyle}>Current earnings tone across the sector reads {label.toLowerCase()}.</p>

      {entries.length ? (
        <>
          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {entries.slice(0, 6).map((entry) => (
              <Link
                key={entry.symbol}
                href={`/stock/${encodeURIComponent(entry.symbol)}/earnings`}
                style={listRowStyle}
              >
                <span style={listRowSymbolStyle}>{entry.symbol}</span>
                <span style={listRowValueStyle}>{formatDate(entry.date)}</span>
              </Link>
            ))}
          </div>
          <div style={sourceFooterStyle}>
            Notable {sectorName.toLowerCase()} names we track — not a complete calendar.{" "}
            <Link href="/earnings-calendar" style={inlineLinkStyle}>
              Full earnings calendar
            </Link>
          </div>
        </>
      ) : (
        <p style={bodyCopyStyle}>
          None of the {sectorName.toLowerCase()} names we track are scheduled to report in the next
          seven days.
        </p>
      )}
    </section>
  );
}

function SectorMoversCard({ movers, sectorName }: { movers: SectorMovers; sectorName: string }) {
  const hasRows = movers.gainers.length > 0 || movers.losers.length > 0;

  return (
    <section style={sidebarCardStyle}>
      <div style={sectionEyebrowStyle}>Inside the sector today</div>
      <h2 style={sectionTitleSmallStyle}>Top Movers</h2>

      {hasRows ? (
        <>
          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {movers.gainers.map((row) => (
              <Link
                key={`up-${row.symbol}`}
                href={`/stock/${encodeURIComponent(row.symbol)}`}
                style={listRowStyle}
              >
                <span style={listRowSymbolStyle}>{row.symbol}</span>
                <span style={{ ...listRowValueStyle, color: "#86efac" }}>
                  {formatPercent(row.changePct)} · {formatMoney(row.price)}
                </span>
              </Link>
            ))}
            {movers.losers.map((row) => (
              <Link
                key={`down-${row.symbol}`}
                href={`/stock/${encodeURIComponent(row.symbol)}`}
                style={listRowStyle}
              >
                <span style={listRowSymbolStyle}>{row.symbol}</span>
                <span style={{ ...listRowValueStyle, color: "#fca5a5" }}>
                  {formatPercent(row.changePct)} · {formatMoney(row.price)}
                </span>
              </Link>
            ))}
          </div>
          <div style={sourceFooterStyle}>
            From {movers.sampled} {sectorName.toLowerCase()} names with a recent quote. Prices can
            lag the live market by a few minutes.
          </div>
        </>
      ) : (
        <p style={bodyCopyStyle}>
          No recent intraday quotes are available for this sector right now — this panel fills in
          during market hours.
        </p>
      )}
    </section>
  );
}

function SectorBreadthCard({
  breadth,
  sectorName,
}: {
  breadth: SectorBreadth | null;
  sectorName: string;
}) {
  if (!breadth || breadth.sampled < 5) return null;

  const pct50 = Math.round((breadth.above50 / breadth.sampled) * 100);
  const pct200 = Math.round((breadth.above200 / breadth.sampled) * 100);

  return (
    <section style={sidebarCardStyle}>
      <div style={sectionEyebrowStyle}>How broad the move is</div>
      <h2 style={sectionTitleSmallStyle}>Sector Breadth</h2>

      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        <BreadthBar label="Above 50-day MA" pct={pct50} />
        <BreadthBar label="Above 200-day MA" pct={pct200} />
      </div>

      <div style={sourceFooterStyle}>
        Measured across the {breadth.sampled} largest {sectorName.toLowerCase()} names with enough
        cached price history.
      </div>
    </section>
  );
}

function BreadthBar({ label, pct }: { label: string; pct: number }) {
  const colour = pct >= 60 ? "#22c55e" : pct <= 35 ? "#ef4444" : "#eab308";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={breadthLabelStyle}>{label}</span>
        <span style={{ ...breadthValueStyle, color: colour }}>{pct}%</span>
      </div>
      <div style={breadthTrackStyle}>
        <div
          style={{
            width: `${Math.max(0, Math.min(100, pct))}%`,
            height: "100%",
            borderRadius: 999,
            background: colour,
            opacity: 0.85,
          }}
        />
      </div>
    </div>
  );
}

function performanceTone(day: number | null | undefined): "green" | "yellow" | "red" {
  if (typeof day !== "number" || !Number.isFinite(day)) return "yellow";
  if (day > 0.15) return "green";
  if (day < -0.15) return "red";
  return "yellow";
}

// --- styles (mirrors app/stock/[symbol]/news/page.tsx) -----------------------

const heroShellStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1.24fr) minmax(280px, 0.76fr)", gap: 18, border: "1px solid rgba(255,255,255,0.09)", borderRadius: 28, padding: 22, background: "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(6,9,15,0.98))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 54px rgba(0,0,0,0.36)" };
const heroLeftStyle: CSSProperties = { minWidth: 0 };
const heroTopBarStyle: CSSProperties = { gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" };
const heroRightStyle: CSSProperties = { display: "grid", gap: 14, alignContent: "start" };
const newsDeskTagStyle: CSSProperties = { display: "inline-flex", alignItems: "center", padding: "8px 12px", borderRadius: 999, border: "1px solid rgba(59,130,246,0.28)", background: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.08))", color: "#dbeafe", fontSize: 12, fontWeight: 950, letterSpacing: "0.08em", textTransform: "uppercase" };
const heroTitleStyle: CSSProperties = { margin: "14px 0 0 0", fontSize: 44, lineHeight: 1.02, letterSpacing: "-0.055em", maxWidth: 760 };
const heroLeadStyle: CSSProperties = { margin: "14px 0 0 0", maxWidth: 780, fontSize: 16, lineHeight: 1.75, color: "rgba(241,245,249,0.82)" };
const heroBlurbStyle: CSSProperties = { margin: "10px 0 0 0", maxWidth: 780, fontSize: 14, lineHeight: 1.7, color: "rgba(241,245,249,0.62)" };
const headlineTakeStyle: CSSProperties = { marginTop: 18, padding: "14px 16px", borderRadius: 14, border: "1px solid rgba(59,130,246,0.25)", background: "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(8,18,30,0.92))", fontSize: 14, lineHeight: 1.6, color: "#e5e7eb", maxWidth: 620 };
const heroMetricStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 14, background: "rgba(255,255,255,0.03)" };
const heroMetricLabelStyle: CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(191,219,254,0.86)" };
const heroMetricValueStyle: CSSProperties = { marginTop: 8, fontSize: 24, lineHeight: 1.08, fontWeight: 950, letterSpacing: "-0.04em", color: "#f8fafc" };
const heroCtaRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 };
const heroPrimaryCtaStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 46, padding: "12px 16px", borderRadius: 14, border: "1px solid rgba(59,130,246,0.34)", background: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))", color: "#dbeafe", textDecoration: "none", fontWeight: 900, fontSize: 13, letterSpacing: "0.04em" };
const heroSecondaryCtaStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 46, padding: "12px 16px", borderRadius: 14, border: "1px solid rgba(34,197,94,0.30)", background: "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(21,128,61,0.08))", color: "#dcfce7", textDecoration: "none", fontWeight: 900, fontSize: 13, letterSpacing: "0.04em" };
const heroSubCopyStyle: CSSProperties = { marginTop: 10, fontSize: 13, lineHeight: 1.6, color: "rgba(241,245,249,0.62)" };
const coverageNoteStyle: CSSProperties = { fontSize: 12, lineHeight: 1.55, color: "rgba(241,245,249,0.5)" };

const sectorPillStyle: CSSProperties = { display: "inline-flex", alignItems: "center", padding: "8px 12px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", color: "rgba(241,245,249,0.82)", textDecoration: "none", fontSize: 12, fontWeight: 800 };
const sectorPillActiveStyle: CSSProperties = { ...sectorPillStyle, border: "1px solid rgba(59,130,246,0.40)", background: "rgba(59,130,246,0.16)", color: "#dbeafe" };
const tickerPillStyle: CSSProperties = { display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: 999, background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.24)", color: "#bbf7d0", fontSize: 12, fontWeight: 900, textDecoration: "none" };

const miniScoreGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 };
function miniScoreCardStyle(tone: "green" | "yellow" | "red"): CSSProperties { return { border: tone === "green" ? "1px solid rgba(34,197,94,0.22)" : tone === "red" ? "1px solid rgba(248,113,113,0.20)" : "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 14, background: "rgba(255,255,255,0.03)" }; }
const miniScoreTitleStyle: CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(241,245,249,0.66)" };
const miniScoreNumberStyle: CSSProperties = { marginTop: 8, fontSize: 24, lineHeight: 1.05, fontWeight: 950, letterSpacing: "-0.04em" };
const miniScoreLabelStyle: CSSProperties = { marginTop: 6, fontSize: 13, color: "rgba(241,245,249,0.76)" };

const editorialCardStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24, padding: 20, background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.025))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" };
const sidebarCardStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20, padding: 18, background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" };
const sectionEyebrowStyle: CSSProperties = { fontSize: 11, fontWeight: 950, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(147,197,253,0.82)" };
const sectionTitleStyle: CSSProperties = { margin: "8px 0 0 0", fontSize: 28, lineHeight: 1.08, letterSpacing: "-0.04em" };
const sectionTitleSmallStyle: CSSProperties = { margin: "8px 0 0 0", fontSize: 22, lineHeight: 1.12, letterSpacing: "-0.03em" };
const bodyCopyStyle: CSSProperties = { margin: "14px 0 0 0", fontSize: 15, lineHeight: 1.72, color: "rgba(241,245,249,0.82)" };
const newsLeadCardStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 16, background: "rgba(255,255,255,0.028)" };
const newsThumbWrapStyle: CSSProperties = { width: "100%", aspectRatio: "16 / 9", borderRadius: 12, overflow: "hidden", marginBottom: 12, background: "rgba(255,255,255,0.04)" };
const newsThumbImgStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover", display: "block" };
const newsMetaRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
const newsSourcePillStyle: CSSProperties = { display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: 999, background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.22)", color: "#dbeafe", fontSize: 12, fontWeight: 800 };
const newsDateStyle: CSSProperties = { fontSize: 12, fontWeight: 700, color: "rgba(241,245,249,0.58)" };
const newsHeadlineStyle: CSSProperties = { margin: "12px 0 0 0", fontSize: 22, lineHeight: 1.32, letterSpacing: "-0.02em", color: "#f8fafc" };
const newsSummaryStyle: CSSProperties = { margin: "10px 0 0 0", fontSize: 15, lineHeight: 1.72, color: "rgba(241,245,249,0.82)" };
const whyStaticStyle: CSSProperties = { margin: "12px 0 0 0", padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", fontSize: 14, lineHeight: 1.65, color: "rgba(241,245,249,0.78)" };
const sourceFooterStyle: CSSProperties = { marginTop: 12, fontSize: 12, lineHeight: 1.5, color: "rgba(241,245,249,0.48)" };
const compactFeedLabelStyle: CSSProperties = { fontSize: 12, fontWeight: 850, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(241,245,249,0.56)" };
const compactNewsRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 12, background: "rgba(255,255,255,0.02)" };
const compactThumbStyle: CSSProperties = { width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0, background: "rgba(255,255,255,0.04)" };
const compactSourceStyle: CSSProperties = { fontSize: 12, fontWeight: 800, color: "#dbeafe" };
const compactDateStyle: CSSProperties = { marginTop: 4, fontSize: 11, color: "rgba(241,245,249,0.56)" };
const compactHeadlineStyle: CSSProperties = { fontSize: 14, lineHeight: 1.55, color: "rgba(241,245,249,0.84)" };
const compactMutedLinkStyle: CSSProperties = { fontSize: 12, color: "#93c5fd", textAlign: "right", textDecoration: "none", fontWeight: 900, whiteSpace: "nowrap", flexShrink: 0, marginLeft: "auto" };
const readArticleLinkStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "8px 10px", borderRadius: 999, border: "1px solid rgba(59,130,246,0.30)", background: "rgba(59,130,246,0.10)", color: "#bfdbfe", textDecoration: "none", fontWeight: 900, fontSize: 12, whiteSpace: "nowrap" };
const inlineLinkStyle: CSSProperties = { color: "#93c5fd", textDecoration: "none", fontWeight: 800 };

const listRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "10px 12px", background: "rgba(255,255,255,0.025)", color: "#f1f5f9", textDecoration: "none" };
const listRowSymbolStyle: CSSProperties = { fontSize: 14, fontWeight: 950, letterSpacing: "-0.01em" };
const listRowValueStyle: CSSProperties = { fontSize: 13, fontWeight: 800, color: "rgba(241,245,249,0.72)" };

const breadthLabelStyle: CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", color: "rgba(241,245,249,0.72)" };
const breadthValueStyle: CSSProperties = { fontSize: 14, fontWeight: 950 };
const breadthTrackStyle: CSSProperties = { marginTop: 8, height: 8, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" };

function signalBoxStyle(tone: "green" | "red"): CSSProperties { return { border: tone === "green" ? "1px solid rgba(34,197,94,0.22)" : "1px solid rgba(248,113,113,0.20)", borderRadius: 14, padding: 12, background: tone === "green" ? "rgba(34,197,94,0.06)" : "rgba(248,113,113,0.05)" }; }
const signalBoxTitleStyle: CSSProperties = { fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(241,245,249,0.8)" };
const signalBoxItemStyle: CSSProperties = { marginTop: 8, fontSize: 13, lineHeight: 1.55, color: "rgba(241,245,249,0.78)" };
const signalBoxEmptyStyle: CSSProperties = { marginTop: 8, fontSize: 13, lineHeight: 1.55, color: "rgba(241,245,249,0.58)" };

const bottomStripStyle: CSSProperties = { marginTop: 22, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 22, padding: 18, background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02))", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" };
const bottomStripTitleStyle: CSSProperties = { fontSize: 22, lineHeight: 1.1, fontWeight: 900, letterSpacing: "-0.03em" };
const bottomStripTextStyle: CSSProperties = { marginTop: 8, maxWidth: 760, fontSize: 14, lineHeight: 1.65, color: "rgba(241,245,249,0.76)" };
const bottomStripActionsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 10 };
function bottomActionStyle(tone: "blue" | "green" | "red"): CSSProperties {
  const base: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, padding: "11px 15px", borderRadius: 999, textDecoration: "none", fontSize: 13, fontWeight: 850, lineHeight: 1, whiteSpace: "nowrap" };
  if (tone === "blue") return { ...base, border: "1px solid rgba(59,130,246,0.24)", background: "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(37,99,235,0.08))", color: "#dbeafe" };
  if (tone === "green") return { ...base, border: "1px solid rgba(34,197,94,0.22)", background: "linear-gradient(135deg, rgba(34,197,94,0.14), rgba(21,128,61,0.08))", color: "#dcfce7" };
  return { ...base, border: "1px solid rgba(248,113,113,0.22)", background: "linear-gradient(135deg, rgba(248,113,113,0.14), rgba(185,28,28,0.08))", color: "#fee2e2" };
}
