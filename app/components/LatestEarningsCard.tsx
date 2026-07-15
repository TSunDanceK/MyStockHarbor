import Link from "next/link";
import type { CSSProperties } from "react";

// ── Shared "Earnings snapshot" card ──────────────────────────────────────────
// Extracted from the stock News page so the main stock page, the News page and
// (later) the Earnings page can all render one consistent earnings snapshot from
// the same /api/stock-earnings payload. Presentational only — no client hooks —
// so it renders inside server components (SSR HTML, good for indexing) and inside
// client components alike.

export type ScoreTone = "green" | "yellow" | "red";

export type EarningsPeriodSummary = {
  label: string;
  date: string | null;
  tone: ScoreTone;
  toneLabel: "Good" | "Neutral" | "Weak";
  actualEps: number | null;
  estimatedEps: number | null;
  epsSurprisePercent: number | null;
  revenueSurprisePercent: number | null;
};

export type EarningsYearSummary = {
  year: string;
  tone: ScoreTone;
  toneLabel: "Good" | "Neutral" | "Weak";
  goodCount: number;
  neutralCount: number;
  weakCount: number;
};

// A superset of the /api/stock-earnings payload. fiscalDate / guidanceSummary /
// score are optional so the raw API response satisfies this type directly.
export type LatestEarningsData = {
  hasStructuredData: boolean;
  tone: ScoreTone;
  toneLabel: "Good" | "Neutral" | "Weak" | "Unavailable";
  score?: number | null;
  reportDate: string | null;
  fiscalDate?: string | null;
  actualEps: number | null;
  estimatedEps: number | null;
  epsSurprise: number | null;
  epsSurprisePercent: number | null;
  revenue: number | null;
  revenueEstimate: number | null;
  revenueSurprise: number | null;
  revenueSurprisePercent: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netIncome: number | null;
  guidanceSummary?: string | null;
  nextEarningsDate: string | null;
  recentReports: EarningsPeriodSummary[];
  yearlySummaries: EarningsYearSummary[];
  sourceNote: string;
};

// ── Formatters ───────────────────────────────────────────────────────────────

function formatMoney(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toFixed(2)}`
    : "—";
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatLargeMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000)
    return `${sign}$${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000)
    return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatPlainDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function metricTone(value: number | null | undefined): ScoreTone | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value > 0) return "green";
  if (value < 0) return "red";
  return "yellow";
}

// ── Card ─────────────────────────────────────────────────────────────────────

