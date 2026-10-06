import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { SECTORS, sectorNewsPath } from "@/lib/sectors";
import {
  getSectorPerformanceTable,
  sessionDateLabel,
  type SectorPerformanceRow,
} from "@/lib/server/sectorPanels";
import { getSectorConstituentCounts } from "@/lib/server/sectorUniverse";
import { priceProviderFor } from "@/lib/server/marketData/provider";
import { lastCloseLabel } from "@/lib/server/marketData/eodLast";
import { TIINGO_CREDIT, TIINGO_URL } from "@/lib/server/tiingoSurfacePrice";
import { heatSizing, heatTiles, squarify } from "@/lib/sectorHeatmap";
import SectorHeatMap from "./SectorHeatMap";
import SectorCompareTable, { type CompareRow } from "./SectorCompareTable";
import { getSectorByLabel } from "@/lib/sectors";
import { readSectorTones } from "@/lib/server/sectorTone";
import { readPeSectorMedians } from "@/lib/server/peSectorMedians";
import { PE_MAX_SPREAD_PCT, PE_PEER_FLOOR } from "@/lib/peSectorLine";
import { MOVERS_RULE, breadthLine, toneIsFresh, usableMedian, type Mover, type StoredTone } from "@/lib/sectorCards";

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

type CardFacts = { tone: StoredTone | null; breadth: ReturnType<typeof breadthLine>; movers: Mover[]; medianPe: number | null };

/** The cards' tone and median P/E sources, read once; returns the per-card reader. */
async function loadCardFacts(): Promise<(slug: string, row: SectorPerformanceRow | null) => CardFacts> {
  const [tones, peMedians] = await Promise.all([readSectorTones(), readPeSectorMedians().catch(() => null)]);
  const nowMs = Date.now();
  const medianBySlug = new Map<string, number>();
  for (const [label, m] of Object.entries(peMedians?.sectors ?? {})) {
    const slug = getSectorByLabel(label)?.slug;
    const median = usableMedian(m, PE_PEER_FLOOR, PE_MAX_SPREAD_PCT);
    if (slug && median != null) medianBySlug.set(slug, median);
  }
  return (slug, row) => ({
    tone: toneIsFresh(tones[slug], nowMs) ? tones[slug] : null,
    breadth: breadthLine(row?.above200, row?.breadthN),
    movers: [...(row?.gainers ?? []), ...(row?.decliners ?? [])],
    medianPe: medianBySlug.get(slug) ?? null,
  });
}

