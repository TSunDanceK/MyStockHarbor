import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getYouTubeVideoById, getLatestYouTubeVideos } from "@/lib/youtube";
import { getVideoContent } from "@/lib/videoContent";
import { getVideoStockData } from "@/lib/videoStockData";
import { remark } from "remark";
import html from "remark-html";
import VideoPageClient from "./VideoPageClient";
import PageShareBar from "@/app/components/PageShareBar";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ videoId: string }>;
};

function formatDate(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function formatDateShort(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "\u2014";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function fmtPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "\u2014";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { videoId } = await params;

  const [video, videoContent] = await Promise.all([
    getYouTubeVideoById(videoId),
    Promise.resolve(getVideoContent(videoId)),
  ]);

  if (!video) {
    return {
      title: "Video | MyStockHarbor",
      description: "Stock market video analysis from MyStockHarbor.",
    };
  }

  const ticker = videoContent?.ticker ?? null;

  const title = ticker
    ? `${ticker} \u2014 ${video.title} | MyStockHarbor`
    : `${video.title} | MyStockHarbor`;

  const description = ticker
    ? `${ticker} stock analysis: ${video.title}. Watch the full breakdown on MyStockHarbor.`
    : `Watch and read the full analysis: ${video.title}`;

  const url = `https://www.mystockharbor.com/insights/videos/${videoId}`;

  const ogImage = video.thumbnailUrl
    ? { url: video.thumbnailUrl, width: 1280, height: 720, alt: video.title }
    : { url: "https://www.mystockharbor.com/og-image-v2.png", width: 1200, height: 630, alt: "MyStockHarbor" };

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "MyStockHarbor",
      images: [ogImage],
      type: "article",
      locale: "en_GB",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage.url],
    },
  };
}

