"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CompanyLogo from "@/app/components/CompanyLogo";
import type { BottleneckPost } from "@/lib/bottlenecks";

const VISIBLE_ROWS = 12;
const ROW_GAP = 8;

function formatUpdatedDate(value: string) {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const clampLine: React.CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 1,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

export default function BottleneckList({ posts }: { posts: BottleneckPost[] }) {
  const [query, setQuery] = useState("");
  const [rowHeight, setRowHeight] = useState<number | null>(null);
  const firstItemRef = useRef<HTMLAnchorElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter(
      (post) =>
        post.companyName.toLowerCase().includes(q) ||
        post.symbol.toLowerCase().includes(q)
    );
  }, [posts, query]);

  useEffect(() => {
    const measure = () => {
      if (firstItemRef.current) {
        setRowHeight(firstItemRef.current.getBoundingClientRect().height);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [posts.length]);

  const maxHeight = rowHeight
    ? rowHeight * VISIBLE_ROWS + ROW_GAP * (VISIBLE_ROWS - 1)
    : undefined;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by company name or ticker..."
          aria-label="Search bottleneck stock pages by company name or ticker"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.04)",
            color: "#f1f5f9",
            // 16px (not 15px) so mobile Safari doesn't auto-zoom the page
            // in when this input is focused.
            fontSize: 16,
            outline: "none",
          }}
        />
      </div>

      <div
        style={{
          fontSize: 11,
          opacity: 0.55,
          fontWeight: 800,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        Built so far
        {query
          ? ` — ${filtered.length} match${filtered.length === 1 ? "" : "es"}`
          : ""}
      </div>

      {filtered.length === 0 ? (
        <div
          style={{
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.03)",
            padding: 16,
            opacity: 0.7,
          }}
        >
          {posts.length === 0
            ? "No bottleneck pages yet."
            : `No stocks match "${query}".`}
        </div>
      ) : (
        <div
          className="bottleneckListScroll"
          style={{
            display: "grid",
            gap: ROW_GAP,
            maxHeight,
            overflowY: "auto",
            paddingRight: 4,
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(255,255,255,0.15) transparent",
          }}
        >
          {filtered.map((post, index) => (
            <Link
              key={post.slug}
              ref={index === 0 ? firstItemRef : undefined}
              href={`/bottlenecks/${post.slug}`}
              className="bottleneckListRow"
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
              <CompanyLogo domain={post.domain} name={post.companyName} />

              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  className="bottleneckListRowName"
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    lineHeight: 1.35,
                    ...clampLine,
                  }}
                >
                  {post.companyName}{" "}
                  <span style={{ color: "#93c5fd" }}>({post.symbol})</span>
                </div>
                {post.category && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 14,
                      opacity: 0.6,
                      lineHeight: 1.4,
                      ...clampLine,
                    }}
                  >
                    {post.category}
                  </div>
                )}
                {post.date && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      opacity: 0.45,
                      ...clampLine,
                    }}
                  >
                    Updated {formatUpdatedDate(post.date)}
                  </div>
                )}
              </div>

              <div style={{ flexShrink: 0, fontSize: 20, opacity: 0.3 }}>
                &rsaquo;
              </div>
            </Link>
          ))}
        </div>
      )}

      <style>{`
        @media (max-width: 480px) {
          .bottleneckListRow {
            padding: 12px 14px !important;
            gap: 12px !important;
          }
          .bottleneckListRowName {
            font-size: 16px !important;
          }
        }
      `}</style>
    </>
  );
}
