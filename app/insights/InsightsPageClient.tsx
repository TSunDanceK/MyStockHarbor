"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { BlogPost, InsightSearchResult } from "@/lib/blog";
import type { YouTubeVideo } from "@/lib/youtube";
import ShareButton from "@/app/components/ShareButton";
import TickerLogo from "@/app/components/TickerLogo";

const YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@MyStockHarbor";
const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

function formatVideoDate(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type Props = {
  posts: BlogPost[];
  videos: YouTubeVideo[];
  page: number;
  totalPages: number;
  totalCount: number;
};

type ListPost = {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  symbol?: string | null;
};

function PostCard({ post }: { post: ListPost }) {
  return (
    <Link
      href={`/insights/${post.slug}`}
      className="postCard"
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
      <div className="postCardTicker" style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 58 }}>
        {post.symbol ? (
          <TickerLogo symbol={post.symbol} size={30} radius={8} />
        ) : null}
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

function PaginationNav({ page, totalPages }: { page: number; totalPages: number }) {
  if (totalPages <= 1) return null;

  const linkStyle = (disabled: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "9px 16px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: disabled ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.05)",
    color: disabled ? "rgba(241,245,249,0.35)" : "#f1f5f9",
    textDecoration: "none",
    fontWeight: 700,
    fontSize: 13,
    pointerEvents: disabled ? "none" : "auto",
  });

  return (
    <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      {page > 1 ? (
        <Link href={page - 1 === 1 ? "/insights" : `/insights?page=${page - 1}`} style={linkStyle(false)}>
          ← Newer
        </Link>
      ) : (
        <span style={linkStyle(true)}>← Newer</span>
      )}

      <span style={{ fontSize: 12, opacity: 0.55, fontWeight: 700, whiteSpace: "nowrap" }}>
        Page {page} of {totalPages}
      </span>

      {page < totalPages ? (
        <Link href={`/insights?page=${page + 1}`} style={linkStyle(false)}>
          Older →
        </Link>
      ) : (
        <span style={linkStyle(true)}>Older →</span>
      )}
    </div>
  );
}

// Inline SVGs rather than an icon-library import: there is no icon package in
// package.json, and adding one to ship three glyphs would put a dependency into
// a client bundle on a page that is already under crawl-budget pressure.
//
// They take a size because the two tab glyphs are drawn at 22px in the docked
// bottom bar and the magnifier at 17px inside the search field. One component
// per glyph rather than one per size keeps them from drifting apart.
//
// aria-hidden throughout -- each sits inside a control that carries its own
// text label, so announcing the icon would just repeat it.

/** Pen over paper: the written insight posts. */
function WrittenIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9" />
      <path d="M8 8h6" />
      <path d="M8 12h4" />
      <path d="M19.5 12.5 21 14l-5 5-2 .5.5-2Z" />
    </svg>
  );
}

/** YouTube's rounded-rectangle-and-play mark, drawn rather than imported. */
function VideoIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <rect x="2" y="5" width="20" height="14" rx="4" />
      <path d="M10.2 9.3v5.4l4.6-2.7Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Magnifier. */
function SearchIcon({ size = 17, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, ...style }}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    // Relative wrapper so the icon can sit inside the field. The input keeps
    // width: 100% + box-sizing: border-box, and the extra left padding makes
    // room for the glyph rather than letting the placeholder run under it.
    <div style={{ position: "relative", width: "100%" }}>
      <SearchIcon
        size={17}
        style={{
          position: "absolute",
          left: 15,
          top: "50%",
          transform: "translateY(-50%)",
          color: "rgba(241,245,249,0.42)",
          // Taps in the icon area still focus the input rather than dying on
          // the SVG.
          pointerEvents: "none",
        }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search all insights by ticker or title..."
        aria-label="Search all insight posts by ticker or title"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "12px 16px 12px 42px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(255,255,255,0.04)",
          color: "#f1f5f9",
          fontSize: 15,
          outline: "none",
        }}
      />
    </div>
  );
}

