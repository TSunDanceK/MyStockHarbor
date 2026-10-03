import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

import { sectorNewsPath, sectorSlugFromLabel } from "@/lib/sectors";
// TYPE ONLY, AND IT HAS TO STAY THAT WAY. This component is imported by
// StockSymbolPageClient.tsx ("use client"), so it ships to the browser. A value
// import from lib/server would drag secColdFetch -> Redis into the client
// bundle and fail the build — the same rule LatestEarningsCard.tsx carries.
import type { ProfileDividend } from "@/lib/server/secDividend";

// -- Company profile card -----------------------------------------------------
// Server-rendered "About" block, composed from SEC data by lib/server/stockProfile.ts.
// Presentational only (no hooks) so it renders into the crawlable initial HTML.

/**
 * ── STAT ROWS WHOSE SOURCE HAS NOWHERE TO GO. HIDDEN, NOT REMOVED. ────────
 *
 * The owner's standing rule, and the same registry shape as RETIRED_SOURCES in
 * lib/server/secEarningsView.ts. Deleting the rows loses the record of WHY, and
 * the next person to look at a five-row gap in the stat grid re-adds them,
 * wires them to whatever is nearest, and ships a CEO name that is four years
 * out of date.
 *
 * WHAT MAKES THESE FIVE DIFFERENT FROM THE REST OF THE GRID. Sector, industry,
 * market cap, the 52-week range, dividend, exchange, country, IPO date and
 * website all still come from FMP today and all have a free successor to move
 * to — SEC's submissions feed, Tiingo, or the Nasdaq Trader directory. These
 * five have none. Checked 2026-09-21 by the owner across SEC EDGAR, Tiingo and
 * the Nasdaq Trader symbol directory: not one of them carries CEO, employee
 * count, beta, ISIN or CUSIP. (EDGAR files officer names inside DEF 14A prose
 * and employee counts inside 10-K prose — neither is a structured field, and a
 * regex over a proxy statement is not a data source.) So when FMP goes, these
 * rows have no replacement, and they go dark rather than go stale.
 *
 * NOTHING RENDERS IN THEIR PLACE — no dashed "not shown" cell, no dash. That
 * is the reversal already made on the earnings page (see HiddenCard in
 * app/stock/[symbol]/earnings/SecEarningsCards.tsx): a reader who never saw a
 * CEO row is not owed an apology for its absence, and nine stat cards read as
 * a stat grid while nine plus five apologies read as a broken one.
 *
 * THE RECORD IS WHAT STAYS. `HIDDEN_PROFILE_ROWS` names every one, what fed it
 * and when it went dark, and `rows` below is filtered THROUGH it — so hiding a
 * row without registering it, or registering one and leaving it rendering,
 * are both impossible rather than merely discouraged.
 */
export type HiddenProfileRow = {
  /** Exactly the `label` the row renders with. The filter matches on this. */
  label: string;
  /** What used to supply it. */
  source: string;
  /** When it stopped being shown. */
  hiddenOn: string;
  /** Why there is no successor. One sentence. */
  reason: string;
};

