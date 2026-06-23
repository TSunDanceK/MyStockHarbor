import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getYouTubeVideoById } from "@/lib/youtube";
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

function fmtPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function fmtPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { videoId } = await params;
  const video = await getYouTubeVideoById(videoId);

  if (!video) {
    return {
      title: "Video | MyStockHarbor",
      description: "Stock market video analysis from MyStockHarbor.",
    };
  }

  const title = `${video.title} | MyStockHarbor`;
  const description = `Watch and read the full analysis: ${video.title}`;
  const url = `https://www.mystockharbor.com/insights/videos/${videoId}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "MyStockHarbor",
      images: video.thumbnailUrl ? [{ url: video.thumbnailUrl, width: 1280, height: 720, alt: video.title }] : [],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: video.thumbnailUrl ? [video.thumbnailUrl] : [],
    },
  };
}

export default async function VideoPage({ params }: Props) {
  const { videoId } = await params;

  const [video, videoContent] = await Promise.all([
    getYouTubeVideoById(videoId),
    Promise.resolve(getVideoContent(videoId)),
  ]);

  if (!video) notFound();

  const ticker = videoContent?.ticker ?? null;

  const [stockData, contentHtml] = await Promise.all([
    ticker ? getVideoStockData(ticker) : Promise.resolve(null),
    videoContent?.content
      ? remark().use(html).process(videoContent.content).then((r) => r.toString())
      : Promise.resolve(null),
  ]);

  // vq=hd720 is a hint to YouTube to prefer 720p — not guaranteed but helps on faster connections
  const embedUrl = `${video.embedUrl}?vq=hd720&rel=0`;

  const videoJsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    description: `Stock market analysis: ${video.title}`,
    thumbnailUrl: video.thumbnailUrl,
    uploadDate: video.publishedAt,
    url: video.url,
    embedUrl: video.embedUrl,
    publisher: {
      "@type": "Organization",
      name: "MyStockHarbor",
      url: "https://www.mystockharbor.com",
    },
  };

  const statItems = stockData
    ? [
        { label: "Price", value: fmtPrice(stockData.price) },
        { label: "Market cap", value: stockData.marketCap ?? "—" },
        { label: "vs MA50", value: fmtPct(stockData.ma50Pct) },
        { label: "vs MA200", value: fmtPct(stockData.ma200Pct) },
        ...(stockData.peRatio ? [{ label: "P/E (TTM)", value: stockData.peRatio.toFixed(1) }] : []),
        ...(stockData.trend ? [{ label: "Trend", value: stockData.trend }] : []),
      ]
    : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(videoJsonLd) }}
      />

      <main
        style={{
          minHeight: "100vh",
          background: "#06080d",
          color: "#f1f5f9",
          fontFamily: "system-ui, Arial",
        }}
      >
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 20px 60px" }}>

          {/* Breadcrumb */}
          <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 20 }}>
            <Link href="/insights" style={{ color: "inherit", textDecoration: "none" }}>Insights</Link>
            <span style={{ margin: "0 8px" }}>›</span>
            <span>Video</span>
          </div>

          {/* Ticker + sector + date chips */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            {ticker && (
              <span style={{
                display: "inline-flex", alignItems: "center",
                padding: "5px 12px", borderRadius: 999,
                background: "rgba(59,130,246,0.16)",
                border: "1px solid rgba(59,130,246,0.28)",
                fontSize: 13, fontWeight: 900, color: "#dbeafe",
              }}>
                {ticker}
              </span>
            )}
            {stockData?.sector && (
              <span style={{
                padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#94a3b8",
              }}>
                {stockData.sector}
              </span>
            )}
            <span style={{ fontSize: 13, opacity: 0.6 }}>{formatDate(video.publishedAt)}</span>
          </div>

          {/* Title */}
          <h1 style={{ margin: "0 0 6px", fontSize: 30, fontWeight: 900, lineHeight: 1.2, letterSpacing: "-0.3px" }}>
            {video.title}
          </h1>

          {stockData?.companyName && (
            <p style={{ margin: "0 0 20px", opacity: 0.7, fontSize: 15 }}>
              {stockData.companyName}
            </p>
          )}

          {/* ── STATS STRIP — above the embed so visitors see key numbers immediately ── */}
          {statItems && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: 10,
              marginBottom: 20,
            }}>
              {statItems.map(({ label, value }) => (
                <div
                  key={label}
                  style={{
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.04)",
                    padding: "12px 16px",
                  }}
                >
                  <div style={{ fontSize: 11, opacity: 0.6, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-0.2px" }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Live data note — only when we have stock data */}
          {stockData && (
            <p style={{ fontSize: 12, opacity: 0.4, marginBottom: 20, fontStyle: "italic" }}>
              Price and market cap update live — figures will differ from those in the video.
            </p>
          )}

          {/* ── YOUTUBE EMBED ── */}
          <div style={{
            position: "relative", width: "100%", paddingTop: "56.25%",
            borderRadius: 16, overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.10)",
            background: "#000", marginBottom: 12,
          }}>
            <iframe
              src={embedUrl}
              title={video.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
            />
          </div>

          {/* Watch on YouTube link */}
          <div style={{ marginBottom: 32, textAlign: "right" }}>
            <a
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, color: "#fca5a5", textDecoration: "none", fontWeight: 700, opacity: 0.85 }}
            >
              Watch on YouTube ↗
            </a>
          </div>

          {/* ── WRITTEN ANALYSIS ── */}
          {contentHtml ? (
            <article
              style={{
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.04)",
                padding: "24px 28px",
                marginBottom: 28,
                lineHeight: 1.75,
                fontSize: 15,
              }}
            >
              <div
                dangerouslySetInnerHTML={{ __html: contentHtml }}
                style={{ color: "#e2e8f0" }}
              />
            </article>
          ) : (
            <div style={{
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.025)",
              padding: "20px 24px",
              marginBottom: 28,
              opacity: 0.6,
              fontSize: 14,
              lineHeight: 1.6,
            }}>
              Written analysis coming soon — watch the video above for the full breakdown.
            </div>
          )}

          {/* ── DATASHEET ── */}
          {videoContent?.datasheetImage ? (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 11, opacity: 0.55, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                Investor datasheet
              </div>
              <img
                src={videoContent.datasheetImage}
                alt={`${ticker ?? ""} investor datasheet`}
                style={{ width: "100%", borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)" }}
              />
            </div>
          ) : (
            <div style={{
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.02)",
              padding: "14px 18px",
              marginBottom: 28,
              opacity: 0.5,
              fontSize: 13,
            }}>
              Investor datasheet — coming soon
            </div>
          )}

          {/* ── DISCLAIMER ── */}
          <div style={{
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.07)",
            background: "rgba(255,255,255,0.02)",
            padding: "14px 18px",
            fontSize: 12,
            opacity: 0.5,
            lineHeight: 1.6,
            marginBottom: 28,
          }}>
            This page is for educational purposes only and does not constitute financial advice.
            Always do your own research before making any investment decisions.
          </div>

          {/* Back link */}
          <Link
            href="/insights"
            style={{
              display: "inline-flex", alignItems: "center",
              padding: "10px 16px", borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.05)",
              color: "#f1f5f9", textDecoration: "none",
              fontSize: 13, fontWeight: 700,
            }}
          >
            ← Back to Insights
          </Link>
        </div>
      </main>
    </>
  );
}
