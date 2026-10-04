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
// the page already holds. No fetch, no Redis; it renders in the server HTML with
// the rest of the page, notes closed (their hooks are TapNote.tsx's).
//
// COPY IS DESCRIPTIVE. The colour says where the last price is against the
// period's open, like a candle on its side, and never alone: the dot against the
// tick says the same, and the tap note says it in words. Nothing says what a
// level means for the price or what a reader should do.
//
// THE TAP NOTE (#563 COWORK #88 §3 / #89) opens beside the tap: the row's
// low–high label is its button, and a tap on the bar toggles the same note.
// Anchored below the row's label on desktop, inline under it on a phone
// (TapNote.tsx). It is a header in the row's colour, one bullet per level with
// the card's own mark beside it, and the verdict; a gap row adds a "Gap" bullet
// (the gap's words left the card face, #88 §1). The key sits in a closed "How
// to read this ▾"; the Tiingo credit stays on the face.
"use client";
import { useRef, type CSSProperties, type ReactNode } from "react";
import { keyLevels, priceWords, type KeyBar } from "@/lib/ta/keyLevels";
import { barRows, type BarRow, type RowBulletKey, type Tone } from "@/lib/ta/keyLevelBars";
import { FlowPanel, HowToRead, NoteButton, NoteDot, useIsPhone, useTapNote } from "./TapNote";

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

export const KEY_LINE =
  "Bar: that period\u2019s low to high · tick: the open · ◇ previous close · dot: the last price, green above the open, red below · grey space between ◇ and the bar: a gap from the previous close.";

/** Each bullet's mark, as on the card's face (#89). */
const MARK: Record<RowBulletKey, { shape: "tick" | "up" | "down" | "diamond" | "dot"; colour: (t: Tone) => string }> = {
  open: { shape: "tick", colour: () => C.tick },
  high: { shape: "up", colour: () => "rgba(203,213,225,0.8)" },
  low: { shape: "down", colour: () => "rgba(203,213,225,0.8)" },
  prev: { shape: "diamond", colour: () => C.prev },
  gap: { shape: "diamond", colour: () => C.prev },
  last: { shape: "dot", colour: (t) => TONE_COLOUR[t] },
};

/** A row's note (#89): header, a bullet per level with its mark, the verdict, then anything without a bullet. */
export function RowNoteBody({ bar }: { bar: NonNullable<BarRow["bar"]> }) {
  const n = bar.rowNote;
  return (
    <div className="klNote">
      <div className="klNoteHead" style={{ fontWeight: 850, color: C.value }}>
        <span style={{ color: TONE_COLOUR[n.tone] }}>{n.title}</span> · {n.when} <span style={{ fontWeight: 600, color: C.muted }}>· {n.range}</span>
      </div>
      <ul className="klBullets" style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 4 }}>
        {n.bullets.map((b) => (
          <li key={b.key} className="klBullet" data-key={b.key} style={{ display: "flex", alignItems: "baseline" }}>
            <NoteDot shape={MARK[b.key].shape} colour={MARK[b.key].colour(n.tone)} />
            <span><strong style={{ color: C.value, fontWeight: 750 }}>{b.label}{b.key === "gap" ? ":" : ""}</strong> {b.text}</span>
          </li>
        ))}
      </ul>
      {n.verdict ? <div className="klVerdict" data-tone={n.tone} style={{ marginTop: 6, fontWeight: 800, color: TONE_COLOUR[n.tone] }}>{n.verdict}</div> : null}
      {n.extra.map((x) => <div key={x} className="klExtra" style={{ marginTop: 4, fontSize: 11, color: C.muted }}>{x}</div>)}
    </div>
  );
}

/** One period's row: its label and range, the bar, and its note. */
function KeyRow({ r, phone }: { r: BarRow; phone: boolean }) {
  const note = useTapNote();
  const head = useRef<HTMLDivElement | null>(null);
  return (
    <div className="klRow" style={{ marginTop: 12 }}>
      <div ref={head} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.value }}>
          {r.title}{r.since ? <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: C.muted }}>{r.since}</span> : null}
        </span>
        {r.bar ? (
          <span className="klRange" style={{ fontSize: 11, color: C.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            <NoteButton note={note}>{r.bar.range}</NoteButton>
          </span>
        ) : null}
      </div>
      {r.bar ? (
        <>
          <FlowPanel note={note} anchor={head} phone={phone} label={`${r.title}: its levels`} pointerX={200}>
            <RowNoteBody bar={r.bar} />
          </FlowPanel>
          {/* EACH ROW ON ITS OWN SCALE (#79): low to high fills the track; on a gap the scale
              stretches to the previous close, and the empty track between ◇ and the bar is the gap (#81). */}
          <div className="klTrack" {...note.owner} data-tone={r.bar.tone} data-flat={r.bar.flat ? "1" : undefined} data-gap={r.bar.prev?.gap ?? undefined} onClick={note.toggle} style={trackStyle} aria-hidden="true">
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
          {r.bar.flat ? <div className="klFlat" style={{ marginTop: 2, fontSize: 10, color: C.muted }}>No range yet</div> : null}
        </>
      ) : (
        <p className="klReason" style={{ ...noteStyle, marginTop: 4 }}>{r.reason}</p>
      )}
    </div>
  );
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
  const phone = useIsPhone();
  const what = useTapNote();
  const head = useRef<HTMLDivElement | null>(null);
  return (
    <section className="klCard" style={cardStyle}>
      {/* "DAY · WEEK · MONTH" (#563 COWORK #77): not "Price levels", which names the main column's ladder. */}
      <div className="klEyebrow" style={eyebrowStyle}>Day · week · month</div>
      <div ref={head} style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={titleStyle}>Key levels</h2>
        <span style={{ fontSize: 12, color: C.muted }}><NoteButton note={what}>What are these?</NoteButton></span>
      </div>
      <FlowPanel note={what} anchor={head} phone={phone} label="What are these?" pointerX={200}>
        <div className="klWhat">{KEY_LEVELS_NOTE}</div>
      </FlowPanel>
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

      {rows.map((r) => <KeyRow key={r.key} r={r} phone={phone} />)}

      {/* THE SMALL PRINT, FOLDED (#88 §1). The Tiingo credit stays below, outside. */}
      {rows.some((r) => r.bar) ? (
        <HowToRead>
          <p className="klKey" style={{ margin: 0 }}>{KEY_LINE}</p>
        </HowToRead>
      ) : null}
      {k.reasons.length && !rows.length ? k.reasons.map((r) => <p key={r} className="klReason" style={noteStyle}>{r}</p>) : null}
      {credit ? <p className="klCredit" style={noteStyle}>Daily prices: {credit}</p> : null}
    </section>
  );
}

const cardStyle: CSSProperties = {
  position: "relative",
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