export const HIDDEN_PROFILE_ROWS: HiddenProfileRow[] = [
  {
    label: "CEO",
    source: "FMP /stable/profile ceo",
    hiddenOn: "2026-09-21",
    reason:
      "Officer names appear in DEF 14A prose, not as a structured field, and no free " +
      "feed publishes them.",
  },
  {
    label: "Employees",
    source: "FMP /stable/profile fullTimeEmployees",
    hiddenOn: "2026-09-21",
    reason:
      "Headcount appears in 10-K prose, not as an XBRL fact, and no free feed publishes it.",
  },
  {
    label: "Beta",
    source: "FMP /stable/profile beta",
    hiddenOn: "2026-09-21",
    reason:
      "Beta is a vendor-computed statistic over a window the vendor chooses, not a " +
      "filed or listed figure, so there is nothing free to read it from.",
  },
  {
    label: "ISIN",
    source: "FMP /stable/profile isin",
    hiddenOn: "2026-09-21",
    reason: "ISIN assignment is licensed; neither SEC, Tiingo nor Nasdaq Trader carries it.",
  },
  {
    label: "CUSIP",
    source: "FMP /stable/profile cusip",
    hiddenOn: "2026-09-21",
    reason: "CUSIP assignment is licensed; neither SEC, Tiingo nor Nasdaq Trader carries it.",
  },
  {
    label: "IPO date",
    source: "FMP /stable/profile ipoDate",
    hiddenOn: "2026-09-22",
    reason:
      "No free source states a listing date: SEC records filings, not first trades, and " +
      "neither Tiingo's plan nor Nasdaq Trader carries it.",
  },
  {
    label: "Website",
    source: "FMP /stable/profile website",
    hiddenOn: "2026-09-22",
    reason:
      "SEC submissions has a website field but it is blank on most registrants; the " +
      "sec-registrants run reports its coverage, and the owner decides whether it is " +
      "worth showing where present.",
  },
];

const HIDDEN_PROFILE_LABELS = new Set(HIDDEN_PROFILE_ROWS.map((r) => r.label));

/**
 * Drop the registered rows, and REFUSE a registration that matched nothing.
 *
 * ── THE FAILURE THE SECOND HALF EXISTS FOR ────────────────────────────────
 * A Set filter alone is silently tolerant in one direction: register "Beta "
 * with a trailing space, or "Employee count" for a row labelled "Employees",
 * and the filter removes nothing while the registry states the row is hidden.
 * The page then renders the row, the record says it does not, and the two
 * disagree in the direction nobody looks — exactly the shape of the hidden
 * card that rendered anyway, which is why HiddenCard on the earnings page
 * validates its id rather than trusting it (see `retiredSource`).
 *
 * So the registry is checked AGAINST the rows it claims to hide, in the same
 * pass that hides them. Cheap — five lookups over a thirteen-row array — and
 * it turns a silent no-op into a render that fails loudly and immediately.
 */
function applyHiddenRows<T extends { label: string }>(rows: T[]): T[] {
  const present = new Set(rows.map((r) => r.label));
  for (const label of HIDDEN_PROFILE_LABELS) {
    if (!present.has(label)) {
      throw new Error(
        `HIDDEN_PROFILE_ROWS registers "${label}", which no stat row builds. ` +
          `Hiding it removes nothing and the registry is claiming otherwise.`
      );
    }
  }
  return rows.filter((r) => !HIDDEN_PROFILE_LABELS.has(r.label));
}

/** Where one part of the block came from, for the attribution line. */
export type ProfileSource = { field: string; source: string };