export default async function VideoPage({ params }: Props) {
  const { videoId } = await params;

  const [video, videoContent, allVideos] = await Promise.all([
    getYouTubeVideoById(videoId),
    Promise.resolve(getVideoContent(videoId)),
    getLatestYouTubeVideos(20),
  ]);

  if (!video) notFound();

  const relatedVideos = allVideos.filter((v) => v.id !== videoId);
  const ticker = videoContent?.ticker ?? null;

  const [stockData, contentHtml] = await Promise.all([
    ticker ? getVideoStockData(ticker) : Promise.resolve(null),
    videoContent?.content
      ? remark().use(html).process(videoContent.content).then((r) => r.toString())
      : Promise.resolve(null),
  ]);

  const embedUrl = `${video.embedUrl}?vq=hd720&rel=0`;

  const videoJsonLd = {
    "@context": "https://schema.org", "@type": "VideoObject",
    name: video.title, description: `Stock market analysis: ${video.title}`,
    thumbnailUrl: video.thumbnailUrl, uploadDate: video.publishedAt,
    url: video.url, embedUrl: video.embedUrl,
    publisher: { "@type": "Organization", name: "MyStockHarbor", url: "https://www.mystockharbor.com" },
  };

  const statItems = stockData ? [
    { label: "Price", value: fmtPrice(stockData.price) },
    { label: "Market cap", value: stockData.marketCap ?? "\u2014" },
    { label: "vs MA50", value: fmtPct(stockData.ma50Pct) },
    { label: "vs MA200", value: fmtPct(stockData.ma200Pct) },
    ...(stockData.peRatio ? [{ label: "P/E (TTM)", value: stockData.peRatio.toFixed(1) }] : []),
    ...(stockData.trend ? [{ label: "Trend", value: stockData.trend }] : []),
  ] : null;

  const CARD_H = 260;
  const MAX_VISIBLE = 6;

  const pageUrl = `https://www.mystockharbor.com/insights/videos/${videoId}`;
  const shareText = ticker
    ? `${ticker} stock analysis: ${video.title} \uD83D\uDCCA MyStockHarbor`
    : `${video.title} \uD83D\uDCCA MyStockHarbor`;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(videoJsonLd) }} />

      <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 20px 60px" }}>

          {/* Breadcrumb + share */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, opacity: 0.6 }}>
              <Link href="/insights" style={{ color: "inherit", textDecoration: "none" }}>Insights</Link>
              <span style={{ margin: "0 8px" }}>›</span>
              <span>Video</span>
            </div>
            <PageShareBar
              url={pageUrl}
              title={ticker ? `${ticker} \u2014 ${video.title} | MyStockHarbor` : `${video.title} | MyStockHarbor`}
              text={shareText}
              align="right"
            />
          </div>

          {/* Header + stats */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              {ticker && <span style={{ display: "inline-flex", alignItems: "center", padding: "5px 12px", borderRadius: 999, background: "rgba(59,130,246,0.16)", border: "1px solid rgba(59,130,246,0.28)", fontSize: 13, fontWeight: 900, color: "#dbeafe" }}>{ticker}</span>}
              {stockData?.sector && <span style={{ padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#94a3b8" }}>{stockData.sector}</span>}
              <span style={{ fontSize: 13, opacity: 0.6 }}>{formatDate(video.publishedAt)}</span>
            </div>
            <h1 style={{ margin: "0 0 6px", fontSize: 28, fontWeight: 900, lineHeight: 1.2, letterSpacing: "-0.3px" }}>{video.title}</h1>
            {stockData?.companyName && <p style={{ margin: "0 0 14px", opacity: 0.7, fontSize: 15 }}>{stockData.companyName}</p>}
            {statItems && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: 10 }}>
                {statItems.map(({ label, value }) => (
                  <div key={label} style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)", padding: "10px 14px" }}>
                    <div style={{ fontSize: 10, opacity: 0.6, fontWeight: 700, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
                    <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.2px" }}>{value}</div>
                  </div>
                ))}
              </div>
            )}
            {stockData && <p style={{ fontSize: 11, opacity: 0.38, marginBottom: 0, fontStyle: "italic" }}>Price and market cap update live &mdash; figures will differ from those in the video.</p>}
          </div>

          {/* ── MOBILE ── */}
          <div className="mobileOnly">
            <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)", background: "#000", marginBottom: 10 }}>
              <iframe src={embedUrl} title={video.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
            </div>
            <div style={{ marginBottom: 18, textAlign: "right" }}>
              <a href={video.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#fca5a5", textDecoration: "none", fontWeight: 700, opacity: 0.85 }}>Watch on YouTube ↗</a>
            </div>
            <VideoPageClient videos={relatedVideos} contentHtml={contentHtml} />
            {videoContent?.datasheetImage && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, opacity: 0.55, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Investor datasheet</div>
                <img src={videoContent.datasheetImage} alt={`${ticker ?? ""} investor datasheet`} style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)" }} />
              </div>
            )}
            <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", padding: "12px 16px", fontSize: 13, opacity: 0.5, lineHeight: 1.6, marginBottom: 16 }}>
              This page is for educational purposes only and does not constitute financial advice. Always do your own research before making any investment decisions.
            </div>
            <Link href="/insights" style={{ display: "inline-flex", alignItems: "center", padding: "10px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "#f1f5f9", textDecoration: "none", fontSize: 13, fontWeight: 700 }}>← Back to Insights</Link>
          </div>

          {/* ── DESKTOP ── */}
          <div className="desktopOnly videoPageLayout" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 28, alignItems: "start" }}>
            <div>
              <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)", background: "#000", marginBottom: 10 }}>
                <iframe src={embedUrl} title={video.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
              </div>
              <div style={{ marginBottom: 28, textAlign: "right" }}>
                <a href={video.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#fca5a5", textDecoration: "none", fontWeight: 700, opacity: 0.85 }}>Watch on YouTube ↗</a>
              </div>
              {contentHtml ? (
                <article className="video-article" style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)", padding: "28px 30px", marginBottom: 24 }}>
                  <div dangerouslySetInnerHTML={{ __html: contentHtml }} />
                </article>
              ) : (
                <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.025)", padding: "18px 22px", marginBottom: 24, opacity: 0.6, fontSize: 18, lineHeight: 1.8 }}>Written analysis coming soon &mdash; watch the video above for the full breakdown.</div>
              )}
              {videoContent?.datasheetImage && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 11, opacity: 0.55, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Investor datasheet</div>
                  <img src={videoContent.datasheetImage} alt={`${ticker ?? ""} investor datasheet`} style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)" }} />
                </div>
              )}
              <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", padding: "12px 16px", fontSize: 13, opacity: 0.5, lineHeight: 1.6, marginBottom: 24 }}>
                This page is for educational purposes only and does not constitute financial advice. Always do your own research before making any investment decisions.
              </div>
              <Link href="/insights" style={{ display: "inline-flex", alignItems: "center", padding: "10px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "#f1f5f9", textDecoration: "none", fontSize: 13, fontWeight: 700 }}>← Back to Insights</Link>
            </div>

            <aside style={{ position: "sticky", top: 24 }}>
              <div style={{ fontSize: 11, opacity: 0.55, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 12 }}>More videos</div>
              <div style={{ maxHeight: `${MAX_VISIBLE * CARD_H}px`, overflowY: "auto", display: "grid", gap: 8, scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.15) transparent", touchAction: "pan-y" }}>
                {relatedVideos.length === 0 ? (
                  <div style={{ fontSize: 13, opacity: 0.5, lineHeight: 1.6 }}>No other videos available.</div>
                ) : (
                  relatedVideos.map((v) => (
                    <Link key={v.id} href={`/insights/videos/${v.id}`} style={{ display: "block", textDecoration: "none", color: "#f1f5f9", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)" }}>
                      <div style={{ width: "100%", aspectRatio: "16 / 9", overflow: "hidden", background: "#0b1220" }}>
                        {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt={v.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : null}
                      </div>
                      <div style={{ padding: "8px 10px 10px" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{v.title}</div>
                        <div style={{ marginTop: 4, fontSize: 11, opacity: 0.5 }}>{formatDateShort(v.publishedAt)}</div>
                      </div>
                    </Link>
                  ))
                )}
              </div>
              <a href="https://www.youtube.com/@MyStockHarbor" target="_blank" rel="noopener noreferrer" style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)", color: "#fecaca", textDecoration: "none", fontWeight: 800, fontSize: 12 }}>Visit YouTube Channel ↗</a>
            </aside>
          </div>

          {/* Continue exploring — server-rendered internal links for crawlability.
              Stock-specific videos (ticker present in the .md frontmatter) point at
              that stock's own pages; generic / multi-stock videos (no ticker) point
              at the site's evergreen hub pages instead. */}
          <section style={{ marginTop: 36, border: "1px solid rgba(255,255,255,0.10)", borderRadius: 18, padding: 20, background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02))" }}>
            <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-0.02em" }}>Continue exploring</div>
            <div style={{ marginTop: 6, marginBottom: 14, fontSize: 14, lineHeight: 1.6, opacity: 0.72 }}>
              {ticker
                ? `Dig deeper into ${ticker} with the full stock page, the latest earnings breakdown and recent news.`
                : "Keep researching with supply-chain bottlenecks, the latest market headlines and upcoming earnings dates."}
            </div>
            <div className="videoExploreActions" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {ticker ? (
                <>
                  <Link href={`/stock/${encodeURIComponent(ticker)}`} style={exploreLinkStyle("blue")}>
                    {ticker} stock page →
                  </Link>
                  <Link href={`/stock/${encodeURIComponent(ticker)}/earnings`} style={exploreLinkStyle("gold")}>
                    {ticker} earnings →
                  </Link>
                  <Link href={`/stock/${encodeURIComponent(ticker)}/news`} style={exploreLinkStyle("green")}>
                    {ticker} news →
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/bottlenecks" style={exploreLinkStyle("blue")}>
                    Bottlenecks →
                  </Link>
                  <Link href="/headlines" style={exploreLinkStyle("green")}>
                    Market headlines →
                  </Link>
                  <Link href="/earnings-calendar" style={exploreLinkStyle("gold")}>
                    Earnings calendar →
                  </Link>
                </>
              )}
            </div>
          </section>
        </div>

        <style>{`
          .mobileOnly { display: none; }
          .desktopOnly { display: grid; }
          .video-article { font-size: 18px; line-height: 1.8; color: #cbd5e1; }
          .video-article h2 { font-size: 24px; font-weight: 800; color: #f1f5f9; margin: 36px 0 14px; letter-spacing: -0.3px; line-height: 1.25; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.08); }
          .video-article h2:first-child { margin-top: 0; }
          .video-article p { margin: 0 0 20px; line-height: 1.85; }
          .video-article p:last-child { margin-bottom: 0; }
          .video-article ul { margin: 0 0 20px; padding: 0; list-style: none; }
          .video-article ul li { position: relative; padding: 12px 0 12px 24px; line-height: 1.75; border-bottom: 1px solid rgba(255,255,255,0.05); }
          .video-article ul li:last-child { border-bottom: none; padding-bottom: 0; }
          .video-article ul li::before { content: ''; position: absolute; left: 0; top: 22px; width: 7px; height: 7px; border-radius: 50%; background: rgba(59,130,246,0.8); }
          .video-article strong { font-weight: 800; color: #f1f5f9; }
          @media (max-width: 960px) {
            .mobileOnly { display: block; }
            .desktopOnly { display: none !important; }
          }
          @media (max-width: 640px) {
            .videoExploreActions { display: grid !important; grid-template-columns: 1fr !important; gap: 10px !important; }
          }
        `}</style>
      </main>
    </>
  );
}

function exploreLinkStyle(tint: "blue" | "green" | "gold"): CSSProperties {
  const map = {
    blue: {
      border: "rgba(59,130,246,0.34)",
      background: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
      color: "#dbeafe",
    },
    green: {
      border: "rgba(34,197,94,0.30)",
      background: "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(21,128,61,0.08))",
      color: "#dcfce7",
    },
    gold: {
      border: "rgba(250,204,21,0.30)",
      background: "linear-gradient(135deg, rgba(250,204,21,0.16), rgba(202,138,4,0.08))",
      color: "#fef3c7",
    },
  };
  const t = map[tint];
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
    padding: "10px 16px",
    borderRadius: 12,
    border: `1px solid ${t.border}`,
    background: t.background,
    color: t.color,
    textDecoration: "none",
    fontWeight: 900,
    fontSize: 13,
    whiteSpace: "nowrap",
  };
}
