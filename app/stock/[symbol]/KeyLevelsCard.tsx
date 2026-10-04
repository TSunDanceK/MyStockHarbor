// THE "KEY LEVELS" CARD (#563 COWORK #64; range bars, #66/#67): the day's,
// this week's and this month's range, in the stock page's sidebar directly
// above the earnings snapshot.
//
// Each period is one row on its own scale (#79): a bar from its low to its high,
// a tick where it opened, a dot at the last price and a ◇ at the previous
// period's close. When that close lies outside the range, the scale stretches
// to include it and the grey track between the ◇ and the bar is the gap (#81).
// The geometry is
// lib/ta/keyLevelBars.ts; the levels are lib/ta/keyLevels.ts over the daily bars
// the page already holds. No fetch, no Redis, no hooks of its own, so it renders
// in the server HTML with the rest of the page.
//
// COPY IS DESCRIPTIVE. The colour says where the last price is against the
// period's open, like a candle on its side, and never alone: the dot against the
// tick says the same, and the tap note says it in words. Nothing says what a
// level means for the price or what a reader should do.
//
// THE TAP NOTE IS A's ReasonedValue on the row's low–high label. A tap on the
// bar itself clicks that label, so the whole bar opens the same note.
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { ReasonedValue } from "@/app/components/EstimatedValue";
import { keyLevels, priceWords, type KeyBar } from "@/lib/ta/keyLevels";
import { barRows, type Tone } from "@/lib/ta/keyLevelBars";

export const KEY_LEVELS_NOTE =
  "Levels some traders watch: the open, high, low and close of the latest session, of this week so far and of this month so far, " +
  "taken from daily prices. They describe where the price has been, not where it will go.";

/** The bar, tick and dot colours. Green/red describe the last price against the open; never a call. */
export const TONE_COLOUR: Record<Tone, string> = { up: "#22c55e", down: "#ef4444", flat: "#94a3b8" };

const C = {
  label: "rgba(147,197,253,0.82)",
  muted: "rgba(203,213,225,0.62)",
  value: "rgba(241,245,249,0.94)",
  track: "rgba(255,255,255,0.06)",
  prev: "rgba(226,232,240,0.85)",
  tick: "#f1f5f9",
};

/** A tap on the bar opens the row's note: it clicks the label's ReasonedValue trigger. */
function openRowNote(e: MouseEvent<HTMLElement>) {
  e.currentTarget.closest(".klRow")?.querySelector<HTMLElement>(".klRange [role=\"button\"]")?.click();
}