export type CompanyProfile = {
  companyName: string | null;
  /** Paragraphs separated by a blank line ("\n\n"). */
  description: string | null;
  /**
   * Where the description came from, shown under it: "From Apple Inc.'s
   * 10-K, filed Oct 2025" (lib/server/filingDescription.ts). Null or absent
   * shows no line.
   */
  descriptionAttribution?: string | null;
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
  /**
   * Per-field attribution, composed server-side (lib/server/stockProfile.ts).
   * Absent on a profile built the old way; the line then names no source.
   */
  sources?: ProfileSource[];
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
  dividend: dividendRow,
  belowDescription,
  belowStats,
}: {
  profile: CompanyProfile;
  symbol: string;
  /**
   * The Dividend row, from the company's own filings.
   *
   * RESOLVED ON THE SERVER, passed as plain data. See the type-only import
   * note above: this component cannot reach lib/server at runtime.
   */
  dividend: ProfileDividend;
  // Optional extra content (the share-dilution chart) rendered FULL WIDTH
  // under the description and the floated stat sidebar (#552 COWORK #88 §1).
  // On phones it follows the description, before the stat boxes.
  belowDescription?: ReactNode;
  // Optional extra content (the "Learn the indicators" links) rendered FULL
  // WIDTH under the dilution chart (#552 COWORK #88 §1). Last in the reading
  // order on every breakpoint.
  belowStats?: ReactNode;
}) {
  const name = profile.companyName || symbol;

  // ── THE DIVIDEND ROW, ON FILINGS SINCE 2026-09-21 ──────────────────────
  //
  // WAS: `profile.lastDividend` from FMP, rendered "Yes · $0.26" or "No".
  // Both halves were doing something the filings will not support — see the
  // docblock on ProfileDividend in lib/server/secDividend.ts. The short of it:
  // FMP's field carried no period, so a dividend declared two years ago read
  // exactly like last quarter's; and "No" was asserted from the field being
  // empty, which is a claim about the company made from a gap in the data.
  //
  // `profile.lastDividend` IS DELIBERATELY STILL ON THE TYPE and still parsed
  // by fetchCompanyProfile. Hidden, not removed: deleting it loses the record
  // that this row ever had another source, and the field costs nothing — it
  // arrives in a profile payload the page fetches anyway.
  //
  // THE PERIOD IS PART OF THE VALUE, not a decoration. A per-share dividend
  // with no period attached is the defect above wearing a new source.
  const dividendValue =
    dividendRow.state === "declared"
      ? `${fmtMoney2(dividendRow.perShare)} · ${dividendRow.periodLabel}`
      : null;

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
  const allRows: Array<{
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
    // A NULL VALUE DROPS THE ROW, via the `r.value` filter below. That is the
    // hide, and it is PER SYMBOL rather than site-wide: HIDDEN_PROFILE_ROWS is
    // a claim about a row on every page, and "this filer publishes no
    // per-share dividend tag" is a claim about one filer. The reason it is
    // hidden for is carried on the payload (ProfileDividend.why) so a probe
    // can read it even though nothing renders it.
    { label: "Dividend", value: dividendValue },
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
  ];

  // THE REGISTRY IS THE FILTER, not a comment beside one. Every row above keeps
  // its entry and its formatter — that is what "hidden, not removed" means
  // here — and is dropped on the way to render by its presence in
  // HIDDEN_PROFILE_ROWS. Delete an entry from the registry and its row comes
  // straight back. There is no second list to keep in step, and no way to
  // register a row without hiding it (see applyHiddenRows).
  //
  // BEFORE THE `r.value` FILTER, NOT AFTER, and the order is load-bearing.
  // applyHiddenRows refuses a registration that matches no row; run it over
  // the already-value-filtered list and every symbol whose CEO field FMP
  // happens to return empty — a real and common case — throws a page-breaking
  // error instead of rendering. The registry is a claim about the rows this
  // component BUILDS, so it has to be checked against all of them.
  const rows = applyHiddenRows(allRows).filter((r) => r.value);

  const hasDescription = Boolean(profile.description);
  const hasRows = rows.length > 0;
  const hasAnything = hasDescription || hasRows;
  if (!hasAnything) return null;

  // THE COMPANY'S OWN WORDS, one <p> per paragraph (the cleaner keeps at most
  // two), with its attribution line under them. A single wrapper carries the
  // cp-desc class so the mobile reading order is unchanged.
  // NO DESCRIPTION IS SAID, NEVER LEFT AS A GAP (#552 COWORK #57): a filer
  // whose annual report yields no usable opening (data/sec/descriptions.json
  // `misses`) gets one neutral line in the same place, not an empty column.
  const descriptionBlock = hasDescription ? (
    <div className="cp-desc">
      {String(profile.description).split(/\n{2,}/).map((para, i) => (
        <p key={i} style={i === 0 ? descStyle : { ...descStyle, marginTop: 12 }}>{para}</p>
      ))}
      {profile.descriptionAttribution ? (
        <p style={descAttributionStyle}>{profile.descriptionAttribution}</p>
      ) : null}
    </div>
  ) : (
    <div className="cp-desc">
      <p style={descAttributionStyle}>{NO_DESCRIPTION_LINE}</p>
    </div>
  );

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

      {/* THE LAYOUT (#552 COWORK #88 §1, the owner's ruling; the "full-width
          restack" fallback the original layout note named):

            desktop: the description, with the stat boxes FLOATED right
                     (260px) beside it; then a clear; then the dilution chart
                     FULL WIDTH; then "Learn the indicators" FULL WIDTH.
            phones:  description → dilution → stat boxes (2-up) → learn links.

          The chart used to sit in the narrower flow column beside the float,
          which left a gap under short descriptions (PAC) and a cramped chart
          beside long ones (AAPL). A full-width block after the clear cannot
          leave a gap at any description length.

          Mobile: the float is dropped and the container becomes a flex
          column, with `order` restoring the reading order, since the stat
          boxes have to come first in the DOM for the float to work.

          NB: the CSS block at the bottom of this file is a template literal —
          no backticks in its comments, or the literal closes early and the
          build fails to parse. */}
      {hasDescription && hasRows ? (
        <div className="cp-flow">
          <div className="cp-stats">
            {statBoxes}
          </div>
          {descriptionBlock}
          <div className="cp-clear" />
          {belowDescription ? <div className="cp-full cp-full-chart">{belowDescription}</div> : null}
          {belowStats ? <div className="cp-full cp-full-learn">{belowStats}</div> : null}
        </div>
      ) : hasDescription ? (
        <>
          {descriptionBlock}
          {belowDescription}
          {belowStats}
        </>
      ) : (
        <>
          {descriptionBlock}
          <div style={gridStyle} className="cp-grid-fallback">{statBoxes}</div>
          {belowDescription}
          {belowStats}
        </>
      )}

      {/* PER-ROW ATTRIBUTION. This said "Company profile data from Financial
          Modeling Prep" for every row; no row comes from FMP now (PR 2 moved
          the rows, PR 3 the description, which carries its own line under
          the paragraph). The sources are the ones the composer actually used
          for THIS symbol, so a row that hid does not get credited. */}
      <div style={sourceStyle}>
        {profile.sources?.length
          ? `${profile.sources.map((s) => `${s.field}: ${s.source}`).join(" · ")}.`
          : null}
        {profile.exchange ? ` ${symbol} is listed on ${profile.exchange}.` : null}
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
        /* Ends the float: everything after it runs the full width. */
        .cp-clear { clear: both; }
        /* The chart and the learn links, full width, one after the other. */
        .cp-full { display: block; }
        .cp-full-learn { margin-top: 24px; }

        @media (max-width: 720px) {
          .cp-flow {
            display: flex !important;
            flex-direction: column !important;
            gap: 18px !important;
          }
          /* DOM order is stats-first (float requirement); restore the
             reading order description → dilution → stats → learn links. */
          .cp-desc { order: 1; }
          .cp-full-chart { order: 2; }
          .cp-stats { order: 3; }
          .cp-full-learn { order: 4; margin-top: 0 !important; }
          .cp-clear { display: none !important; }
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
/** Shown where the filing gives no usable description (#552 COWORK #57). */
export const NO_DESCRIPTION_LINE = "Description not available from the filing.";
const descStyle: CSSProperties = { margin: 0, fontSize: 16, lineHeight: 1.75, color: "rgba(241,245,249,0.82)" };
const descAttributionStyle: CSSProperties = { margin: "10px 0 0", fontSize: 12, lineHeight: 1.5, fontStyle: "italic", color: "rgba(148,163,184,0.72)" };
const gridStyle: CSSProperties = { marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 };
const cellStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 12px", background: "rgba(255,255,255,0.02)", minWidth: 0 };
const cellLabelStyle: CSSProperties = { fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(148,163,184,0.62)" };
const cellValueStyle: CSSProperties = { marginTop: 4, fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em", color: "#f1f5f9", overflowWrap: "anywhere" };
const sourceStyle: CSSProperties = { marginTop: 12, fontSize: 11, lineHeight: 1.5, color: "rgba(203,213,225,0.55)" };
