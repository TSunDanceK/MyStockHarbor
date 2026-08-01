import Link from "next/link";
import type { CSSProperties } from "react";

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
          Jump straight to the stock analysis page for another symbol on MyStockHarbor.
        </p>
        <div style={gridStyle}>
          {others.map((sym) => (
            <Link key={sym} href={`/stock/${encodeURIComponent(sym)}`} style={chipStyle}>
              {sym}
            </Link>
          ))}
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
const gridStyle: CSSProperties = { marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 };
const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 14px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  color: "#e2e8f0",
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "-0.01em",
};
