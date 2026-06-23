import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getYouTubeVideoById, getLatestYouTubeVideos } from "@/lib/youtube";
import { getVideoContent } from "@/lib/videoContent";
import { getVideoStockData } from "@/lib/videoStockData";
import { remark } from "remark";
import html from "remark-html";

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
  const video = await getYouTubeVideoById(videoId);
  if (!video) return { title: "Video | MyStockHarbor", description: "Stock market video analysis from MyStockHarbor." };
  const title = `${video.title} | MyStockHarbor`;
  const description = `Watch and read the full analysis: ${video.title}`;
  const url = `https://www.mystockharbor.com/insights/videos/${videoId}`;
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: "MyStockHarbor", images: video.thumbnailUrl ? [{ url: video.thumbnailUrl, width: 1280, height: 720, alt: video.title }] : [], type: "article" },
    twitter: { card: "summary_large_image", title, description, images: video.thumbnailUrl ? [video.thumbnailUrl] : [] },
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

  // 6 visible cards: each card = (360px wide * 9/16 aspect) + title row ~50px + gap 8px ≈ 260px
  const CARD_H = 260;
  const MAX_VISIBLE = 6;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(videoJsonLd) }} />

      <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 20px 60px" }}>

          {/* Breadcrumb */}
          <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 20 }}>
            <Link href="/insights" style={{ color: "inherit", textDecoration: "none" }}>Insights</Link>
            <span style={{ margin: "0 8px" }}>\u203a</span>
            <span>Video</span>
          </div>

          <div className="videoPageLayout" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 28, alignItems: "start" }}>

            {/* LEFT: main content */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                {ticker && <span style={{ display: "inline-flex", alignItems: "center", padding: "5px 12px", borderRadius: 999, background: "rgba(59,130,246,0.16)", border: "1px solid rgba(59,130,246,0.28)", fontSize: 13, fontWeight: 900, color: "#dbeafe" }}>{ticker}</span>}
                {stockData?.sector && <span style={{ padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#94a3b8" }}>{stockData.sector}</span>}
                <span style={{ fontSize: 13, opacity: 0.6 }}>{formatDate(video.publishedAt)}</span>
              </div>

              <h1 style={{ margin: "0 0 6px", fontSize: 28, fontWeight: 900, lineHeight: 1.2, letterSpacing: "-0.3px" }}>{video.title}</h1>
              {stockData?.companyName && <p style={{ margin: "0 0 18px", opacity: 0.7, fontSize: 15 }}>{stockData.companyName}</p>}

              {statItems && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: 16 }}>
                  {statItems.map(({ label, value }) => (
                    <div key={label} style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)", padding: "10px 14px" }}>
                      <div style={{ fontSize: 10, opacity: 0.6, fontWeight: 700, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
                      <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.2px" }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}
              {stockData && <p style={{ fontSize: 11, opacity: 0.38, marginBottom: 16, fontStyle: "italic" }}>Price and market cap update live \u2014 figures will differ from those in the video.</p>}

              <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)", background: "#000", marginBottom: 10 }}>
                <iframe src={embedUrl} title={video.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
              </div>
              <div style={{ marginBottom: 28, textAlign: "right" }}>
                <a href={video.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#fca5a5", textDecoration: "none", fontWeight: 700, opacity: 0.85 }}>Watch on YouTube \u2197</a>
              </div>

              {contentHtml ? (
                <article style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)", padding: "22px 26px", marginBottom: 24, lineHeight: 1.75, fontSize: 15 }}>
                  <div dangerouslySetInnerHTML={{ __html: contentHtml }} style={{ color: "#e2e8f0" }} />
                </article>
              ) : (
                <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.025)", padding: "18px 22px", marginBottom: 24, opacity: 0.6, fontSize: 14, lineHeight: 1.6 }}>Written analysis coming soon \u2014 watch the video above for the full breakdown.</div>
              )}

              {videoContent?.datasheetImage ? (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 11, opacity: 0.55, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Investor datasheet</div>
                  <img src={videoContent.datasheetImage} alt={`${ticker ?? ""} investor datasheet`} style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)" }} />
                </div>
              ) : (
                <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", padding: "12px 16px", marginBottom: 24, opacity: 0.5, fontSize: 13 }}>Investor datasheet \u2014 coming soon</div>
              )}

              <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", padding: "12px 16px", fontSize: 12, opacity: 0.5, lineHeight: 1.6, marginBottom: 24 }}>
                This page is for educational purposes only and does not constitute financial advice. Always do your own research before making any investment decisions.
              </div>

              <Link href="/insights" style={{ display: "inline-flex", alignItems: "center", padding: "10px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "#f1f5f9", textDecoration: "none", fontSize: 13, fontWeight: 700 }}>\u2190 Back to Insights</Link>
            </div>

            {/* RIGHT: sticky sidebar — scroll-trapped inner list */}
            <aside className="videoSidebar" style={{ position: "sticky", top: 24 }}>
              <div style={{ fontSize: 11, opacity: 0.55, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 12 }}>More videos</div>

              {/* touch-action: pan-y tells mobile browsers this container scrolls vertically,
                  resolving the scroll-trap ambiguity on touch devices */}
              <div
                className="videoSidebarList"
                style={{
                  maxHeight: `${MAX_VISIBLE * CARD_H}px`,
                  overflowY: "auto",
                  display: "grid",
                  gap: 8,
                  scrollbarWidth: "thin",
                  scrollbarColor: "rgba(255,255,255,0.15) transparent",
                  touchAction: "pan-y",
                }}
              >
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

              <a href="https://www.youtube.com/@MyStockHarbor" target="_blank" rel="noopener noreferrer" style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)", color: "#fecaca", textDecoration: "none", fontWeight: 800, fontSize: 12 }}>Visit YouTube Channel \u2197</a>
            </aside>
          </div>
        </div>

        <style>{`
          /* Mobile: single column, sidebar below content, no scroll traps */
          @media (max-width: 960px) {
            .videoPageLayout { grid-template-columns: 1fr !important; }
            .videoSidebar { position: static !important; order: 1; }
            .videoSidebarList { max-height: none !important; overflow-y: visible !important; }
          }
        `}</style>
      </main>
    </>
  );
}