export default function InsightsPageClient({ posts, videos, page, totalPages, totalCount }: Props) {
  const [mobileTab, setMobileTab] = useState<"insights" | "videos">("insights");
  const [query, setQuery] = useState("");

  // Remember which mobile tab (Insights vs Videos) the visitor last had open,
  // so returning here via the browser Back button after opening a video
  // restores that tab instead of snapping back to the default. Read on mount
  // (in an effect, not the initial state, to avoid an SSR hydration mismatch)
  // and written on every tab change. sessionStorage keeps it scoped to the
  // current browsing session.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("insightsMobileTab");
      if (saved === "videos" || saved === "insights") setMobileTab(saved);
    } catch {
      /* sessionStorage unavailable — fall back to the default tab */
    }
  }, []);

  const selectMobileTab = (tab: "insights" | "videos") => {
    setMobileTab(tab);
    try {
      sessionStorage.setItem("insightsMobileTab", tab);
    } catch {
      /* ignore persistence failures (private mode, storage disabled) */
    }
  };

  // Search stays in the page, above the list it filters.
  //
  // It was briefly a mode of the bottom bar. Two things were wrong with that.
  // A field docked over the keyboard put the query, the result count and the
  // results themselves in three separate parts of the screen, and it read as
  // a search of whatever tab you were on -- so from Videos it looked like it
  // would search videos, which it cannot. Sitting on the written-insights tab
  // it can only mean one thing, and the count sits directly under it.
  const [searchResults, setSearchResults] = useState<InsightSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  const trimmedQuery = query.trim();
  const isSearchActive = trimmedQuery.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!isSearchActive) {
      setSearchResults([]);
      setSearching(false);
      setSearchError(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(false);
      try {
        const res = await fetch(`/api/insights/search?q=${encodeURIComponent(trimmedQuery)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("search request failed");
        const data = await res.json();
        setSearchResults(Array.isArray(data.results) ? data.results : []);
      } catch (err) {
        if ((err as { name?: string })?.name !== "AbortError") {
          setSearchError(true);
          setSearchResults([]);
        }
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmedQuery, isSearchActive]);

  const visiblePosts: ListPost[] = useMemo(
    () => (isSearchActive ? searchResults : posts),
    [isSearchActive, searchResults, posts]
  );

  const pageUrl = "https://www.mystockharbor.com/insights";
  const shareText = "Daily stock market insights, chart setups & technical analysis on MyStockHarbor 📊";

  const listLabel = isSearchActive
    ? searching
      ? "Searching…"
      : `${searchResults.length} match${searchResults.length === 1 ? "" : "es"}`
    : `Latest insights — ${totalCount} total`;

  const emptyMessage = isSearchActive
    ? searchError
      ? "Search is unavailable right now — try again in a moment."
      : `No insights match "${trimmedQuery}".`
    : "No insight posts yet.";

  return (
    <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
      <div className="insightsWrap" style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 20px 40px" }}>

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
        <section className="marketHubCard" style={{ marginTop: 18, borderRadius: 18, border: "1px solid rgba(59,130,246,0.22)", background: "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(34,197,94,0.06))", padding: 18 }}>
          <div style={{ fontSize: 12, opacity: 0.78, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase" }}>Market hub</div>
          <div style={{ marginTop: 8, fontSize: 24, fontWeight: 900, lineHeight: 1.2, letterSpacing: "-0.03em" }}>Looking for the bigger market picture?</div>
          <p style={{ margin: "10px 0 0", maxWidth: 820, lineHeight: 1.7, opacity: 0.84, fontSize: 15 }}>
            Read the S&amp;P 500 market page for a simple breakdown of SPX trend, key levels, RSI, MACD, and how to analyse market pullbacks without panicking.
          </p>
          <div className="ctaRow" style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/markets/spx" className="ctaBtn" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(59,130,246,0.45)", background: "linear-gradient(135deg, rgba(59,130,246,0.22), rgba(37,99,235,0.12))", color: "#eff6ff", textDecoration: "none", fontWeight: 900, fontSize: 13, whiteSpace: "nowrap", boxShadow: "0 6px 16px rgba(0,0,0,0.25)" }}>S&amp;P 500 Analysis →</Link>
            <Link href="/pickers" className="ctaBtn" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(34,197,94,0.45)", background: "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.12))", color: "#ecfdf5", textDecoration: "none", fontWeight: 900, fontSize: 13, whiteSpace: "nowrap", boxShadow: "0 6px 16px rgba(0,0,0,0.25)" }}>Live Stock Setups →</Link>
          </div>
        </section>

        {/* ── MOBILE: the two lists. The tab switcher that used to sit above
            them is in the docked bar at the foot of the screen -- see
            .insightsBar below. The search field stays here, on the tab whose
            list it filters and directly above the count of what it matched. ── */}
        <div className="mobileTabs" style={{ marginTop: 20, display: "none" }}>
          {mobileTab === "insights" && (
            <div>
              <SearchBox value={query} onChange={setQuery} />
              <div style={{ marginTop: 12, fontSize: 11, opacity: 0.55, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase" }}>
                {listLabel}
              </div>
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {visiblePosts.length === 0 ? (
                  <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", padding: 16, opacity: 0.7 }}>{emptyMessage}</div>
                ) : (
                  visiblePosts.map((post) => <PostCard key={post.slug} post={post} />)
                )}
              </div>
              {!isSearchActive && <PaginationNav page={page} totalPages={totalPages} />}
            </div>
          )}

          {mobileTab === "videos" && (
            <div>
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
            <SearchBox value={query} onChange={setQuery} />
            <div style={{ marginTop: 16, marginBottom: 12, fontSize: 11, opacity: 0.55, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase" }}>
              {listLabel}
            </div>
            {visiblePosts.length === 0 ? (
              <div style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", padding: 16, opacity: 0.7 }}>{emptyMessage}</div>
            ) : (
              <div style={{ maxHeight: "80vh", overflowY: "auto", display: "grid", gap: 8, scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.15) transparent", touchAction: "pan-y" }}>
                {visiblePosts.map((post) => <PostCard key={post.slug} post={post} />)}
              </div>
            )}
            {!isSearchActive && <PaginationNav page={page} totalPages={totalPages} />}
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

      {/* ── PHONE: docked bar ──
          Same treatment as the picker controls bar: fixed to the bottom, equal
          shares so no item can push another off the edge, icon over caption,
          flat and opaque. What you read is the list; what you press is the bar.

          Two items today. Deliberately left as a bar rather than folded back
          into an inline switcher, because it is the page's permanent
          navigation surface and more will land in it as the site grows -- the
          equal-share layout takes a third or fourth item without any of the
          overflow trouble the picker bar had with pills.

          It is a sibling of .insightsWrap rather than a child so nothing in the
          page's own layout can clip or offset it, and it renders on every
          breakpoint but only displays under 980px, which is the same width at
          which the page swaps to its single-column form. */}
      <div className="insightsBar">
        <button
          type="button"
          className={mobileTab === "insights" ? "insightsBarItem isActive" : "insightsBarItem"}
          onClick={() => selectMobileTab("insights")}
          aria-current={mobileTab === "insights" ? "true" : undefined}
        >
          <WrittenIcon size={22} />
          <span className="insightsBarLabel">Insights</span>
        </button>
        <button
          type="button"
          className={mobileTab === "videos" ? "insightsBarItem isActiveVideos" : "insightsBarItem"}
          onClick={() => selectMobileTab("videos")}
          aria-current={mobileTab === "videos" ? "true" : undefined}
        >
          <VideoIcon size={22} />
          <span className="insightsBarLabel">Videos</span>
        </button>
      </div>

      <style>{`
        /* Off by default: this is the phone's control surface, and above 980px
           the page already shows both columns and its own search field. */
        .insightsBar { display: none; }

        @media (max-width: 980px) {
          .mobileTabs { display: block !important; }
          .desktopLayout { display: none !important; }

          .insightsBar {
            display: flex;
            position: fixed; left: 0; right: 0; bottom: 0;
            /* Under the site header (100) and any sheet, over the page. Same
               layer the picker controls bar uses. */
            z-index: 55;
            align-items: stretch;
            /* Opaque. A translucent bar over a column of cards reads as
               smeared rather than as depth. */
            background: #080b12;
            border-top: 1px solid rgba(255,255,255,0.10);
            padding: 0 0 env(safe-area-inset-bottom);
          }

          /* Reserves the bar's height at the foot of the document so the last
             post, the pagination row and the YouTube button are not sitting
             underneath it. Without this it is not docked, it is covering
             something. */
          body { padding-bottom: calc(58px + env(safe-area-inset-bottom)); }

          .insightsBarItem {
            flex: 1 1 0; min-width: 0;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center; gap: 3px;
            padding: 7px 4px 6px;
            border: 0; background: none; cursor: pointer;
            font-family: system-ui, Arial;
            font-size: 10.5px; font-weight: 800; line-height: 1;
            color: rgba(148,163,184,0.85);
            transition: color 0.15s;
          }
          .insightsBarItem:active { background: rgba(255,255,255,0.04); }
          .insightsBarItem.isActive { color: #93c5fd; }
          .insightsBarItem.isActiveVideos { color: #fca5a5; }
          .insightsBarLabel {
            max-width: 100%; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap;
          }
        }

        @media (min-width: 981px) {
          .mobileTabs { display: none !important; }
          .desktopVideos { position: sticky; top: 24px; }
        }

        /* Phone density.
           The page spent 20px of side padding plus 18px of card padding plus
           a 58px ticker column before the post title got any room, which is
           why every title on a 390px screen clipped at two lines. These
           numbers claw ~30px back into the title column.

           The two market-hub CTAs also wrapped to one per line: at 13px/900
           the old labels ran past the ~314px of usable width between them.
           They are now a fixed 2-up grid, and the labels lost their verbs to
           fit ("Read S&P 500 Analysis" -> "S&P 500 Analysis"). white-space
           goes back to normal so a long label wraps inside its button rather
           than overflowing; the grid keeps both boxes the same height. */
        @media (max-width: 560px) {
          .insightsWrap { padding: 20px 12px 32px !important; }
          .marketHubCard { padding: 14px !important; }
          .ctaRow {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 8px !important;
          }
          .ctaBtn {
            width: 100%;
            padding: 10px 8px !important;
            font-size: 12.5px !important;
            white-space: normal !important;
            text-align: center;
            line-height: 1.25;
          }
          .postCard {
            padding: 13px 14px !important;
            gap: 12px !important;
          }
          .postCardTicker { min-width: 46px !important; }
        }
      `}</style>
    </main>
  );
}
