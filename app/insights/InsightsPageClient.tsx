"use client";

import Link from "next/link";
import { useState } from "react";
import type { BlogPost } from "@/lib/blog";
import type { YouTubeVideo } from "@/lib/youtube";
import type { VideoMeta } from "@/lib/videoContent";
import ShareButton from "@/app/components/ShareButton";

const YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@MyStockHarbor";

function formatVideoDate(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type Props = {
  posts: BlogPost[];
  videos: YouTubeVideo[];
  videoMeta: VideoMeta[];
};

function PostCard({ post }: { post: BlogPost }) {
  return (
    <Link
      href={`/insights/${post.slug}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "15px 18px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        textDecoration: "none",
        color: "#f1f5f9",
      }}
    >
      {/* Ticker col */}
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 58 }}>
        {post.symbol ? (
          <div style={{ fontSize: 16, fontWeight: 900, color: "#93c5fd", letterSpacing: "0.04em", lineHeight: 1 }}>
            {post.symbol}
          </div>
        ) : null}
        <div style={{ width: 32, height: 2, background: "rgba(59,130,246,0.45)", borderRadius: 2 }} />
        <div style={{ fontSize: 11, opacity: 0.45, fontWeight: 600, whiteSpace: "nowrap" }}>
          {post.date}
        </div>
      </div>

      {/* Content col */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1.35,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>
          {post.title}
        </div>
        {post.excerpt && (
          <div style={{
            marginTop: 5,
            fontSize: 14,
            opacity: 0.55,
            lineHeight: 1.45,
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}>
            {post.excerpt}
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, fontSize: 20, opacity: 0.3 }}>›</div>
    </Link>
  );
}

function VideoCard({ video }: { video: YouTubeVideo }) {
  return (
    <Link
      href={`/insights/videos/${video.id}`}
      style={{
        display: "block",
        textDecoration: "none",
        color: "#f1f5f9",
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(255,255,255,0.025)",
      }}
    >
      <div style={{ width: "100%", aspectRatio: "16 / 9", overflow: "hidden", background: "#0b1220" }}>
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : null}
      </div>
      <div style={{ padding: "9px 12px 11px" }}>
        <div style={{
          fontSize: 14,
          fontWeight: 700,
          lineHeight: 1.35,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>
          {video.title}
        </div>
        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.5 }}>{formatVideoDate(video.publishedAt)}</div>
      </div>
    </Link>
  );
}

// Static card — rendered from content/videos/*.md, no YouTube API needed.
// These links are in the SSR HTML so Googlebot can discover and index the
// video pages without depending on client-side JS or the YouTube API.
function StaticVideoCard({ meta }: { meta: VideoMeta }) {
  return (
    <Link
      href={`/insights/videos/${meta.youtubeId}`}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "14px 16px",
        borderRadius: 12,
        border: "1px solid rgba(239,68,68,0.12)",
        background: "rgba(239,68,68,0.04)",
        textDecoration: "none",
        color: "#f1f5f9",
      }}
    >
      {/* Play icon */}
      <div style={{
        flexShrink: 0,
        width: 36,
        height: 36,
        borderRadius: "50%",
        background: "rgba(239,68,68,0.18)",
        border: "1px solid rgba(239,68,68,0.30)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginTop: 2,
      }}>
        <span style={{ fontSize: 14, marginLeft: 2 }}>▶</span>
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        {/* Ticker + stat badge row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
          {meta.ticker && (
            <span style={{
              fontSize: 12,
              fontWeight: 900,
              color: "#fca5a5",
              background: "rgba(239,68,68,0.15)",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: 6,
              padding: "2px 8px",
              letterSpacing: "0.04em",
            }}>
              {meta.ticker}
            </span>
          )}
          {meta.label && meta.value && (
            <span style={{ fontSize: 12, opacity: 0.6, fontWeight: 600 }}>
              {meta.label}: <span style={{ color: "#f1f5f9", fontWeight: 800 }}>{meta.value}</span>
            </span>
          )}
        </div>

        {/* Excerpt */}
        {meta.excerpt && (
          <div style={{
            fontSize: 13,
            opacity: 0.65,
            lineHeight: 1.5,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}>
            {meta.excerpt}
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, fontSize: 18, opacity: 0.25, alignSelf: "center" }}>›</div>
    </Link>
  );
}

export default function InsightsPageClient({ posts, videos, videoMeta }: Props) {
  const [mobileTab, setMobileTab] = useState<"insights" | "videos">("insights");

  const pageUrl = "https://www.mystockharbor.com/insights";
  const shareText = "Daily stock market insights, chart setups & technical analysis on MyStockHarbor 📊";

  return (
    <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 20px 40px" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>DAILY STOCK BLOG</div>
            <h1 style={{ margin: "8px 0 0", fontSize: 34, letterSpacing: "-0.4px" }}>Stock Market Insights & Trade Ideas</h1>
          </div>
          <div style={{ paddingTop: 20 }}>
            <ShareButton
              url={pageUrl}
              title="MyStockHarbor Insights"
              text={shareText}
            />
          </div>
        </div>

        <p style={{ marginTop: 10, maxWidth: 760, opacity: 0.8, lineHeight: 1.6 }}>
          Daily stock market observations, chart-based trade ideas, and simple technical analysis write-ups focused on price structure, trend, support, resistance, and setups worth watching.
        </p>

        {/* Market hub banner */}
        <section style={{ marginTop: 18, borderRadius: 18, border: "1px solid rgba(59,130,246,0.22)", background: "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(34,197,94,0.06))", padding: 18 }}>
          <div style={{ fontSize: 12, opacity: 0.78, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase" }}>Market hub</div>
          <div style={{ marginTop: 8, fontSize: 24, fontWeight: 900, lineHeight: 1.2, letterSpacing: "-0.03em" }}>Looking for the bigger market picture?</div>
          <p style={{ margin: "10px 0 0", maxWidth: 820, lineHeight: 1.7, opacity: 0.84, fontSize: 15 }}>
            Read the S&amp;P 500 market page for a simple breakdown of SPX trend, key levels, RSI, MACD, and how to analyse market pullbacks without panicking.
          </p>
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/markets/spx" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(59,130,246,0.45)", background: "linear-gradient(135deg, rgba(59,130,246,0.22), rgba(37,99,235,0.12))", color: "#eff6ff", textDecoration: "none", fontWeight: 900, fontSize: 13, whiteSpace: "nowrap", boxShadow: "0 6px 16px rgba(0,0,0,0.25)" }}>Read S&amp;P 500 Analysis →</Link>
            <Link href="/pickers" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(34,197,94,0.45)", background: "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.12))", color: "#ecfdf5", textDecoration: "none", fontWeight: 900, fontSize: 13, whiteSpace: "nowrap", boxShadow: "0 6px 16px rgba(0,0,0,0.25)" }}>Explore Live Stock Setups →</Link>
          </div>
        </section>

        {/* ── STATIC VIDEO ANALYSIS SECTION ─────────────────────────────────────
            Rendered from content/videos/*.md — no YouTube API.
            These <Link> elements are in the SSR HTML, so Googlebot can
            discover and crawl every video page from this anchor point.
        ──────────────────────────────────────────────────────────────────────── */}
        {videoMeta.length > 0 && (
          <section style={{ marginTop: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 11, opacity: 0.55, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "#fca5a5" }}>
                  Video analysis
                </div>
                <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800, letterSpacing: "-0.2px" }}>
                  Stock Breakdowns & Deep Dives
                </div>
              </div>
              <a
                href={YOUTUBE_CHANNEL_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: "#fca5a5", textDecoration: "none", fontWeight: 800, opacity: 0.8, whiteSpace: "nowrap" }}
              >
                YouTube Channel ↗
              </a>
            </div>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr" }}>
              {videoMeta.map((meta) => (
                <StaticVideoCard key={meta.youtubeId} meta={meta} />
              ))}
            </div>
          </section>
        )}

        {/* ── MOBILE: tab switcher ── */}
        <div className="mobileTabs" style={{ marginTop: 24, display: "none" }}>
          <div style={{ display: "flex", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)" }}>
            <button
              onClick={() => setMobileTab("insights")}
              style={{
                flex: 1, padding: "12px 0", border: "none", cursor: "pointer",
                fontSize: 14, fontWeight: 800, fontFamily: "system-ui, Arial", borderRadius: 0,
                background: mobileTab === "insights" ? "rgba(59,130,246,0.18)" : "transparent",
                color: mobileTab === "insights" ? "#93c5fd" : "rgba(241,245,249,0.55)",
                borderRight: "1px solid rgba(255,255,255,0.10)",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              Latest Insights
            </button>
            <button
              onClick={() => setMobileTab("videos")}
              style={{
                flex: 1, padding: "12px 0", border: "none", cursor: "pointer",
                fontSize: 14, fontWeight: 800, fontFamily: "system-ui, Arial", borderRadius: 0,
                background: mobileTab === "videos" ? "rgba(239,68,68,0.15)" : "transparent",
                color: mobileTab === "videos" ? "#fca5a5" : "rgba(241,245,249,0.55)",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              Watch Videos
            </button>
          </div>

          {mobileTab === "insights" && (
            <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
              {posts.length === 0 ? (
                <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", padding: 16, opacity: 0.7 }}>No insight posts yet.</div>
              ) : (
                posts.map((post) => <PostCard key={post.slug} post={post} />)
              )}
            </div>
          )}

          {mobileTab === "videos" && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "grid", gap: 8 }}>
                {videos.length === 0 ? (
                  <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", padding: 14, opacity: 0.7 }}>Videos could not be loaded.</div>
                ) : (
                  videos.map((video) => <VideoCard key={video.id} video={video} />)
                )}
              </div>
              <a href={YOUTUBE_CHANNEL_URL} target="_blank" rel="noopener noreferrer" style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: "11px 14px", borderRadius: 12, border: "1px solid rgba(239,68,68,0.40)", background: "linear-gradient(135deg, rgba(239,68,68,0.18), rgba(127,29,29,0.10))", color: "#fee2e2", textDecoration: "none", fontWeight: 900, fontSize: 13 }}>Visit YouTube Channel ↗</a>
            </div>
          )}
        </div>

        {/* ── DESKTOP: two-column layout ── */}
        <section className="desktopLayout" style={{ marginTop: 24, display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(300px, 1fr)", gap: 22, alignItems: "start" }}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.55, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 12 }}>Latest insights</div>
            {posts.length === 0 ? (
              <div style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", padding: 16, opacity: 0.7 }}>No insight posts yet.</div>
            ) : (
              <div style={{ maxHeight: "80vh", overflowY: "auto", display: "grid", gap: 8, scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.15) transparent", touchAction: "pan-y" }}>
                {posts.map((post) => <PostCard key={post.slug} post={post} />)}
              </div>
            )}
          </div>

          <aside className="desktopVideos" style={{ position: "sticky", top: 24 }}>
            <div style={{ fontSize: 11, opacity: 0.55, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 12, color: "#fecaca" }}>Watch on YouTube</div>
            <div style={{ maxHeight: "80vh", overflowY: "auto", display: "grid", gap: 8, scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.15) transparent", touchAction: "pan-y" }}>
              {videos.length === 0 ? (
                <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", padding: 14, opacity: 0.7, lineHeight: 1.6 }}>Videos could not be loaded.</div>
              ) : (
                videos.map((video) => <VideoCard key={video.id} video={video} />)
              )}
            </div>
            <a href={YOUTUBE_CHANNEL_URL} target="_blank" rel="noopener noreferrer" style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)", color: "#fecaca", textDecoration: "none", fontWeight: 800, fontSize: 12 }}>Visit YouTube Channel ↗</a>
          </aside>
        </section>
      </div>

      <style>{`
        @media (max-width: 980px) {
          .mobileTabs { display: block !important; }
          .desktopLayout { display: none !important; }
        }
        @media (min-width: 981px) {
          .mobileTabs { display: none !important; }
          .desktopVideos { position: sticky; top: 24px; }
        }
      `}</style>
    </main>
  );
}