export default function LatestEarningsCard({
  earnings,
  symbol,
}: {
  earnings: LatestEarningsData;
  symbol: string;
}) {
  const toneCopy = earnings.hasStructuredData ? earnings.toneLabel : "Unavailable";
  return (
    <section style={earningsCardStyle(earnings.tone)}>
      <div style={sectionEyebrowStyle}>Latest earnings</div>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ ...sectionTitleSmallStyle, margin: 0 }}>Earnings snapshot</h2>
        <div style={earningsTonePillStyle(earnings.tone)}>{toneCopy}</div>
      </div>
      {!earnings.hasStructuredData ? (
        <p style={bodyCopyStyle}>
          Structured EPS and revenue data is not available for this symbol right
          now. The page will show the latest reported earnings here when FMP
          returns usable data.
        </p>
      ) : (
        <>
          <div style={earningsDateRowStyle}>
            <div>
              <div style={earningsMiniLabelStyle}>Latest report</div>
              <div style={earningsMiniValueStyle}>{formatPlainDate(earnings.reportDate)}</div>
            </div>
            <div>
              <div style={earningsMiniLabelStyle}>Next earnings</div>
              <div style={earningsMiniValueStyle}>{formatPlainDate(earnings.nextEarningsDate)}</div>
            </div>
          </div>
          <div style={earningsMetricGridStyle}>
            <EarningsMetric label="Actual EPS" value={formatMoney(earnings.actualEps)} />
            <EarningsMetric label="Estimated EPS" value={formatMoney(earnings.estimatedEps)} />
            <EarningsMetric label="EPS surprise" value={formatMoney(earnings.epsSurprise)} meta={formatPercent(earnings.epsSurprisePercent, 1)} tone={metricTone(earnings.epsSurprisePercent)} />
            <EarningsMetric label="Revenue" value={formatLargeMoney(earnings.revenue)} />
            <EarningsMetric label="Revenue estimate" value={formatLargeMoney(earnings.revenueEstimate)} />
            <EarningsMetric label="Revenue surprise" value={formatLargeMoney(earnings.revenueSurprise)} meta={formatPercent(earnings.revenueSurprisePercent, 1)} tone={metricTone(earnings.revenueSurprisePercent)} />
            <EarningsMetric label="Gross margin" value={formatPercent(earnings.grossMargin, 1)} />
            <EarningsMetric label="Operating margin" value={formatPercent(earnings.operatingMargin, 1)} />
            <EarningsMetric label="Net income" value={formatLargeMoney(earnings.netIncome)} />
            <Link
              href={`/stock/${encodeURIComponent(symbol)}/earnings`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 82,
                borderRadius: 14,
                border: "1px solid rgba(59,130,246,0.32)",
                background:
                  "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(15,23,42,0.30))",
                color: "#dbeafe",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 950,
                letterSpacing: "0.02em",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
              }}
            >
              See full report →
            </Link>
          </div>
          {earnings.recentReports.length ? (
            <div style={earningsTrendBoxStyle}>
              <div style={earningsMiniLabelStyle}>Recent earnings trend</div>
              <div style={earningsDotRowStyle}>
                {[...earnings.recentReports].reverse().map((item) => (
                  <div key={`${item.label}-${item.date}`} style={earningsDotItemStyle}>
                    <span style={earningsDotStyle(item.tone)} />
                    <span style={earningsDotLabelStyle}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {earnings.yearlySummaries.length ? (
            <div style={earningsTrendBoxStyle}>
              <div style={earningsMiniLabelStyle}>Yearly earnings read</div>
              <div style={yearlyEarningsGridStyle}>
                {earnings.yearlySummaries.map((item) => (
                  <div key={item.year} style={yearlyEarningsBadgeStyle(item.tone)}>
                    <strong>{item.year}</strong>
                    <span>{item.toneLabel}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
      <div style={earningsSourceStyle}>{earnings.sourceNote}</div>
    </section>
  );
}

function EarningsMetric({
  label,
  value,
  meta,
  tone,
}: {
  label: string;
  value: string;
  meta?: string;
  tone?: ScoreTone;
}) {
  return (
    <div style={earningsMetricStyle(tone)}>
      <div style={earningsMiniLabelStyle}>{label}</div>
      <div style={earningsMetricValueStyle}>{value}</div>
      {meta && meta !== "—" ? <div style={earningsMetricMetaStyle(tone)}>{meta}</div> : null}
    </div>
  );
}

// ── Styles (mirrored from the News page's earnings card) ─────────────────────

const sectionEyebrowStyle: CSSProperties = { fontSize: 11, fontWeight: 950, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(147,197,253,0.82)" };
const sectionTitleSmallStyle: CSSProperties = { margin: "8px 0 0 0", fontSize: 22, lineHeight: 1.12, letterSpacing: "-0.03em" };
const bodyCopyStyle: CSSProperties = { margin: "14px 0 0 0", fontSize: 15, lineHeight: 1.72, color: "rgba(241,245,249,0.82)" };

function earningsCardStyle(tone: ScoreTone): CSSProperties {
  const toneMap = {
    green: { border: "rgba(34,197,94,0.24)", bg: "linear-gradient(135deg, rgba(34,197,94,0.09), rgba(255,255,255,0.022))" },
    yellow: { border: "rgba(250,204,21,0.24)", bg: "linear-gradient(135deg, rgba(250,204,21,0.09), rgba(255,255,255,0.022))" },
    red: { border: "rgba(239,68,68,0.26)", bg: "linear-gradient(135deg, rgba(239,68,68,0.10), rgba(255,255,255,0.022))" },
  } as const;
  return { border: `1px solid ${toneMap[tone].border}`, borderRadius: 20, padding: 18, background: toneMap[tone].bg, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" };
}

function earningsTonePillStyle(tone: ScoreTone): CSSProperties {
  const toneMap = {
    green: { border: "rgba(34,197,94,0.32)", color: "#bbf7d0", bg: "rgba(34,197,94,0.12)" },
    yellow: { border: "rgba(250,204,21,0.32)", color: "#fde68a", bg: "rgba(250,204,21,0.12)" },
    red: { border: "rgba(239,68,68,0.34)", color: "#fecaca", bg: "rgba(239,68,68,0.13)" },
  } as const;
  return { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "7px 10px", borderRadius: 999, border: `1px solid ${toneMap[tone].border}`, background: toneMap[tone].bg, color: toneMap[tone].color, fontSize: 12, fontWeight: 950, textTransform: "uppercase", letterSpacing: "0.06em" };
}

const earningsDateRowStyle: CSSProperties = { marginTop: 14, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 };
const earningsMetricGridStyle: CSSProperties = { marginTop: 14, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 };

function earningsMetricStyle(tone?: ScoreTone): CSSProperties {
  const toneBorder = tone === "green" ? "rgba(34,197,94,0.22)" : tone === "red" ? "rgba(239,68,68,0.24)" : tone === "yellow" ? "rgba(250,204,21,0.22)" : "rgba(255,255,255,0.08)";
  return { border: `1px solid ${toneBorder}`, borderRadius: 14, padding: 12, background: "rgba(2,6,23,0.30)", minWidth: 0 };
}

const earningsMiniLabelStyle: CSSProperties = { fontSize: 10, fontWeight: 950, letterSpacing: "0.09em", textTransform: "uppercase", color: "rgba(203,213,225,0.72)" };
const earningsMiniValueStyle: CSSProperties = { marginTop: 5, fontSize: 14, fontWeight: 900, color: "#f8fafc" };
const earningsMetricValueStyle: CSSProperties = { marginTop: 6, fontSize: 18, lineHeight: 1.08, fontWeight: 950, letterSpacing: "-0.035em", color: "#f8fafc" };

function earningsMetricMetaStyle(tone?: ScoreTone): CSSProperties {
  return { marginTop: 5, fontSize: 12, fontWeight: 850, color: tone === "green" ? "#86efac" : tone === "red" ? "#fca5a5" : "rgba(226,232,240,0.70)" };
}

const earningsTrendBoxStyle: CSSProperties = { marginTop: 14, borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.035)", padding: 12 };
const earningsDotRowStyle: CSSProperties = { marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" };
const earningsDotItemStyle: CSSProperties = { display: "grid", gap: 6, justifyItems: "center", minWidth: 46 };
const earningsDotLabelStyle: CSSProperties = { fontSize: 11, color: "rgba(226,232,240,0.78)", fontWeight: 850 };

function earningsDotStyle(tone: ScoreTone): CSSProperties {
  const color = tone === "green" ? "#2dd4bf" : tone === "red" ? "#fb7185" : "#fbbf24";
  return { width: 15, height: 15, borderRadius: 999, background: color, boxShadow: `0 0 0 5px ${color}22` };
}

const yearlyEarningsGridStyle: CSSProperties = { marginTop: 10, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 };

function yearlyEarningsBadgeStyle(tone: ScoreTone): CSSProperties {
  const border = tone === "green" ? "rgba(34,197,94,0.32)" : tone === "red" ? "rgba(244,63,94,0.34)" : "rgba(250,204,21,0.30)";
  const background = tone === "green" ? "rgba(34,197,94,0.10)" : tone === "red" ? "rgba(244,63,94,0.10)" : "rgba(250,204,21,0.10)";
  const color = tone === "green" ? "#dcfce7" : tone === "red" ? "#ffe4e6" : "#fef9c3";
  return { border: `1px solid ${border}`, background, color, borderRadius: 12, padding: "9px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, fontWeight: 850 };
}

const earningsSourceStyle: CSSProperties = { marginTop: 12, fontSize: 11, lineHeight: 1.5, color: "rgba(203,213,225,0.58)" };
