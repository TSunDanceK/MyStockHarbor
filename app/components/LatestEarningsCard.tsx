import Link from "next/link";
import type { CSSProperties } from "react";

import type {
  SecEarningsSnapshot, SnapshotFigure, SnapshotNextReport, SnapshotPct,
} from "@/lib/server/secEarningsSnapshot";

// ── Shared "Earnings snapshot" card ──────────────────────────────────────────
// Rendered in the sidebar of /stock/[symbol] and /stock/[symbol]/news.
// Presentational only — no client hooks — so it renders inside server
// components (SSR HTML, good for indexing) and inside client components alike.
//
// ── ON SEC FILINGS SINCE 2026-09-21 ──────────────────────────────────────────
// This used to take `LatestEarningsData` from lib/latest-earnings-data.ts:
// FMP's stable/earnings rows plus an income statement, with an estimate and a
// surprise beside every actual. It now takes `SecEarningsSnapshot`, built in
// lib/server/secEarningsSnapshot.ts from the same stored fact sets and the same
// scorer that power /stock/[symbol]/earnings. What went and why is recorded in
// RETIRED_SNAPSHOT_FIELDS there — hidden, not removed, per the owner's rule.
//
// TYPE-ONLY IMPORT, AND IT HAS TO STAY THAT WAY. This module is pulled into
// StockSymbolPageClient.tsx, which is "use client", so it ships to the browser.
// `import type` erases at compile time; a value import from lib/server would
// drag secEarningsView → secCurrency → fxRates → Redis into the client bundle
// and fail the build. Everything below formats numbers and strings the server
// already resolved.

export type { SecEarningsSnapshot };

// ── Formatters ───────────────────────────────────────────────────────────────

/**
 * Money, with per-share figures held to two decimals.
 *
 * THE TRAILING ZERO IS NOT OPTIONAL. `maximumFractionDigits: 2` renders a filed
 * EPS of 4.30 as "$4.3" and 4.50 as "$4.5" — found on TSLA FY2023 and AZN
 * FY2024, and the reason ViewCell carries `perShare` at all (see its docblock
 * in lib/server/secEarningsView.ts). A price-like figure printed to one decimal
 * reads as a different number, and "$4.3" is not how anyone writes money.
 */
