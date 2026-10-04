// THE "PRICE ZONES" CARD (#563 COWORK #83/#84): areas where several price
// levels sit close together, in the stock page's sidebar directly above Key
// levels. The zones are lib/ta/confluence.ts over the daily bars and the
// indicators the page already holds; no fetch, no Redis, no hooks of its own.
//
// THE LADDER: a fixed vertical scale from the lowest to the highest zone shown
// (and the price), padded. Each zone is a shaded band at its true price range;
// the price dot sits at its true height, so it moves toward a zone as the price
// does and the scale never recentres on it. The nearest two zones above and
// two below; a zone holding the price reads "price inside zone".
//
// LABELS ON ONE SIDE (#84 allowed it): at the sidebar's width (~262 px inside)
// alternating sides leaves about 100 px a side, too narrow for "$325.81–$327.40
// · 2.1% below". So the pillar sits left, the price's own label left of it, and
// every zone label on the right, stacked by the ladder's rule: two lines, the
// count and its distance from the price, then the range ("price inside zone"
// is a third line on the zone holding the price). A tap on the count opens the
// members.
//
// COPY IS DESCRIPTIVE: areas some traders watch, a description, not a forecast.
import type { CSSProperties, ReactNode } from "react";
import { ReasonedValue } from "@/app/components/EstimatedValue";
import { ESTIMATE_SIGN } from "@/app/components/estimateMark";
import { priceWords, type KeyBar } from "@/lib/ta/keyLevels";
import {
  CONFLUENCE_NOTE, ZONE_LADDER_HEIGHT, confluence, countWords, ladderTop, rangeWords, zoneDistance, zoneLadder, zoneNote,
  type ZoneMark,
} from "@/lib/ta/confluence";

/** Above the price amber, below blue, holding it light: the same sides as the Price levels ladder. */
export const ZONE_COLOUR: Record<ZoneMark["side"], string> = { above: "#f59e0b", below: "#38bdf8", inside: "#e2e8f0" };

/** The pillar's centre, from the ladder's left edge, in px; the price's label sits left of it. */
export const PILLAR_X = 70;
/** Zone labels start this far right of the pillar's centre; leaders stop ZONE_LEADER_GAP short. */
export const ZONE_LABEL_OFFSET = 24;
const ZONE_LEADER_GAP = 4;
const BAND_HALF = 11;

/** "≈" is A's estimate mark (app/components/estimateMark.ts): a projection is derived, not filed. */
export const ZONES_KEY =
  `Band: a zone's lowest to highest level · dot: the last price · tap a zone's count for its levels; ${ESTIMATE_SIGN} marks a one-session projection.`;

const C = {
  label: "rgba(147,197,253,0.82)",
  muted: "rgba(203,213,225,0.62)",
  value: "rgba(241,245,249,0.94)",
  axis: "rgba(255,255,255,0.12)",
};

