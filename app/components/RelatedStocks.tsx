import Link from "next/link";
import type { CSSProperties } from "react";

import { uniqueEtfs } from "@/lib/curatedSymbols";

// getRelatedSymbols() draws from uniqueEtfs as well as the equity lists, so
// this module renders funds alongside companies. A fund does not report
// earnings, which makes /stock/{etf}/earnings an empty page by definition --
// so it gets an Analysis and a News link and nothing else. Linking it would
// be spending crawl budget on a page that can never have content, which is
// the opposite of the point of this change.
//
// (Those URLs are still submitted by app/sitemap.ts, which is worth
// revisiting separately.)
const ETF_SYMBOLS = new Set(uniqueEtfs.map((sym) => sym.toUpperCase()));

// -- Explore More Stocks -----------------------------------------------------
// Server-rendered, presentational-only internal-linking module (no hooks) —
// so it renders into the crawlable initial HTML, same pattern as
// CompanyProfile.tsx / LatestEarningsCard.tsx.
//
// Why this exists: a July 2026 Google Search Console audit found the site
// has zero external backlinks, and GSC's internal-links report showed links
// heavily concentrated on a handful of hub pages (homepage, /platforms,
// /learn, /pickers, /utilities, /insights, /dashboard, /bottlenecks) while
// the 100+ individual /stock/[symbol] pages barely appeared at all — they
// only picked up an internal link when they happened to show up in a live,
// time-limited picker/bottleneck result. This module gives every stock page
// a small, stable, always-present set of links to OTHER stock pages so
// Google (and users) have a durable path into the long tail. See
// lib/curatedSymbols.ts (getRelatedSymbols) for the deterministic selection
// logic behind the `symbols` prop.
//
// 2026-08-15 update — /news and /earnings added alongside the base URL.
// The follow-up audit found that the fix above had only ever been half
// applied: this module emitted `/stock/{sym}` and nothing else, so while
// every stock page gained inbound links, the 322 `/stock/{sym}/news` and
// `/stock/{sym}/earnings` subpages stayed exactly as orphaned as before —
// one inbound link each, from their own parent. They made up the single
// largest cluster in "Discovered - currently not indexed", every one with
// `Last crawled: N/A`.
//
// The fix is small but the effect compounds: this module renders on all 483
// stock routes, so linking three URLs per related symbol instead of one
// turns a 161-node graph into a 483-node mesh. A crawler landing anywhere
// in it now finds subpages, not just siblings.
// See claude/seo-recovery-plan-2026-08-15.md (Phase 2.3).

export default function RelatedStocks({
  currentSymbol,
  symbols,
}: {
  currentSymbol: string;
  symbols: string[];
}) {
  const upperCurrent = currentSymbol.toUpperCase();
  const others = symbols.filter((sym) => sym.toUpperCase() !== upperCurrent);
  if (others.length === 0) return null;

  return (
    <section style={outerStyle}>
      <div style={wrapStyle}>
        <div style={eyebrowStyle}>Explore More Stocks</div>
        <h2 style={headingStyle}>Other stocks to check out</h2>
        <p style={descStyle}>
          Jump straight to the analysis, latest news or earnings history for
          another symbol on MyStockHarbor.
        </p>
        <div style={gridStyle}>
          {others.map((sym) => {
            const encoded = encodeURIComponent(sym);
            const isEtf = ETF_SYMBOLS.has(sym.toUpperCase());

            return (
              <div key={sym} style={cardStyle}>
                <Link href={`/stock/${encoded}`} style={symbolLinkStyle}>
                  {sym}
                </Link>
                <div style={subRowStyle}>
                  <Link href={`/stock/${encoded}/news`} style={subLinkStyle}>
                    News
                  </Link>
                  {isEtf ? null : (
                    <>
                      <span aria-hidden="true" style={dotStyle}>
                        &middot;
                      </span>
                      <Link
                        href={`/stock/${encoded}/earnings`}
                        style={subLinkStyle}
                      >
                        Earnings
                      </Link>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// This module renders as a top-level sibling of StockSymbolPageClient's
// <main> (see app/stock/[symbol]/page.tsx) rather than nested inside it, so
// it carries its own page background + width container matching that
// component's `.stock-wrap` convention (max-width: 1240px, centered, 20px
// side padding) instead of relying on ambient page layout.
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

// Was a wrapping flex row of single pills. Now a responsive grid of small
// cards, because each entry carries three links rather than one — pills
// would wrap into an unreadable run at ~30 links.
const gridStyle: CSSProperties = {
  marginTop: 14,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
  gap: 8,
};
const cardStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
};
const symbolLinkStyle: CSSProperties = {
  display: "inline-block",
  color: "#e2e8f0",
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "-0.01em",
};
const subRowStyle: CSSProperties = {
  marginTop: 5,
  display: "flex",
  alignItems: "center",
  gap: 6,
};
const subLinkStyle: CSSProperties = {
  color: "rgba(148,163,184,0.92)",
  textDecoration: "none",
  fontSize: 11.5,
  fontWeight: 600,
};
const dotStyle: CSSProperties = {
  color: "rgba(148,163,184,0.45)",
  fontSize: 11.5,
};