function formatFigure(f: SnapshotFigure) {
  const v = f.value;
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (f.perShare) return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000) return `${sign}$${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/**
 * A CHANGE, which is why it carries its sign. Growth only.
 *
 * The leading "+" is the whole difference between this and formatLevel below,
 * and putting it on the wrong one is not cosmetic: "+50.1%" under the label
 * "Gross margin" reads as a margin that ROSE by fifty points, which would be
 * extraordinary, rather than a margin that IS fifty percent, which is ordinary
 * for Apple. The old card used this formatter for both and shipped the first
 * reading on every stock on the site.
 */
function formatGrowth(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

/** A LEVEL. No sign on a positive — a margin of 50% is not "+50%". */
function formatLevel(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
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

/**
 * A growth figure as text, INCLUDING the case that is not a number.
 *
 * A crossing ("turned profitable", "swung to a loss") is the view refusing to
 * divide across a sign change, and it must not collapse to "—": an absence
 * reads as "we don't know", where the truth is "we know exactly what happened
 * and a percentage would misdescribe it". See SnapshotPct.
 */
function growthText(p: SnapshotPct): string | null {
  if (p.kind === "pct") return formatGrowth(p.value);
  if (p.kind === "crossing") return p.words;
  return null;
}

/** Sign tone for a growth figure. A crossing gets none — it is not a magnitude. */
function growthTone(p: SnapshotPct): ToneKey | undefined {
  if (p.kind !== "pct") return undefined;
  if (p.value > 0) return "good";
  if (p.value < 0) return "weak";
  return "neutral";
}

/**
 * The next report, as the finished sentence the server composed.
 *
 * NO FORMATTING HAPPENS HERE, and that is the point. This used to format
 * estimateNextReport's day ("22 Oct 2026") or print its month; the owner's
 * 2026-09-23 ruling is that the 30-day band is the only forward claim on the
 * site, so the headline and hedge come from lib/server/symbolOutlook.ts — the
 * same words the /earnings-calendar search and the earnings page's card use.
 */
function nextReportText(n: SnapshotNextReport): string {
  return n.headline || "—";
}

// ── Tone ─────────────────────────────────────────────────────────────────────

/**
 * ONE VOCABULARY FOR THE VERDICT, keyed the way the scorer keys it.
 *
 * These were "green" | "yellow" | "red" — the paint, used as the name of the
 * judgement. That is how a page ends up with a pill reading "Good" above a
 * gauge labelled "Strong" (see the SCORE_BANDS docblock in
 * lib/server/secEarningsScore.ts): two vocabularies for one scale, and no
 * compiler able to tell they have drifted. The card now speaks the scorer's
 * own words and paints them locally.
 *
 * THE PAINT IS LOCAL ON PURPOSE and is not a second copy of toneColor(). Those
 * are the gauge's solid accents; these are a card's gradients, borders and pill
 * fills, and they are alpha variants of the SAME rgb triples — 34,197,94 /
 * 250,204,21 / 239,68,68. A card cannot import secPresentation anyway (it is
 * server-only, see the note at the top), so what keeps them together is that
 * neither side owns a colour the other does not.
 */
type ToneKey = "good" | "neutral" | "weak";

const TONE_RGB: Record<ToneKey, string> = {
  good: "34,197,94",
  neutral: "250,204,21",
  weak: "239,68,68",
};

const TONE_TEXT: Record<ToneKey, string> = {
  good: "#86efac",
  neutral: "#fde68a",
  weak: "#fca5a5",
};

// ── Card ─────────────────────────────────────────────────────────────────────

export default function LatestEarningsCard({
  snapshot,
  symbol,
}: {
  snapshot: SecEarningsSnapshot;
  symbol: string;
}) {
  const tone = snapshot.tone;
  // A PARTIAL SCORE CARRIES NO VERDICT COLOUR — the full report's rule, applied
  // here from the same coverageOf. The card and the pill both go grey, as they
  // do when the score did not run at all, because in both cases the hue would
  // be a claim the filings did not support.
  const verdict = snapshot.available && !snapshot.partial;
  return (
    <section style={earningsCardStyle(tone, verdict)}>
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
        <div style={earningsTonePillStyle(tone, verdict)}>{snapshot.toneLabel}</div>
      </div>
      {snapshot.partialNote ? <div style={earningsFootnoteStyle}>{snapshot.partialNote}</div> : null}

      {!snapshot.available ? (
        // THE REASON, NOT A GRID OF EM DASHES. `unavailableReason` is the same
        // sentence /stock/[symbol]/earnings prints for the same symbol, which
        // is the point of taking it from the scorer rather than writing a
        // second one here: a reader who clicks through gets the same answer.
        <p style={bodyCopyStyle}>{snapshot.unavailableReason}</p>
      ) : (
        <>
          <div style={earningsDateRowStyle}>
            <div>
              <div style={earningsMiniLabelStyle}>Latest report</div>
              <div style={earningsMiniValueStyle}>{formatPlainDate(snapshot.reportedOn)}</div>
              {/* WHICH EVENT THAT DATE IS. An 8-K Item 2.02 announcement and a
                  10-Q acceptance are different days, often several apart, and
                  printing either as a bare "latest report" invites a reader to
                  compare one symbol's announcement against another's filing. */}
              <div style={earningsMiniSubStyle}>
                {snapshot.reportedVia === "announcement"
                  ? snapshot.reportedTimingNote ?? "Announced by the company"
                  : snapshot.reportedVia === "filing"
                    ? "Filed with the SEC"
                    : ""}
              </div>
            </div>
            <div>
              <div style={earningsMiniLabelStyle}>Next earnings</div>
              <div style={earningsMiniSentenceStyle}>{nextReportText(snapshot.nextReport)}</div>
              {/* NOT A FORECAST, AND THE CARD SAYS SO. The hedge (or, for a
                  refusal, its named reason) is the search's own line. Null
                  only for the filed-fact "due" answer and the outage one,
                  which are not estimates. */}
              {snapshot.nextReport.hedge ? (
                <div style={earningsMiniSubStyle}>{snapshot.nextReport.hedge}</div>
              ) : null}
            </div>
          </div>

          {/* THE PERIOD THESE FIGURES ARE FOR. The old card had no period line
              at all: every figure was captioned "Actual EPS" with nothing
              saying which quarter, so a stale fact set rendered identically to
              a current one. */}
          <div style={periodLineStyle}>
            {snapshot.periodLabel}
            {snapshot.periodEnd ? ` · period ending ${formatPlainDate(snapshot.periodEnd)}` : ""}
          </div>
          {/* WHERE THE NEWEST PERIOD CAME FROM, OR WHY IT IS NOT HERE. Both are
              filed facts about SEC's data feed, not about the company; the
              words are built once in secEarningsView so this tile and the
              earnings card cannot say different things. */}
          {snapshot.filingCredit ? (
            <div style={earningsMiniSubStyle}>{snapshot.filingCredit}</div>
          ) : null}
          {snapshot.filingNotice ? (
            <div style={earningsMiniSubStyle}>{snapshot.filingNotice}</div>
          ) : null}

          <div style={earningsMetricGridStyle}>
            {/* A BLANK TILE SAYS WHY, in the meta slot where growth would sit.
                The reason is the payload's (emptyReason / marginReasons) —
                the card never guesses one. */}
            <EarningsMetric
              label={snapshot.basis === "year" ? "EPS (diluted, FY)" : "EPS (diluted)"}
              value={formatFigure(snapshot.eps)}
              meta={snapshot.eps.emptyReason ?? growthText(snapshot.epsYoY)}
              tone={snapshot.eps.emptyReason ? undefined : growthTone(snapshot.epsYoY)}
              note={
                // THE FULL YEAR, LABELLED AS THE FULL YEAR. Only ever set under
                // a blank derived-Q4 tile; never presented as the quarter's.
                snapshot.epsFullYear
                  ? `${snapshot.epsFullYear.label}: ${formatFigure({ value: snapshot.epsFullYear.value, perShare: true, derivedNote: null, emptyReason: null })}`
                  : snapshot.eps.derivedNote
              }
            />
            <EarningsMetric
              label="Revenue"
              value={formatFigure(snapshot.revenue)}
              meta={snapshot.revenue.emptyReason ?? growthText(snapshot.revenueYoY)}
              tone={snapshot.revenue.emptyReason ? undefined : growthTone(snapshot.revenueYoY)}
              note={snapshot.revenue.derivedNote}
            />
            <EarningsMetric
              label="Net income"
              value={formatFigure(snapshot.netIncome)}
              meta={snapshot.netIncome.emptyReason}
              note={snapshot.netIncome.derivedNote}
            />
            <EarningsMetric label="Gross margin" value={formatLevel(snapshot.margins.gross)} meta={snapshot.marginReasons.gross} />
            <EarningsMetric label="Operating margin" value={formatLevel(snapshot.margins.operating)} meta={snapshot.marginReasons.operating} />
            <EarningsMetric label="Net margin" value={formatLevel(snapshot.margins.net)} meta={snapshot.marginReasons.net} />
          </div>

          {/* WHAT THE PERCENTAGES ARE MEASURED AGAINST. A "+12.4%" with no
              comparison period is not checkable, and the comparison is not
              always the obvious one — a filer with a gap in its filings is
              compared against the nearest prior-year period on file, which may
              not be four quarters back. */}
          {/* Only when a growth figure actually prints: on a card whose two
              growth slots both carry an empty reason, the sentence describes
              a comparison nothing on screen makes. */}
          {snapshot.comparedWith &&
          (snapshot.epsYoY.kind !== "none" || snapshot.revenueYoY.kind !== "none") ? (
            <div style={earningsFootnoteStyle}>
              Growth is measured against {snapshot.comparedWith}.
            </div>
          ) : null}
          {snapshot.currencyNote ? (
            <div style={earningsFootnoteStyle}>{snapshot.currencyNote}</div>
          ) : null}

          <Link
            href={`/stock/${encodeURIComponent(symbol)}/earnings`}
            style={fullReportLinkStyle}
          >
            See full report →
          </Link>
        </>
      )}
      <div style={earningsSourceStyle}>{snapshot.sourceNote}</div>
    </section>
  );
}

function EarningsMetric({
  label,
  value,
  meta,
  tone,
  note,
}: {
  label: string;
  value: string;
  meta?: string | null;
  tone?: ToneKey;
  note?: string | null;
}) {
  return (
    <div style={earningsMetricStyle(tone)}>
      <div style={earningsMiniLabelStyle}>{label}</div>
      <div style={earningsMetricValueStyle}>{value}</div>
      {meta && meta !== "—" ? <div style={earningsMetricMetaStyle(tone)}>{meta}</div> : null}
      {/* HOW THE NUMBER WAS ARRIVED AT, where it was not simply filed. A
          differenced quarterly cash figure or a computed margin is not the
          same claim as an as-filed one, and the full report marks them, so
          the sidebar does too rather than presenting all four alike. */}
      {note ? <div style={earningsMetricNoteStyle}>{note}</div> : null}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const sectionEyebrowStyle: CSSProperties = { fontSize: 11, fontWeight: 950, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(147,197,253,0.82)" };
const sectionTitleSmallStyle: CSSProperties = { margin: "8px 0 0 0", fontSize: 22, lineHeight: 1.12, letterSpacing: "-0.03em" };
const bodyCopyStyle: CSSProperties = { margin: "14px 0 0 0", fontSize: 15, lineHeight: 1.72, color: "rgba(241,245,249,0.82)" };

/**
 * The card's own frame.
 *
 * TAKES `available` FOR THE SAME REASON THE PILL DOES. The first version keyed
 * only on `tone`, and the scorer's refusal branch returns "neutral" because
 * its type needs a tone — so a stock the site cannot score drew an amber card
 * with a grey pill on it. The pill said "Unavailable" and everything around it
 * said "Mixed". Colour on a finance page is a claim, and half a claim is worse
 * than none: a reader scanning for the amber-bordered cards finds the ones
 * with no data among them.
 */
function earningsCardStyle(tone: ToneKey, verdict: boolean): CSSProperties {
  const rgb = verdict ? TONE_RGB[tone] : "148,163,184";
  return {
    border: `1px solid rgba(${rgb},0.25)`,
    borderRadius: 20,
    padding: 18,
    background: `linear-gradient(135deg, rgba(${rgb},0.09), rgba(255,255,255,0.022))`,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
}

/**
 * The pill.
 *
 * AN UNAVAILABLE VERDICT IS NOT A NEUTRAL ONE. `tone` is "neutral" on the
 * scorer's unavailable branch because its shape requires a tone, and painting
 * that pill the same amber as a genuine Mixed reading would present "we could
 * not measure this" as "we measured it and it was middling". It renders grey.
 *
 * `verdict` IS "available AND not partial". A partial score is the same shape of
 * problem one step removed: ABVX's reach was 34 to 66, wholly inside MIXED, so
 * an amber pill reported the missing inputs, not the company.
 */
function earningsTonePillStyle(tone: ToneKey, verdict: boolean): CSSProperties {
  const rgb = verdict ? TONE_RGB[tone] : "148,163,184";
  const color = verdict ? TONE_TEXT[tone] : "rgba(226,232,240,0.78)";
  return { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "7px 10px", borderRadius: 999, border: `1px solid rgba(${rgb},0.34)`, background: `rgba(${rgb},0.12)`, color, fontSize: 12, fontWeight: 950, textTransform: "uppercase", letterSpacing: "0.06em" };
}

const earningsDateRowStyle: CSSProperties = { marginTop: 14, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 };
const earningsMetricGridStyle: CSSProperties = { marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 };

function earningsMetricStyle(tone?: ToneKey): CSSProperties {
  const border = tone ? `rgba(${TONE_RGB[tone]},0.23)` : "rgba(255,255,255,0.08)";
  return { border: `1px solid ${border}`, borderRadius: 14, padding: 12, background: "rgba(2,6,23,0.30)", minWidth: 0 };
}

const earningsMiniLabelStyle: CSSProperties = { fontSize: 10, fontWeight: 950, letterSpacing: "0.09em", textTransform: "uppercase", color: "rgba(203,213,225,0.72)" };
const earningsMiniValueStyle: CSSProperties = { marginTop: 5, fontSize: 14, fontWeight: 900, color: "#f8fafc" };
/** A sentence, not a date, so it wraps and sits a notch lighter than a value. */
const earningsMiniSentenceStyle: CSSProperties = { marginTop: 5, fontSize: 13, lineHeight: 1.35, fontWeight: 800, color: "#f8fafc" };
const earningsMiniSubStyle: CSSProperties = { marginTop: 3, fontSize: 11, lineHeight: 1.4, color: "rgba(203,213,225,0.58)" };
const earningsMetricValueStyle: CSSProperties = { marginTop: 6, fontSize: 18, lineHeight: 1.08, fontWeight: 950, letterSpacing: "-0.035em", color: "#f8fafc" };
const earningsMetricNoteStyle: CSSProperties = { marginTop: 4, fontSize: 10, lineHeight: 1.4, color: "rgba(203,213,225,0.55)" };
const periodLineStyle: CSSProperties = { marginTop: 14, fontSize: 12, fontWeight: 800, letterSpacing: "0.01em", color: "rgba(226,232,240,0.72)" };
const earningsFootnoteStyle: CSSProperties = { marginTop: 10, fontSize: 11, lineHeight: 1.5, color: "rgba(203,213,225,0.62)" };

function earningsMetricMetaStyle(tone?: ToneKey): CSSProperties {
  return { marginTop: 5, fontSize: 12, fontWeight: 850, color: tone ? TONE_TEXT[tone] : "rgba(226,232,240,0.70)" };
}

const fullReportLinkStyle: CSSProperties = {
  marginTop: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 46,
  borderRadius: 14,
  border: "1px solid rgba(59,130,246,0.32)",
  background: "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(15,23,42,0.30))",
  color: "#dbeafe",
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 950,
  letterSpacing: "0.02em",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
};

const earningsSourceStyle: CSSProperties = { marginTop: 12, fontSize: 11, lineHeight: 1.5, color: "rgba(203,213,225,0.58)" };
