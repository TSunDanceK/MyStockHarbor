import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { SECTORS, sectorNewsPath } from "@/lib/sectors";
import {
  getSectorPerformanceTable,
  type SectorPerformanceRow,
} from "@/lib/server/sectorPanels";
import { getSectorConstituentCounts } from "@/lib/server/sectorUniverse";

export const runtime = "nodejs";
// ISR, same interval as /headlines and the per-sector news pages. See the note
// in app/sector/[slug]/news/page.tsx for why this is revalidate rather than
// force-dynamic, and why it doubles as the abuse protection for these routes.
export const revalidate = 1800;

const SITE = "https://www.mystockharbor.com";

export const metadata: Metadata = {
  title: "Sector News — All 11 Stock Market Sectors | MyStockHarbor",
  description:
    "Sector-by-sector stock market news with a sentiment score for each: technology, healthcare, financials, energy, industrials and the rest. See which sector's headlines are running hot.",
  robots: { index: true, follow: true },
  alternates: { canonical: `${SITE}/sector` },
  openGraph: {
    title: "Sector News — All 11 Stock Market Sectors | MyStockHarbor",
    description:
      "Sector-by-sector market news with a sentiment score for each of the 11 sectors.",
    url: `${SITE}/sector`,
    siteName: "MyStockHarbor",
    type: "website",
    images: [{ url: `${SITE}/og-image-v2.png`, width: 1200, height: 630, alt: "MyStockHarbor sector news" }],
  },
};

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function moveColour(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "rgba(241,245,249,0.6)";
  if (value > 0.05) return "#86efac";
  if (value < -0.05) return "#fca5a5";
  return "#f8fafc";
}

export default async function SectorIndexPage() {
  const [table, counts] = await Promise.all([
    getSectorPerformanceTable(),
    getSectorConstituentCounts(),
  ]);

  const byslug = new Map<string, SectorPerformanceRow>(
    table.rows.map((row) => [row.slug, row])
  );

  // Best performer first when we have a ranking; otherwise keep the canonical
  // order so the page is stable and predictable outside market hours.
  const ordered = [...SECTORS].sort((a, b) => {
    const rankA = byslug.get(a.slug)?.rank ?? 99;
    const rankB = byslug.get(b.slug)?.rank ?? 99;
    return rankA - rankB;
  });

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(37,99,235,0.18), transparent 22%), radial-gradient(circle at top right, rgba(34,197,94,0.10), transparent 22%), #06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "@id": `${SITE}/sector#collection`,
            url: `${SITE}/sector`,
            name: "Sector News",
            description:
              "Stock market news and sentiment scores for all 11 sectors.",
            hasPart: SECTORS.map((sector, index) => ({
              "@type": "WebPage",
              position: index + 1,
              name: `${sector.name} Sector News`,
              url: `${SITE}${sectorNewsPath(sector.slug)}`,
            })),
          }),
        }}
      />

      <div className="sectorWrap">
        <section style={heroStyle}>
          <div style={tagStyle}>SECTOR NEWS DESK</div>
          <h1 style={titleStyle}>Sector News — All 11 Market Sectors</h1>
          <p style={leadStyle}>
            The same news score we run on individual stocks, applied to whole sectors. Each page
            aggregates the latest coverage across that sector&apos;s largest names, scores the
            headline tone, and shows who is driving it, how broad the move is, and who reports next.
          </p>
        </section>

        <section style={{ display: "grid", gap: 12, marginTop: 22 }} className="sectorGrid">
          {ordered.map((sector) => {
            const row = byslug.get(sector.slug) ?? null;

            return (
              <Link key={sector.slug} href={sectorNewsPath(sector.slug)} style={cardStyle}>
                <div style={{ minWidth: 0 }}>
                  <div style={cardTitleStyle}>{sector.name}</div>
                  <div style={cardBlurbStyle}>{sector.blurb}</div>
                  <div style={cardMetaStyle}>
                    {counts[sector.slug] ? `${counts[sector.slug]} companies tracked` : "Coverage building"}
                  </div>
                </div>

                <div style={cardStatsStyle}>
                  <div>
                    <div style={statLabelStyle}>Today</div>
                    <div style={{ ...statValueStyle, color: moveColour(row?.day) }}>
                      {formatPercent(row?.day)}
                    </div>
                  </div>
                  <div>
                    <div style={statLabelStyle}>1 Month</div>
                    <div style={{ ...statValueStyle, color: moveColour(row?.month) }}>
                      {formatPercent(row?.month)}
                    </div>
                  </div>
                  <div>
                    <div style={statLabelStyle}>YTD</div>
                    <div style={{ ...statValueStyle, color: moveColour(row?.ytd) }}>
                      {formatPercent(row?.ytd)}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </section>

        <p style={footnoteStyle}>
          Performance figures are constituent-weighted across the largest names we track in each
          sector, not index prints. This page refreshes every 30 minutes, so they are not live.
        </p>
      </div>

      <style>{`
        .sectorWrap { max-width: 1120px; margin: 0 auto; padding: 24px 40px 42px; }
        @media (max-width: 820px) { .sectorWrap { padding: 18px 16px 32px; } }
      `}</style>
    </main>
  );
}

const heroStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.09)", borderRadius: 28, padding: 22, background: "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(6,9,15,0.98))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 54px rgba(0,0,0,0.36)" };
const tagStyle: CSSProperties = { display: "inline-flex", alignItems: "center", padding: "8px 12px", borderRadius: 999, border: "1px solid rgba(59,130,246,0.28)", background: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.08))", color: "#dbeafe", fontSize: 12, fontWeight: 950, letterSpacing: "0.08em", textTransform: "uppercase" };
const titleStyle: CSSProperties = { margin: "14px 0 0 0", fontSize: 40, lineHeight: 1.04, letterSpacing: "-0.05em", maxWidth: 760 };
const leadStyle: CSSProperties = { margin: "14px 0 0 0", maxWidth: 820, fontSize: 16, lineHeight: 1.75, color: "rgba(241,245,249,0.82)" };
const cardStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, flexWrap: "wrap", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: 18, background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))", color: "#f1f5f9", textDecoration: "none" };
const cardTitleStyle: CSSProperties = { fontSize: 22, fontWeight: 900, letterSpacing: "-0.03em" };
const cardBlurbStyle: CSSProperties = { marginTop: 8, maxWidth: 620, fontSize: 14, lineHeight: 1.65, color: "rgba(241,245,249,0.72)" };
const cardMetaStyle: CSSProperties = { marginTop: 8, fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(147,197,253,0.7)" };
const cardStatsStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(70px, 1fr))", gap: 14, textAlign: "right" };
const statLabelStyle: CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(241,245,249,0.55)" };
const statValueStyle: CSSProperties = { marginTop: 6, fontSize: 18, fontWeight: 950, letterSpacing: "-0.03em" };
const footnoteStyle: CSSProperties = { marginTop: 18, fontSize: 12, lineHeight: 1.6, color: "rgba(241,245,249,0.48)" };
