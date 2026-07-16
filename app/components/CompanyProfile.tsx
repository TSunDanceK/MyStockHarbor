import type { CSSProperties } from "react";

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
}: {
  profile: CompanyProfile;
  symbol: string;
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

  // label → value; only rows with a value are rendered.
  const rows: Array<{ label: string; value: string | null; href?: string }> = [
    { label: "Sector", value: profile.sector },
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
    },
  ].filter((r) => r.value);

  const hasDescription = Boolean(profile.description);
  const hasRows = rows.length > 0;
  const hasAnything = hasDescription || hasRows;
  if (!hasAnything) return null;

  const statBoxes = rows.map((r) => (
    <div key={r.label} style={cellStyle}>
      <div style={cellLabelStyle}>{r.label}</div>
      {r.href ? (
        <a
          href={r.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          style={{ ...cellValueStyle, color: "#93c5fd", textDecoration: "none" }}
        >
          {r.value}
        </a>
      ) : (
        <div style={cellValueStyle}>{r.value}</div>
      )}
    </div>
  ));

  return (
    <section style={{ marginTop: 32, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 24 }}>
      <div style={eyebrowStyle}>Company profile</div>
      <h2 style={headingStyle}>About {name}</h2>

      {/* Desktop: description in a wide left column, the stat boxes in a
          narrow right column. Mobile: single column layout — description,
          then the stat boxes below it, laid out 2-per-row (source order,
          no reordering) so the cards don't eat the whole screen. */}
      {hasDescription && hasRows ? (
        <div className="cp-columns">
          <p style={descStyle}>{profile.description}</p>
          <div className="cp-stats">{statBoxes}</div>
        </div>
      ) : hasDescription ? (
        <p style={descStyle}>{profile.description}</p>
      ) : (
        <div style={gridStyle} className="cp-grid-fallback">{statBoxes}</div>
      )}

      <div style={sourceStyle}>
        Company profile data from Financial Modeling Prep. {symbol} listed on{" "}
        {profile.exchange ?? "its exchange"}.
      </div>

      <style>{`
        .cp-columns {
          margin-top: 18px;
          display: grid;
          grid-template-columns: 1fr 260px;
          gap: 24px;
          align-items: start;
        }
        .cp-stats {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        @media (max-width: 720px) {
          .cp-columns { grid-template-columns: 1fr !important; gap: 18px !important; }
          .cp-stats {
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
const headingStyle: CSSProperties = { margin: 0, fontSize: 22, lineHeight: 1.15, letterSpacing: "-0.025em", fontWeight: 700 };
const descStyle: CSSProperties = { margin: 0, fontSize: 15, lineHeight: 1.75, color: "rgba(241,245,249,0.82)" };
const gridStyle: CSSProperties = { marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 };
const cellStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 12px", background: "rgba(255,255,255,0.02)", minWidth: 0 };
const cellLabelStyle: CSSProperties = { fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(148,163,184,0.62)" };
const cellValueStyle: CSSProperties = { marginTop: 4, fontSize: 14, fontWeight: 800, letterSpacing: "-0.01em", color: "#f1f5f9", overflowWrap: "anywhere" };
const sourceStyle: CSSProperties = { marginTop: 12, fontSize: 11, lineHeight: 1.5, color: "rgba(203,213,225,0.55)" };
