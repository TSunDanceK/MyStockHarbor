import Link from "next/link";
import type { CSSProperties } from "react";
import type { BlogPost } from "@/lib/blog";

// -- More Insights ------------------------------------------------------------
// Server-rendered, presentational-only internal-linking module (no hooks) —
// same pattern as app/components/RelatedStocks.tsx — so it renders into the
// crawlable initial HTML.
//
// Why this exists: a July 2026 Google Search Console audit found only 18 of
// 58 /insights/[slug] posts are indexed by Google. Individual insight posts
// had exactly ONE inbound internal link each — their listing on the
// paginated /insights archive (PAGE_SIZE = 20, so 3 pages for 58 posts) —
// and no cross-linking between posts (unlike
// app/insights/videos/[videoId]/page.tsx, which already links related
// videos to each other). This module gives every post page a small, stable,
// always-present set of links to OTHER post pages so Google (and readers)
// have more than one path to each post. See lib/blog.ts (getRelatedPosts)
// for the deterministic selection logic behind the `posts` prop.

type RelatedInsightPost = Pick<BlogPost, "slug" | "title" | "date" | "symbol">;

function formatDate(value: string): string {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function RelatedInsights({ posts }: { posts: RelatedInsightPost[] }) {
  if (posts.length === 0) return null;

  return (
    <section style={outerStyle}>
      <div style={wrapStyle}>
        <div style={eyebrowStyle}>More Insights</div>
        <h2 style={headingStyle}>Keep reading</h2>
        <p style={descStyle}>
          More technical analysis and market insight posts from MyStockHarbor.
        </p>
        <div style={gridStyle}>
          {posts.map((post) => (
            <Link key={post.slug} href={`/insights/${post.slug}`} style={cardStyle}>
              <div style={cardTitleStyle}>{post.title}</div>
              <div style={cardMetaStyle}>
                {post.symbol ? `${post.symbol} · ` : ""}
                {formatDate(post.date)}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// Renders as a top-level sibling of InsightPostClient's <main> (see
// app/insights/[slug]/page.tsx), so it carries its own page background +
// width container rather than relying on ambient page layout — same
// convention as RelatedStocks.tsx's `.stock-wrap` (max-width: 1240px,
// centered, 20px side padding).
const outerStyle: CSSProperties = {
  background: "#06080d",
  color: "#f1f5f9",
  fontFamily: "system-ui, Arial",
  borderTop: "1px solid rgba(255,255,255,0.08)",
};
const wrapStyle: CSSProperties = {
  maxWidth: 1240,
  margin: "0 auto",
  padding: "24px 20px 40px",
  boxSizing: "border-box",
};
const eyebrowStyle: CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(147,197,253,0.82)", marginBottom: 6 };
const headingStyle: CSSProperties = { margin: 0, fontSize: 22, lineHeight: 1.12, letterSpacing: "-0.03em", fontWeight: 700 };
const descStyle: CSSProperties = { margin: "8px 0 0", fontSize: 14, lineHeight: 1.6, color: "rgba(241,245,249,0.72)" };
const gridStyle: CSSProperties = {
  marginTop: 14,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: 10,
};
const cardStyle: CSSProperties = {
  display: "block",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  color: "#e2e8f0",
  textDecoration: "none",
};
const cardTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  lineHeight: 1.35,
  letterSpacing: "-0.01em",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};
const cardMetaStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  fontWeight: 700,
  color: "rgba(241,245,249,0.55)",
};