export default function ConfluenceCard({
  bars,
  lastPrice,
  nowMs,
  ma50,
  ma200,
  macro,
  credit,
}: {
  bars: readonly KeyBar[];
  lastPrice?: number | null;
  /** The page's render time: today's partial bar counts only as #563 COWORK #75/#76 allow. */
  nowMs?: number;
  ma50?: number | null;
  ma200?: number | null;
  /** The page's macro support zone. */
  macro?: { lower: number; upper: number } | null;
  credit?: ReactNode;
}) {
  const c = confluence({ bars, nowMs, lastPrice, ma50, ma200, macro });
  const marks = zoneLadder(c);
  const what = `${CONFLUENCE_NOTE} Levels counted: the moving averages, macro support, the day's, week's and month's open, high and low, the previous closes, last week's and last month's high and low, the 52-week high and low, recent swing highs and lows, weekly pivots, round numbers beside another level, and the next close that would take RSI(14) to 70 or 30 or bring MACD to its signal line. Levels within ${c.band ? priceWords(c.band) : "a fraction of the usual daily range"} of each other form one zone; a zone needs two or more.${c.omitted.length ? ` Left out: ${c.omitted.join(" ")}` : ""}`;
  return (
    <section className="czCard" style={cardStyle}>
      <div className="czEyebrow" style={eyebrowStyle}>Confluence</div>
      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={titleStyle}>Price zones</h2>
        <span style={{ fontSize: 12, color: C.muted }}>
          <ReasonedValue text="What are these?" reason={what} />
        </span>
      </div>

      {marks.length && c.scale && c.price !== null ? (
        <div className="czLadder" style={{ position: "relative", height: ZONE_LADDER_HEIGHT, marginTop: 16, marginBottom: 6 }}>
          <div className="czAxis" style={{ position: "absolute", left: PILLAR_X - 1, top: 0, bottom: 0, width: 2, background: C.axis, borderRadius: 1 }} />
          {marks.map((m, i) => (
            <div key={`b${i}`} className="czBand" data-side={m.side}
              style={{ position: "absolute", left: PILLAR_X - BAND_HALF, width: BAND_HALF * 2, top: m.top, height: Math.max(4, m.bottom - m.top), background: `${ZONE_COLOUR[m.side]}33`, border: `1px solid ${ZONE_COLOUR[m.side]}99`, borderRadius: 3, boxSizing: "border-box" }} />
          ))}
          {/* THE PRICE: at its true height on the fixed scale, labelled on the pillar's left. */}
          <div className="czDot" style={{ position: "absolute", left: PILLAR_X - 6, top: ladderTop(c.price, c.scale) - 6, width: 12, height: 12, borderRadius: 999, background: "#f8fafc", border: "2px solid #0b1220", boxSizing: "border-box", zIndex: 2 }} />
          <div className="czPrice" style={{ position: "absolute", left: 0, width: PILLAR_X - 12, top: ladderTop(c.price, c.scale), transform: "translateY(-50%)", textAlign: "right", lineHeight: 1.15 }}>
            <div style={{ fontSize: 10, color: C.muted }}>price</div>
            <div style={{ fontSize: 11.5, fontWeight: 850, color: C.value, fontVariantNumeric: "tabular-nums" }}>{priceWords(c.price)}</div>
          </div>
          <svg className="czLeaders" width={ZONE_LABEL_OFFSET - BAND_HALF - ZONE_LEADER_GAP} height={ZONE_LADDER_HEIGHT} aria-hidden="true" style={{ position: "absolute", top: 0, left: PILLAR_X + BAND_HALF }}>
            {marks.map((m, i) => (
              <line key={i} x1={0} y1={(m.top + m.bottom) / 2} x2={ZONE_LABEL_OFFSET - BAND_HALF - ZONE_LEADER_GAP} y2={m.labelY} stroke={ZONE_COLOUR[m.side]} strokeOpacity={0.5} strokeWidth={1} />
            ))}
          </svg>
          {marks.map((m, i) => (
            <div key={`l${i}`} className="czLabel" data-side={m.side}
              style={{ position: "absolute", left: PILLAR_X + ZONE_LABEL_OFFSET, right: 0, top: m.labelY, transform: "translateY(-50%)", lineHeight: 1.25, minWidth: 0 }}>
              <div className="czCount" style={{ fontSize: 12.5, fontWeight: 850, color: ZONE_COLOUR[m.side], whiteSpace: "nowrap" }}>
                <ReasonedValue text={countWords(m.zone)} reason={zoneNote(m.zone)} />
                {m.side === "inside" ? null : <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}> · {zoneDistance(m.zone, c.price!)}</span>}
              </div>
              <div className="czRange" style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{rangeWords(m.zone)}</div>
              {m.side === "inside" ? <div className="czInside" style={{ fontSize: 11, fontWeight: 700, color: C.value, whiteSpace: "nowrap" }}>{zoneDistance(m.zone, c.price!)}</div> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="czReason" style={noteStyle}>{c.reason}</p>
      )}

      {marks.length ? <p className="czKey" style={noteStyle}>{ZONES_KEY}</p> : null}
      <p className="czNote" style={noteStyle}>{CONFLUENCE_NOTE}</p>
      {credit ? <p style={noteStyle}>Daily prices: {credit}</p> : null}
    </section>
  );
}

const cardStyle: CSSProperties = {
  border: "1px solid rgba(148,163,184,0.25)",
  borderRadius: 20,
  padding: 18,
  background: "linear-gradient(135deg, rgba(148,163,184,0.07), rgba(255,255,255,0.022))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  minWidth: 0,
};
const eyebrowStyle: CSSProperties = { fontSize: 11, fontWeight: 950, letterSpacing: "0.1em", textTransform: "uppercase", color: C.label };
const titleStyle: CSSProperties = { margin: 0, fontSize: 22, lineHeight: 1.12, letterSpacing: "-0.03em" };
const noteStyle: CSSProperties = { margin: "10px 0 0 0", fontSize: 11, lineHeight: 1.5, color: C.muted };