export default async function SectorIndexPage() {
  // Commands per regeneration (ISR 30 min): the cached sector table (1 GET on
  // a hit), the tones hash (1 HGETALL), and A's P/E medians from the Data
  // Cache (no command on a hit) -- #553 COWORK #157.
  const [table, counts, cardFacts] = await Promise.all([
    getSectorPerformanceTable(),
    getSectorConstituentCounts(),
    loadCardFacts(),
  ]);

  const byslug = new Map<string, SectorPerformanceRow>(
    table.rows.map((row) => [row.slug, row])
  );

  // THE HEAT MAP (#553 COWORK #157): the cards' own figures, one tile each.
  // Sized by tracked cap only when every sector's caps cover >= 80% of its
  // constituents; otherwise by companies tracked. The fine print says which.
  const heatRows = SECTORS.map((sector) => {
    const row = byslug.get(sector.slug);
    return {
      slug: sector.slug,
      name: sector.name,
      href: sectorNewsPath(sector.slug),
      companies: counts[sector.slug] ?? 0,
      day: row?.day ?? null,
      month: row?.month ?? null,
      ytd: row?.ytd ?? null,
      capSum: row?.capSum ?? null,
      capCovered: row?.capCovered ?? 0,
      constituents: row?.constituents ?? counts[sector.slug] ?? 0,
    };
  });
  const sizing = heatSizing(heatRows);
  const tiles = heatTiles(heatRows, sizing);
  // Laid out in the desktop box's own 2:1 shape, then turned into percents,
  // so squarifying holds on screen (a square layout stretched to 2:1 makes
  // the smallest tiles into thin strips).
  const rects = squarify(tiles.map((t) => t.weight), 200, 100).map((r) => ({ x: r.x / 2, y: r.y, w: r.w / 2, h: r.h }));
  const firstRow = table.rows.find((row) => row.sessionDate) ?? null;
  const heatDayLabel =
    firstRow?.dayBasis === "last-close" ? lastCloseLabel(firstRow.sessionDate) ?? "Last close" : "Last close";
  const sizedBy =
    sizing.basis === "cap"
      ? `tracked market cap (shares from SEC filings times the latest price; at least ${Math.round((sizing.minCoverage ?? 0) * 100)}% of every sector's companies covered)`
      : "companies tracked";

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
            headline tone, and shows who is driving it and how broad the move is.
          </p>
        </section>

        {table.rows.length ? (
          <SectorHeatMap tiles={tiles} rects={rects} dayLabel={heatDayLabel} sizedBy={sizedBy} credit={{ text: TIINGO_CREDIT, href: TIINGO_URL }} />
        ) : null}

        <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12, marginTop: 22 }} className="sectorGrid">
          {ordered.map((sector) => {
            const row = byslug.get(sector.slug) ?? null;
            const facts = cardFacts(sector.slug, row);

            return (
              <article key={sector.slug} style={cardStyle} className="sectorCard" data-slug={sector.slug}>
                <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                  <Link href={sectorNewsPath(sector.slug)} className="sectorCardTitle" style={cardTitleStyle}>{sector.name}</Link>
                  <div style={cardBlurbStyle}>{sector.blurb}</div>
                  <div style={cardMetaStyle}>
                    {counts[sector.slug] ? `${counts[sector.slug]} companies tracked` : "Coverage building"}
                  </div>
                  {/* THE CARD'S EXTRA FACTS (#553 COWORK #157 item 3; no
                      "Reporting next", #158). Each block shows only when its
                      data exists; the tap note says how each is worked out. */}
                  <div className="sectorFacts">
                    {facts.tone ? <span className="sectorTone">News tone: {facts.tone.label}</span> : null}
                    {facts.breadth ? (
                      <div className="sectorBreadth">
                        <span>Above their 200-day average: {facts.breadth.x} of {facts.breadth.n}</span>
                        <span className="sectorBar" aria-hidden="true"><span style={{ width: `${facts.breadth.pct.toFixed(1)}%` }} /></span>
                      </div>
                    ) : null}
                    {facts.movers.length ? (
                      <div className="sectorMovers">
                        <span className="sectorMoversLabel">Driving it today:</span>
                        {facts.movers.map((m) => (
                          <Link key={m.symbol} href={`/stock/${encodeURIComponent(m.symbol)}`} className={m.pct >= 0 ? "moverChip up" : "moverChip down"}>
                            {m.symbol} {m.pct > 0 ? "+" : ""}{m.pct.toFixed(1)}%
                          </Link>
                        ))}
                      </div>
                    ) : null}
                    <span className="sectorPe">Median P/E: {facts.medianPe != null ? `${facts.medianPe.toFixed(1)}×` : "—"}</span>
                  </div>
                  <details className="sectorNote">
                    <summary>How these are worked out</summary>
                    <p>
                      Returns are weighted by tracked market cap across the largest names we track, not index prints.
                      News tone is the score on this sector&apos;s news page, shown only while it is under three hours old.
                      The 200-day line counts only companies with at least 200 stored daily bars. {MOVERS_RULE} Median
                      P/E is the median trailing P/E of the sector&apos;s companies, banks left out; it shows a dash where
                      there are too few comparable companies or the median is not stable.
                    </p>
                  </details>
                </div>
                <div style={cardStatsStyle}>
                  <div>
                    <div style={statLabelStyle}>
                      {row?.dayBasis === "last-close"
                        ? lastCloseLabel(row.sessionDate) ?? "Last close"
                        : row?.dayBasis === "last-session"
                          ? `Last session${sessionDateLabel(row.sessionDate) ? ` · ${sessionDateLabel(row.sessionDate)}` : ""}`
                          : "Today"}
                    </div>
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
              </article>
            );
          })}
        </section>

        <SectorCompareTable
          dayLabel={heatDayLabel}
          rows={SECTORS.map((sector): CompareRow => {
            const row = byslug.get(sector.slug) ?? null;
            const f = cardFacts(sector.slug, row);
            return {
              slug: sector.slug,
              name: sector.name,
              href: sectorNewsPath(sector.slug),
              day: row?.day ?? null,
              month: row?.month ?? null,
              ytd: row?.ytd ?? null,
              breadthPct: f.breadth?.pct ?? null,
              breadthText: f.breadth ? `${f.breadth.x}/${f.breadth.n}` : null,
              medianPe: f.medianPe,
              tone: f.tone?.label ?? null,
              toneScore: f.tone?.score ?? null,
            };
          })}
        />

        <p style={footnoteStyle} data-fine-print>
          Performance figures are constituent-weighted across the largest names we track in each
          sector, not index prints. This page refreshes every 30 minutes, so they are not live.
          {/* Step 5 (#553 COWORK #98): on Tiingo the figures are consolidated closes from the nightly end-of-day data. */}
          {priceProviderFor("POOL") === "tiingo" ? (
            <>
              {" "}On the last close: consolidated end-of-day prices.{" "}
              <a href={TIINGO_URL} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{TIINGO_CREDIT}</a>
            </>
          ) : null}
        </p>
      </div>

      <style>{`
        .sectorWrap { max-width: 1120px; margin: 0 auto; padding: 24px 40px 42px; }
        @media (max-width: 820px) { .sectorWrap { padding: 18px 16px 32px; } }
        .sectorCardTitle { color: #f1f5f9; text-decoration: none; }
        .sectorCardTitle:hover, .sectorCardTitle:focus-visible { text-decoration: underline; text-underline-offset: 4px; }
        .sectorFacts { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; font-size: var(--fs-read); line-height: 1.4; color: rgba(241,245,249,0.82); }
        .sectorTone { font-size: var(--fs-label); padding: 3px 10px; border-radius: 999px; border: 1px solid rgba(148,163,184,0.3); background: rgba(148,163,184,0.08); font-weight: 750; }
        .sectorBreadth { display: inline-flex; flex-direction: column; gap: 4px; min-width: 0; }
        .sectorBar { display: block; width: 160px; max-width: 100%; height: 4px; border-radius: 999px; background: rgba(148,163,184,0.2); overflow: hidden; }
        .sectorBar > span { display: block; height: 100%; background: #38bdf8; }
        .sectorMovers { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .sectorMoversLabel { font-weight: 700; }
        .moverChip { font-size: var(--fs-label); padding: 3px 8px; border-radius: 8px; font-weight: 800; text-decoration: none; font-variant-numeric: tabular-nums; }
        .moverChip.up { color: #bbf7d0; background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.3); }
        .moverChip.down { color: #fecaca; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); }
        .moverChip:hover, .moverChip:focus-visible { text-decoration: underline; }
        .sectorPe { font-weight: 700; }
        .sectorNote { margin-top: 10px; font-size: var(--fs-label); color: rgba(241,245,249,0.7); }
        .sectorNote summary { cursor: pointer; color: #7dd3fc; font-weight: 700; min-height: 24px; }
        .sectorNote p { margin: 8px 0 0; font-size: var(--fs-read); line-height: var(--lh-read); max-width: 620px; }
      `}</style>
    </main>
  );
}

const heroStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.09)", borderRadius: 28, padding: 22, background: "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(6,9,15,0.98))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 54px rgba(0,0,0,0.36)" };
const tagStyle: CSSProperties = { display: "inline-flex", alignItems: "center", padding: "8px 12px", borderRadius: 999, border: "1px solid rgba(59,130,246,0.28)", background: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.08))", color: "#dbeafe", fontSize: "var(--fs-label)", fontWeight: 950, letterSpacing: "0.08em", textTransform: "uppercase" };
const titleStyle: CSSProperties = { margin: "14px 0 0 0", fontSize: 40, lineHeight: 1.04, letterSpacing: "-0.05em", maxWidth: 760 };
const leadStyle: CSSProperties = { margin: "14px 0 0 0", maxWidth: 820, fontSize: "var(--fs-read)", lineHeight: 1.75, color: "rgba(241,245,249,0.82)" };
const cardStyle: CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, flexWrap: "wrap", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: 18, background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))", color: "#f1f5f9", textDecoration: "none" };
const cardTitleStyle: CSSProperties = { fontSize: 22, fontWeight: 900, letterSpacing: "-0.03em" };
const cardBlurbStyle: CSSProperties = { marginTop: 8, maxWidth: 620, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(241,245,249,0.72)" };
const cardMetaStyle: CSSProperties = { marginTop: 8, fontSize: "var(--fs-label)", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(147,197,253,0.7)" };
const cardStatsStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(70px, 1fr))", gap: 14, textAlign: "right" };
const statLabelStyle: CSSProperties = { fontSize: "var(--fs-label)", fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(241,245,249,0.55)" };
const statValueStyle: CSSProperties = { marginTop: 6, fontSize: 18, fontWeight: 950, letterSpacing: "-0.03em" };
const footnoteStyle: CSSProperties = { marginTop: 18, fontSize: "var(--fs-fine)", lineHeight: 1.6, color: "rgba(241,245,249,0.48)" };