export default function KeyLevelsCard({
  bars,
  lastPrice,
  nowMs,
  credit,
}: {
  bars: readonly KeyBar[];
  /** The page's last price; the latest close stands in when there is none. */
  lastPrice?: number | null;
  /**
   * The page's render time (#563 COWORK #75/#76): in session, today's partial
   * bar counts (the Day column is today so far); otherwise the last completed
   * session. Without it, completed sessions only.
   */
  nowMs?: number;
  /** The linked Tiingo credit, passed only when the bars are Tiingo's. */
  credit?: ReactNode;
}) {
  const k = keyLevels(bars, { nowMs });
  const hasPrice = typeof lastPrice === "number" && Number.isFinite(lastPrice) && lastPrice > 0;
  const last = hasPrice ? lastPrice : k.lastClose;
  const rows = k.asOf && last != null ? barRows(k, last) : [];
  return (
    <section className="klCard" style={cardStyle}>
      {/* "DAY · WEEK · MONTH" (#563 COWORK #77): not "Price levels", which names the main column's ladder. */}
      <div className="klEyebrow" style={eyebrowStyle}>Day · week · month</div>
      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={titleStyle}>Key levels</h2>
        <span style={{ fontSize: 12, color: C.muted }}>
          <ReasonedValue text="What are these?" reason={KEY_LEVELS_NOTE} />
        </span>
      </div>
      {k.asOf && last != null ? (
        <p className="klAsOf" style={noteStyle}>
          {hasPrice || k.live ? "Last price" : "Last close"} <strong style={{ color: C.value }}>{priceWords(last)}</strong> ·{" "}
          {k.live
            ? k.live.phase === "afterClose"
              ? <>close{k.live.time ? `, ${k.live.time} ET` : ""} (IEX)</>
              : <>today so far{k.live.time ? `, ${k.live.time} ET` : ""} (IEX)</>
            : <>as of the close on {k.asOfWords}</>}
        </p>
      ) : null}

      {rows.map((r) => (
        <div key={r.key} className="klRow" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.value }}>
              {r.title}{r.since ? <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: C.muted }}>{r.since}</span> : null}
            </span>
            {r.bar ? (
              <span className="klRange" style={{ fontSize: 11, color: C.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                <ReasonedValue text={r.bar.range} reason={r.bar.note} />
              </span>
            ) : null}
          </div>
          {r.bar ? (
            <>
              {/* EACH ROW ON ITS OWN SCALE (#79): low to high fills the track; on a gap the scale
                  stretches to the previous close, and the empty track between ◇ and the bar is the gap (#81). */}
              <div className="klTrack" data-tone={r.bar.tone} data-flat={r.bar.flat ? "1" : undefined} data-gap={r.bar.prev?.gap ?? undefined} onClick={openRowNote} style={trackStyle} aria-hidden="true">
                <div className="klInner" style={{ position: "absolute", left: GUTTER, right: GUTTER, top: 0, bottom: 0 }}>
                  <div className="klRail" style={{ position: "absolute", top: 10, height: 8, left: 0, right: 0, borderRadius: 4, background: C.track }} />
                  <div className="klBar" style={{ position: "absolute", top: 10, height: 8, left: `${r.bar.from}%`, width: `${r.bar.to - r.bar.from}%`, minWidth: 4, borderRadius: 4, background: TONE_COLOUR[r.bar.tone], opacity: r.bar.flat ? 0.2 : 0.45 }} />
                  {r.bar.prev ? (
                    <div className="klPrev" style={{ ...diamondStyle, left: `${r.bar.prev.pos}%` }} />
                  ) : null}
                  {r.bar.open !== null ? (
                    <div className="klOpen" style={{ position: "absolute", top: 6, height: 18, width: 2, marginLeft: -1, left: `${r.bar.open}%`, background: C.tick, borderRadius: 1, zIndex: 1 }} />
                  ) : null}
                  <div className="klDot" style={{ position: "absolute", top: 9, width: 10, height: 10, marginLeft: -5, left: `${r.bar.dot}%`, borderRadius: 999, background: TONE_COLOUR[r.bar.tone], border: "1.5px solid #f8fafc", boxSizing: "border-box", zIndex: 2 }} />
                </div>
              </div>
              {r.bar.prev?.gapWords ? <div className="klGap" style={{ marginTop: 2, fontSize: 10, color: C.muted, textAlign: r.bar.prev.gap === "below" ? "left" : "right" }}>◇ {r.bar.prev.gapWords}</div> : null}
              {r.bar.flat ? <div className="klFlat" style={{ marginTop: 2, fontSize: 10, color: C.muted }}>No range yet</div> : null}
            </>
          ) : (
            <p className="klReason" style={{ ...noteStyle, marginTop: 4 }}>{r.reason}</p>
          )}
        </div>
      ))}

      {rows.some((r) => r.bar) ? (
        <p className="klKey" style={noteStyle}>
          Bar: that period&rsquo;s low to high · tick: the open · ◇ previous close · dot: the last price, green above the open, red below · grey space between ◇ and the bar: a gap from the previous close.
        </p>
      ) : null}
      {k.reasons.length && !rows.length ? k.reasons.map((r) => <p key={r} className="klReason" style={noteStyle}>{r}</p>) : null}
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
/** Each side of the track keeps this much room, so a dot or ◇ at either end stays inside the card. */
export const GUTTER = 6;
const trackStyle: CSSProperties = { position: "relative", height: 26, marginTop: 4, cursor: "help" };
/** The previous close: a small hollow diamond, above the bar so it never hides the tick or the dot. */
const diamondStyle: CSSProperties = { position: "absolute", top: 0, width: 7, height: 7, marginLeft: -3.5, transform: "rotate(45deg)", border: `1.5px solid ${C.prev}`, boxSizing: "border-box", background: "transparent", zIndex: 3 };
