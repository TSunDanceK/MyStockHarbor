"use client";

import Link from "next/link";
import { useState } from "react";
import type { YouTubeVideo } from "@/lib/youtube";

const PAGE_SIZE = 5;

function formatDateShort(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type Props = {
  videos: YouTubeVideo[];
  contentHtml: string | null;
};

export default function VideoPageClient({ videos, contentHtml }: Props) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const [articleExpanded, setArticleExpanded] = useState(false);

  const visibleVideos = videos.slice(0, shown);
  const hasMore = shown < videos.length;

  return (
    <>
      {/* ── MOBILE: collapsible article ── */}
      {contentHtml && (
        <div className="mobileArticle">
          <div
            className={`mobileArticleInner ${articleExpanded ? "expanded" : ""}`}
          >
            <article className="video-article">
              <div dangerouslySetInnerHTML={{ __html: contentHtml }} />
            </article>
          </div>
          {!articleExpanded && (
            <div style={{
              position: "relative", marginTop: -48,
              background: "linear-gradient(to bottom, transparent, #06080d)",
              height: 60, pointerEvents: "none",
            }} />
          )}
          <button
            onClick={() => setArticleExpanded(!articleExpanded)}
            style={{
              display: "block", width: "100%", marginTop: 8,
              padding: "10px 0", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: "#93c5fd", fontSize: 14, fontWeight: 700,
              cursor: "pointer", fontFamily: "system-ui, Arial",
            }}
          >
            {articleExpanded ? "Show less ↑" : "Read full analysis ↓"}
          </button>
        </div>
      )}

      {/* ── MOBILE: more videos with show more ── */}
      <div className="mobileVideos">
        <div style={{ fontSize: 11, opacity: 0.55, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 12, color: "#fecaca" }}>More videos</div>
        <div style={{ display: "grid", gap: 8 }}>
          {visibleVideos.map((v) => (
            <Link key={v.id} href={`/insights/videos/${v.id}`} prefetch={false} style={{ display: "block", textDecoration: "none", color: "#f1f5f9", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)" }}>
              <div style={{ width: "100%", aspectRatio: "16 / 9", overflow: "hidden", background: "#0b1220" }}>
                {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt={v.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : null}
              </div>
              <div style={{ padding: "8px 10px 10px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{v.title}</div>
                <div style={{ marginTop: 4, fontSize: 11, opacity: 0.5 }}>{formatDateShort(v.publishedAt)}</div>
              </div>
            </Link>
          ))}
        </div>
        {hasMore && (
          <button
            onClick={() => setShown((s) => s + PAGE_SIZE)}
            style={{
              marginTop: 10, display: "block", width: "100%",
              padding: "10px 0", borderRadius: 10,
              border: "1px solid rgba(239,68,68,0.35)",
              background: "rgba(239,68,68,0.08)",
              color: "#fecaca", fontSize: 13, fontWeight: 800,
              cursor: "pointer", fontFamily: "system-ui, Arial",
            }}
          >
            Show more videos ↓
          </button>
        )}
        <a href="https://www.youtube.com/@MyStockHarbor" target="_blank" rel="noopener noreferrer" style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.25)", background: "transparent", color: "#fecaca", textDecoration: "none", fontWeight: 800, fontSize: 12, opacity: 0.7 }}>Visit YouTube Channel ↗</a>
      </div>

      <style>{`
        .mobileArticle { display: none; }
        .mobileVideos { display: none; }
        .mobileArticleInner { max-height: 320px; overflow: hidden; transition: max-height 0.3s ease; }
        .mobileArticleInner.expanded { max-height: none; }
        @media (max-width: 960px) {
          .mobileArticle { display: block; margin-bottom: 20px; }
          .mobileVideos { display: block; margin-bottom: 24px; }
        }
      `}</style>
    </>
  );
}
