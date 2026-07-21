"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CompanyLogo from "@/app/components/CompanyLogo";
import type { BottleneckPost } from "@/lib/bottlenecks";

const VISIBLE_ROWS = 12;
const ROW_GAP = 8;

type SortMode = "date" | "title";

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
  // Defaults to newest-first, matching the server-side sort in
  // app/bottlenecks/page.tsx so there's no visible re-order between the
  // SSR paint and this component taking over on hydration.
  const [sortMode, setSortMode] = useState<SortMode>("date");
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

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortMode === "title") {
      arr.sort((a, b) => a.companyName.localeCompare(b.companyName));
    } else {
      arr.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return dateB - dateA;
      });
    }
    return arr;
  }, [filtered, sortMode]);

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
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            opacity: 0.55,
            fontWeight: 800,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
          }}
        >
          Built so far
          {query
            ? ` — ${sorted.length} match${sorted.length === 1 ? "" : "es"}`
            : ""}
        </div>

        <div
          role="group"
          aria-label="Sort order"
          style={{
            display: "inline-flex",
            gap: 4,
            padding: 4,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 999,
          }}
        >
          <button
            type="button"
            onClick={() => setSortMode("date")}
            aria-pressed={sortMode === "date"}
            style={{
              cursor: "pointer",
              border: "none",
              borderRadius: 999,
              padding: "6px 14px",
              fontSize: 12.5,
              fontWeight: 800,
              letterSpacing: 0.2,
              background:
                sortMode === "date" ? "rgba(147, 197, 253, 0.16)" : "transparent",
              color: sortMode === "date" ? "#93c5fd" : "#8a97ad",
              boxShadow:
                sortMode === "date" ? "0 0 12px rgba(147, 197, 253, 0.3)" : "none",
              transition: "all 0.18s ease",
            }}
          >
            Latest
          </button>
          <button
            type="button"
            onClick={() => setSortMode("title")}
            aria-pressed={sortMode === "title"}
            style={{
              cursor: "pointer",
              border: "none",
              borderRadius: 999,
              padding: "6px 14px",
              fontSize: 12.5,
              fontWeight: 800,
              letterSpacing: 0.2,
              background:
                sortMode === "title" ? "rgba(95, 212, 199, 0.16)" : "transparent",
              color: sortMode === "title" ? "#5FD4C7" : "#8a97ad",
              boxShadow:
                sortMode === "title" ? "0 0 12px rgba(95, 212, 199, 0.3)" : "none",
              transition: "all 0.18s ease",
            }}
          >
            A–Z
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div
          style={{
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.03)",
            padding: "20px 16px",
            textAlign: "center",
          }}
        >
          {posts.length === 0 ? (
            <div style={{ opacity: 0.7 }}>No bottleneck pages yet.</div>
          ) : (
            <>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "#93c5fd",
                }}
              >
                Coming soon
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 14,
                  lineHeight: 1.5,
                  opacity: 0.7,
                }}
              >
                We haven&apos;t mapped &ldquo;{query}&rdquo; yet.
              </div>
            </>
          )}
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
          {sorted.map((post, index) => (
            <Link
              key={post.slug}
              ref={index === 0 ? firstItemRef : undefined}
              href={`/bottlenecks/${post.slug}`}
              prefetch={false}
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

      <div
        style={{
          marginTop: 12,
          fontSize: 12,
          opacity: 0.5,
          lineHeight: 1.5,
        }}
      >
        Not all stocks have been mapped yet — more are added daily.
      </div>

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
