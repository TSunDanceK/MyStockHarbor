import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

import { sectorNewsPath, sectorSlugFromLabel } from "@/lib/sectors";

// -- Company profile card -----------------------------------------------------
// Server-rendered "About" block built from the FMP company profile endpoint.
// Presentational only (no hooks) so it renders into the crawlable initial HTML.

export type CompanyProfile = {
  companyName: string | null;
  description: string | null;
  sector: string | null;
  industry: string | null;
  ceo: string | null;
  website: string | null;
  employees: number | null;
  exchange: string | null;
  country: string | null;
  ipoDate: string | null;
  isin: string | null;
  cusip: string | null;
  marketCap: number | null;
  beta: number | null;
  price: number | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  lastDividend: number | null;
  currency: string | null;
};

function fmtLargeMoney(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000) return `${sign}$${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtInt(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value).toLocaleString("en-US");
}

function fmtMoney2(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `$${value.toFixed(2)}`;
}

function fmtDate(value: string | null) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

function hostname(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function CompanyProfile({
  profile,
  symbol,
  belowDescription,
  belowStats,
}: {
  profile: CompanyProfile;
  symbol: string;
  // Optional extra content (e.g. the share-dilution chart) rendered directly
  // under the description paragraph, in the same flowing column as the
  // description (i.e. beside/below the floated stat sidebar — see the layout
  // note on the render block below). Falls back to normal in-flow placement
  // (after the description) when there are no stat rows.
  belowDescription?: ReactNode;
  // Optional extra content (e.g. the "Learn the indicators" links) rendered
  // after `belowDescription`, still in the flowing column. Sits last in the
  // reading order on every breakpoint.
  belowStats?: ReactNode;
}) {
  const name = profile.companyName || symbol;
  const dividend =
    typeof profile.lastDividend === "number" && Number.isFinite(profile.lastDividend) && profile.lastDividend > 0
      ? `Yes · ${fmtMoney2(profile.lastDividend)}`
      : "No";

  const rangeText =
    typeof profile.rangeLow === "number" && typeof profile.rangeHigh === "number"
      ? `${fmtMoney2(profile.rangeLow)} – ${fmtMoney2(profile.rangeHigh)}`
      : null;

  // Sector links through to that sector's news page when we recognise the FMP
  // label. Unrecognised/absent sectors just render as plain text as before.
  const sectorSlug = sectorSlugFromLabel(profile.sector);

  // label → value; only rows with a value are rendered.
  //
  // `external` matters: the href branch below was written for the Website row
  // and hardcoded target="_blank" + rel="nofollow". Reusing it as-is for an
  // INTERNAL link would open our own page in a new tab and pass no internal
  // link equity, so internal rows opt out via this flag.
  const rows: Array<{
    label: string;
    value: string | null;
    href?: string;
    external?: boolean;
  }> = [
    {
      label: "Sector",
      value: profile.sector,
      href: sectorSlug ? sectorNewsPath(sectorSlug) : undefined,
      external: false,
    },
    { label: "Industry", value: profile.industry },
    { label: "CEO", value: profile.ceo },
    { label: "Employees", value: fmtInt(profile.employees) },
    { label: "Market cap", value: fmtLargeMoney(profile.marketCap) },
    { label: "Beta", value: typeof profile.beta === "number" && Number.isFinite(profile.beta) ? profile.beta.toFixed(2) : null },
    { label: "52-week range", value: rangeText },
    { label: "Dividend", value: dividend },
    { label: "Exchange", value: profile.exchange },
    { label: "Country", value: profile.country },
    { label: "IPO date", value: fmtDate(profile.ipoDate) },
    { label: "ISIN", value: profile.isin },
    { label: "CUSIP", value: profile.cusip },
    {
      label: "Website",
      value: hostname(profile.website),
      href: profile.website
        ? profile.website.startsWith("http")
          ? profile.website
          : `https://${profile.website}`
        : undefined,
      external: true,
    },
  ].filter((r) => r.value);

  const hasDescription = Boolean(profile.description);
  const hasRows = rows.length > 0;
  const hasAnything = hasDescription || hasRows;
  if (!hasAnything) return null;

  const statBoxes = rows.map((r) => (
    <div key={r.label} style={cellStyle}>
      <div style={cellLabelStyle}>{r.label}</div>
      {r.href && r.external ? (
        <a
          href={r.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          style={{ ...cellValueStyle, color: "#93c5fd", textDecoration: "none" }}
        >
          {r.value}
        </a>
      ) : r.href ? (
        <Link
          href={r.href}
          style={{ ...cellValueStyle, color: "#93c5fd", textDecoration: "none" }}
        >
          {r.value}
        </Link>
      ) : (
        <div style={cellValueStyle}>{r.value}</div>
      )}
    </div>
  ));

  return (
    <section style={{ marginTop: 32, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 24 }}>
      <div style={eyebrowStyle}>Company profile</div>
      <h2 style={headingStyle}>About {name}</h2>

      {/* Desktop: the stat boxes are FLOATED to the right (fixed 260px) and
          everything else — description, belowDescription (share-dilution
          chart), belowStats ("Learn the indicators") — runs down the page in
          normal flow beside them, continuing full-width underneath once it
          outruns the sidebar.

          This used to be a `1fr 260px` grid, but the two columns can't be
          balanced by any static content split: FMP descriptions range from
          ~450 to ~2,150 characters, which is a ~640px swing in the left
          column's height against a sidebar that's a near-fixed ~1,000px.
          Short-description tickers (e.g. PAC) left a ~520px hole; long ones
          (AAPL) overshot instead. A float has no fixed row height, so the
          flow simply wraps under the sidebar when it's longer and the
          leftover gap collapses to <100px at both ends of that range.

          `belowDescription` / `belowStats` get `display: flow-root` so they
          form their own block formatting contexts: block boxes don't shrink
          around floats on their own (only line boxes do), so without a BFC a
          full-width chart would render *underneath* the sidebar instead of
          beside it.

          Mobile: the float is dropped and the container becomes a flex
          column, with `order` restoring the original reading order
          (description → dilution → stat boxes 2-up → learn links), since the
          stat boxes have to come first in the DOM for the float to work. */}
      {hasDescription && hasRows ? (
        <div className="cp-flow">
          <div className="cp-stats">{statBoxes}</div>
          <p className="cp-desc" style={descStyle}>{profile.description}</p>
          {belowDescription ? <div className="cp-below-desc">{belowDescription}</div> : null}
          {belowStats ? <div className="cp-below-stats">{belowStats}</div> : null}
          <div className="cp-clear" />
        </div>
      ) : hasDescription ? (
        <>
          <p style={descStyle}>{profile.description}</p>
          {belowDescription}
          {belowStats}
        </>
      ) : (
        <>
          <div style={gridStyle} className="cp-grid-fallback">{statBoxes}</div>
          {belowDescription}
          {belowStats}
        </>
      )}

      <div style={sourceStyle}>
        Company profile data from Financial Modeling Prep. {symbol} listed on{" "}
        {profile.exchange ?? "its exchange"}.
      </div>

      <style>{`
        .cp-flow { margin-top: 18px; }
        .cp-stats {
          float: right;
          width: 260px;
          margin: 0 0 24px 24px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        /* New block formatting contexts so these sit BESIDE the floated
           sidebar (narrowed) rather than sliding underneath it. */
        .cp-below-desc, .cp-below-stats { display: flow-root; }
        /* 284px = the sidebar's 260px + its 24px margin. A block that starts
           beside the float is already narrowed to exactly this; the cap only
           bites for a description long enough to push the chart past the
           bottom of the sidebar, and keeps the chart the same width on every
           ticker rather than jumping to full-bleed on the wordiest ones.
           `belowStats` is deliberately uncapped — it's a link list, so
           letting it use the full width when it lands below the sidebar
           fills space instead of leaving a gutter. */
        .cp-below-desc { max-width: calc(100% - 284px); }
        /* belowStats used to sit under the stat cards with only its own 4px
           top margin before its divider rule, which is too tight now that it
           follows the dilution chart's source line instead. */
        .cp-below-stats { margin-top: 20px; }
        /* Keeps the data-source line (and anything after the section) below
           the sidebar when the flow column is the shorter of the two. */
        .cp-clear { clear: both; }

        @media (max-width: 720px) {
          .cp-flow {
            display: flex !important;
            flex-direction: column !important;
            gap: 18px !important;
          }
          /* DOM order is stats-first (float requirement); restore the
             reading order description → dilution → stats → learn links. */
          .cp-desc { order: 1; }
          .cp-below-desc { order: 2; }
          .cp-stats { order: 3; }
          .cp-below-stats { order: 4; }
          .cp-clear { display: none !important; }
          .cp-below-desc { max-width: none !important; }
          .cp-stats {
            float: none !important;
            width: auto !important;
            margin: 0 !important;
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 10px !important;
          }
          .cp-grid-fallback {
            grid-template-columns: 1fr 1fr !important;
          }
        }
        @media (max-width: 340px) {
          .cp-stats { grid-template-columns: 1fr !important; }
          .cp-grid-fallback { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}

const eyebrowStyle: CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(147,197,253,0.82)", marginBottom: 6 };
const headingStyle: CSSProperties = { margin: 0, fontSize: 26, lineHeight: 1.12, letterSpacing: "-0.03em", fontWeight: 700 };
const descStyle: CSSProperties = { margin: 0, fontSize: 16, lineHeight: 1.75, color: "rgba(241,245,249,0.82)" };
const gridStyle: CSSProperties = { marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 };
const cellStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 12px", background: "rgba(255,255,255,0.02)", minWidth: 0 };
const cellLabelStyle: CSSProperties = { fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(148,163,184,0.62)" };
const cellValueStyle: CSSProperties = { marginTop: 4, fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em", color: "#f1f5f9", overflowWrap: "anywhere" };
const sourceStyle: CSSProperties = { marginTop: 12, fontSize: 11, lineHeight: 1.5, color: "rgba(203,213,225,0.55)" };
