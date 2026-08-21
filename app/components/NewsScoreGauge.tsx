import type { CSSProperties } from "react";

// The semicircular 0-100 news score gauge.
//
// Lifted verbatim (2026-08-07) out of app/stock/[symbol]/news/page.tsx, where
// it was a page-local component, so the sector news pages can render the same
// gauge instead of carrying a second copy. That page file already accumulated
// ~400 lines of dead, drifted duplicates of the scoring functions; a second
// duplicated gauge would have been the same mistake in a different shape.
//
// Server component by design -- it is pure SVG with no interactivity, so it
// belongs in the crawlable initial HTML (see claude/RENDERING_POLICY.md).
//
// Fully symbol-agnostic: it takes a score/tone/label and nothing else, which is
// exactly why it works unchanged for a sector-level score.

type ScoreTone = "green" | "yellow" | "red";

export type NewsScoreGaugeInput = {
  // False when there was nothing to score. Not optional: a caller that has not
  // decided yet should be made to decide, because the failure mode here is a
  // gauge that renders a full reading from no input.
  available: boolean;
  score: number;
  tone: ScoreTone;
  label: string;
};

export function newsGaugeColour(tone: ScoreTone) {
  if (tone === "green") return "#22c55e";
  if (tone === "red") return "#ef4444";
  return "#eab308";
}

export const scorePanelKickerStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 950,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.76)",
};

export const scoreValueStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 42,
  lineHeight: 1,
  fontWeight: 950,
  letterSpacing: "-0.06em",
};

export function scoreLabelStyle(tone: ScoreTone): CSSProperties {
  return {
    marginTop: 8,
    display: "inline-flex",
    alignItems: "center",
    padding: "7px 11px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: tone === "green" ? "#dcfce7" : tone === "red" ? "#fee2e2" : "#fef3c7",
    background:
      tone === "green"
        ? "rgba(34,197,94,0.18)"
        : tone === "red"
          ? "rgba(248,113,113,0.16)"
          : "rgba(250,204,21,0.14)",
    border:
      tone === "green"
        ? "1px solid rgba(34,197,94,0.28)"
        : tone === "red"
          ? "1px solid rgba(248,113,113,0.24)"
          : "1px solid rgba(250,204,21,0.22)",
  };
}

// tone === null means the score is unavailable. The yellow tint is the same one
// a genuine "Neutral" reading gets, so tinting an unscored panel yellow restates
// the verdict the number was just removed for making.
export function scorePanelStyle(tone: ScoreTone | null): CSSProperties {
  if (tone === null) {
    return {
      position: "relative",
      border: "1px solid rgba(255,255,255,0.10)",
      borderRadius: 20,
      padding: 18,
      background: "linear-gradient(135deg, rgba(148,163,184,0.10), rgba(12,14,18,0.96))",
    };
  }
  if (tone === "green")
    return {
      position: "relative",
      border: "1px solid rgba(34,197,94,0.26)",
      borderRadius: 20,
      padding: 18,
      background: "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(7,16,12,0.96))",
    };
  if (tone === "red")
    return {
      position: "relative",
      border: "1px solid rgba(248,113,113,0.24)",
      borderRadius: 20,
      padding: 18,
      background: "linear-gradient(135deg, rgba(248,113,113,0.16), rgba(18,10,10,0.96))",
    };
  return {
    position: "relative",
    border: "1px solid rgba(250,204,21,0.24)",
    borderRadius: 20,
    padding: 18,
    background: "linear-gradient(135deg, rgba(250,204,21,0.14), rgba(18,16,8,0.96))",
  };
}

export default function NewsScoreGauge({
  newsScore,
  kicker = "NEWS SCORE",
}: {
  newsScore: NewsScoreGaugeInput;
  kicker?: string;
}) {
  // Nothing to score means no number, no needle and no Bearish/Neutral/Bullish
  // scale. A "50/100" with the marker at dead centre reads as a genuine neutral
  // verdict rather than an absent one.
  if (!newsScore.available) {
    return (
      <div>
        <div style={scorePanelKickerStyle}>{kicker}</div>
        <div style={{ marginTop: 14, fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>Not enough headlines to score</div>
      </div>
    );
  }

  const safeScore = Math.max(0, Math.min(100, newsScore.score));
  const colour = newsGaugeColour(newsScore.tone);
  const markerX = 24 + (192 * safeScore) / 100;
  const markerY = 122 - Math.sin((safeScore / 100) * Math.PI) * 96;

  return (
    <div>
      <div style={scorePanelKickerStyle}>{kicker}</div>
      <div style={{ marginTop: 14, position: "relative", minHeight: 178 }}>
        <svg
          viewBox="0 0 240 145"
          role="img"
          aria-label={`News score ${safeScore} out of 100: ${newsScore.label}`}
          style={{ width: "100%", display: "block", overflow: "visible" }}
        >
          <defs>
            <linearGradient id="newsGaugeWarmGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="48%" stopColor="#eab308" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>
          <path
            d="M 24 122 A 96 96 0 0 1 216 122"
            fill="none"
            stroke="rgba(148,163,184,0.22)"
            strokeWidth="22"
            strokeLinecap="round"
            pathLength={100}
          />
          <path
            d="M 24 122 A 96 96 0 0 1 216 122"
            fill="none"
            stroke="url(#newsGaugeWarmGradient)"
            strokeWidth="22"
            strokeLinecap="round"
            strokeDasharray={`${safeScore} 100`}
            pathLength={100}
            style={{ filter: `drop-shadow(0 0 10px ${colour}55)` }}
          />
          <circle
            cx={markerX}
            cy={markerY}
            r="8"
            fill={colour}
            stroke="rgba(255,255,255,0.88)"
            strokeWidth="3"
            style={{ filter: `drop-shadow(0 0 10px ${colour}88)` }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 18,
            display: "grid",
            justifyItems: "center",
            pointerEvents: "none",
          }}
        >
          <div style={scoreValueStyle}>{safeScore}/100</div>
          <div style={scoreLabelStyle(newsScore.tone)}>{newsScore.label}</div>
        </div>
      </div>
      <div
        style={{
          marginTop: 8,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 8,
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        <div style={{ color: "#fca5a5" }}>Bearish</div>
        <div style={{ color: "#fde68a", textAlign: "center" }}>Neutral</div>
        <div style={{ color: "#86efac", textAlign: "right" }}>Bullish</div>
      </div>
    </div>
  );
}
