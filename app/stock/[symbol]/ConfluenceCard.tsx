"use client";
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
// TIDIED (#563 COWORK #88): the key and the hedge sit in a closed "How to read
// this ▾" (the Tiingo credit stays on the face); the ladder is 320 px tall; a
// tap on a zone's count opens its note beside the tap (TapNote.tsx: anchored
// below the label on desktop, inline under it on a phone, pushing the rest of
// the ladder down); the note is a header in the zone's colour, one bullet per
// independent level with a dot for its kind, and a muted footer.
//
// COPY IS DESCRIPTIVE: areas some traders watch, a description, not a forecast.
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ESTIMATE_SIGN } from "@/app/components/estimateMark";
import { priceWords, type KeyBar } from "@/lib/ta/keyLevels";
import {
  ZONE_LADDER_FILL_MAX,
  CONFLUENCE_NOTE, GAP_WHAT, NOTE_KINDS, ZONE_LABEL_GAP, ZONE_NOTE_FOOTER, bulletWords, confluence, countWords, ladderHeight, ladderTop, rangeWords, zoneDistance, zoneLadder, zoneNoteParts,
  type Confluence, type ZoneMark,
} from "@/lib/ta/confluence";
import { FlowPanel, HowToRead, NOTE_GAP, NoteButton, NoteDot, NotePanel, anchoredPlacement, pushOffsets, useIsPhone, useTapNote } from "./TapNote";

/** Above the price amber, below blue, holding it light: the same sides as the Price levels ladder. */
export const ZONE_COLOUR: Record<ZoneMark["side"], string> = { above: "#f59e0b", below: "#38bdf8", inside: "#e2e8f0" };

/**
 * The pillar's centre, from the ladder's left edge, IN REM (#563 COWORK #109):
 * the price's label sits left of it and sizes to its text, so the column grows
 * with the reader's text setting instead of cutting "$29,412". PILLAR_X is the
 * same at the default 16px root, for the note's pointer.
 */
export const PILLAR = "5rem";
export const PILLAR_X = 80;
const atPillar = (px: number) => `calc(${PILLAR} + ${px}px)`;
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

const kindMeta = (k: string) => NOTE_KINDS.find((x) => x.key === k)!;

/** A zone's note (#88 §4): header in the zone's colour, a bullet per level with its kind's dot, a muted footer. */
export function ZoneNoteBody({ mark, price }: { mark: ZoneMark; price: number }) {
  const n = zoneNoteParts(mark.zone, price);
  return (
    <div className="czNote">
      <div className="czNoteHead" style={{ fontWeight: 850, color: ZONE_COLOUR[n.side] }}>
        {n.count} <span style={{ fontWeight: 600 }}>· {n.range} · {n.distance}</span>
      </div>
      <ul className="czBullets" style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 4 }}>
        {n.bullets.map((b, i) => (
          <li key={i} className="czBullet" data-kind={b.kind} style={{ display: "flex", alignItems: "baseline" }}>
            <NoteDot colour={kindMeta(b.kind).colour} />
            <span><strong style={{ color: C.value, fontWeight: 750 }}>{kindMeta(b.kind).label}{b.kind === "proj" ? ` ${ESTIMATE_SIGN}` : ""}:</strong> {bulletWords(b)}</span>
          </li>
        ))}
      </ul>
      <div className="czNoteFoot" style={{ marginTop: 6, fontSize: "var(--fs-label)", color: C.muted }}>{ZONE_NOTE_FOOTER}</div>
    </div>
  );
}

/** One zone's label and its note. On a phone the card pushes what sits below the open label down (`onPush`). */
function ZoneLabel({ mark, index, price, offset, phone, onPush, pos }: {
  mark: ZoneMark; index: number; price: number; offset: number; phone: boolean;
  onPush: (index: number, from: number, height: number | null) => void;
  /** A height on the ladder as CSS: px on the stock page, a share of the ladder's own height when it fills its card. */
  pos: (y: number, off: number) => number | string;
}) {
  const note = useTapNote();
  const label = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);
  const [place, setPlace] = useState<{ top: number; flipped: boolean } | null>(null);
  const lh = () => label.current?.offsetHeight ?? 30;
  const top = mark.labelY - lh() / 2, bottom = mark.labelY + lh() / 2;
  useLayoutEffect(() => {
    if (!note.open) { onPush(index, 0, null); setPlace(null); return; }
    if (phone) { onPush(index, bottom, h); return; }
    onPush(index, 0, null);
    const ladder = label.current?.parentElement;
    setPlace(anchoredPlacement({ labelTop: top + offset, labelBottom: bottom + offset, height: h, containerTop: ladder?.getBoundingClientRect().top ?? 0, viewportHeight: window.innerHeight }));
  }, [note.open, phone, h, index, onPush, top, bottom, offset]);
  return (
    <>
      <div ref={label} {...note.owner} className="czLabel" data-side={mark.side}
        style={{ position: "absolute", left: atPillar(ZONE_LABEL_OFFSET), right: 0, top: pos(mark.labelY, offset), transform: "translateY(-50%)", lineHeight: 1.25, minWidth: 0 }}>
        {/* On a narrow card or at a large text size these wrap (#563 COWORK #109): the count and the distance as
            units, never mid-phrase; the range after its dash. The labels' measured height spaces them. */}
        <div className="czCount" style={{ fontSize: "0.78125rem", fontWeight: 850, color: ZONE_COLOUR[mark.side] }}>
          <NoteButton note={note} style={{ whiteSpace: "nowrap" }}>{countWords(mark.zone)}</NoteButton>
          {mark.side === "inside" ? null : <span style={{ fontSize: "var(--fs-label)", fontWeight: 600, color: C.muted }}> · <span style={{ whiteSpace: "nowrap" }}>{zoneDistance(mark.zone, price)}</span></span>}
        </div>
        <div className="czRange" style={{ fontSize: "var(--fs-label)", color: C.muted, fontVariantNumeric: "tabular-nums" }}>{rangeWords(mark.zone)}</div>
        {mark.side === "inside" ? <div className="czInside" style={{ fontSize: "var(--fs-label)", fontWeight: 700, color: C.value }}>{zoneDistance(mark.zone, price)}</div> : null}
      </div>
      {note.open ? (
        phone
          ? <NotePanel note={note} label={`${countWords(mark.zone)}: its levels`} mode="inline" pointerX={PILLAR_X + ZONE_LABEL_OFFSET + 8} onHeight={setH}
              overlay={{ top: bottom + NOTE_GAP, flipped: false }}><ZoneNoteBody mark={mark} price={price} /></NotePanel>
          : <NotePanel note={note} label={`${countWords(mark.zone)}: its levels`} pointerX={PILLAR_X + ZONE_LABEL_OFFSET + 8} onHeight={setH}
              overlay={place ?? { top: bottom + offset + NOTE_GAP, flipped: false }}><ZoneNoteBody mark={mark} price={price} /></NotePanel>
      ) : null}
    </>
  );
}

function Ladder({ c, count, fill = false }: { c: Confluence; count: number; fill?: boolean }) {
  const phone = useIsPhone();
  // THE LABELS' OWN HEIGHT SETS THEIR SPACING (#563 COWORK #109): at a large text
  // setting, or when a label wraps on a narrow card, the stacking gap grows to the
  // tallest label plus a little air, and the ladder grows only if they need it.
  const box = useRef<HTMLDivElement | null>(null);
  const [gap, setGap] = useState(ZONE_LABEL_GAP);
  // FILLING ITS CARD (#563 COWORK #129, the SPX page): the ladder's own height, as the row gives it.
  const [shown, setShown] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const tallest = Math.max(0, ...[...el.querySelectorAll<HTMLElement>(".czLabel")].map((x) => x.offsetHeight));
      const need = Math.max(ZONE_LABEL_GAP, Math.ceil(tallest) + 6);
      setGap((g) => (g === need ? g : need));
      if (fill) setShown((h) => (h === el.clientHeight ? h : el.clientHeight));
    };
    fit();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [fill]);
  const natural = ladderHeight(count, gap);
  const [push, setPush] = useState<{ index: number; from: number; height: number } | null>(null);
  const onPush = useCallback((index: number, from: number, height: number | null) => {
    setPush((p) => (height === null ? (p && p.index === index ? null : p) : p && p.index === index && p.from === from && p.height === height ? p : { index, from, height }));
  }, []);
  const extra = push ? push.height + NOTE_GAP * 2 : 0;
  // Filling: the scale is the height the row gives the ladder, never below its
  // own need, never past ZONE_LADDER_FILL_MAX (beyond that the card centres it).
  const tallest = Math.max(natural, ZONE_LADDER_FILL_MAX);
  const height = fill && shown !== null ? Math.min(tallest, Math.max(natural, shown - extra)) : natural;
  const marks = zoneLadder(c, height, gap);
  const sc = c.scale!, price = c.price!;
  const priceY = ladderTop(price, sc, height);
  // Phone, a note open: everything whose top is below the open label moves down by the note.
  const ys = [priceY, ...marks.map((m) => m.top), ...marks.map((m) => m.labelY)];
  const off = push ? pushOffsets(ys, push.from, push.height) : ys.map(() => 0);
  const dotOff = off[0], bandOff = off.slice(1, 1 + marks.length), labelOff = off.slice(1 + marks.length);
  // FILLING, every height is a share of the ladder's own height, so the server's
  // markup is right at whatever height the row gives it, before any measure.
  const share = (y: number) => `(100% - ${extra}px) * ${(y / height).toFixed(5)}`;
  const pos = (y: number, o: number): number | string => (fill ? `calc(${share(y)} + ${o}px)` : y + o);
  const span = (h: number): number | string => (fill ? `max(4px, calc(${share(h)}))` : Math.max(4, h));
  const leadW = ZONE_LABEL_OFFSET - BAND_HALF - ZONE_LEADER_GAP;
  const ladder = (
    <div ref={box} className="czLadder" data-fill={fill ? "" : undefined}
      style={fill
        ? { position: "relative", flex: "1 1 auto", minHeight: natural + extra, maxHeight: tallest + extra }
        : { position: "relative", height: height + extra, marginTop: 16, marginBottom: 6 }}>
      <div className="czAxis" style={{ position: "absolute", left: atPillar(-1), top: 0, bottom: 0, width: 2, background: C.axis, borderRadius: 1 }} />
      {marks.map((m, i) => (
        <div key={`b${i}`} className="czBand" data-side={m.side}
          style={{ position: "absolute", left: atPillar(-BAND_HALF), width: BAND_HALF * 2, top: pos(m.top, bandOff[i]), height: span(m.bottom - m.top), background: `${ZONE_COLOUR[m.side]}33`, border: `1px solid ${ZONE_COLOUR[m.side]}99`, borderRadius: 3, boxSizing: "border-box" }} />
      ))}
      {/* THE PRICE: at its true height on the fixed scale, labelled on the pillar's left. */}
      <div className="czDot" style={{ position: "absolute", left: atPillar(-6), top: pos(priceY, dotOff - 6), width: 12, height: 12, borderRadius: 999, background: "#f8fafc", border: "2px solid #0b1220", boxSizing: "border-box", zIndex: 2 }} />
      {/* Sized to its text, ending 12px left of the pillar: never cut, whatever the price or text size. */}
      <div className="czPrice" style={{ position: "absolute", right: `calc(100% - ${PILLAR} + 12px)`, top: pos(priceY, dotOff), transform: "translateY(-50%)", textAlign: "right", lineHeight: 1.15, whiteSpace: "nowrap" }}>
        <div style={{ fontSize: "var(--fs-label)", color: C.muted }}>price</div>
        <div style={{ fontSize: "var(--fs-label)", fontWeight: 850, color: C.value, fontVariantNumeric: "tabular-nums" }}>{priceWords(price)}</div>
      </div>
      {fill ? (
        // Drawn on the ladder's scale and stretched with it; the stroke keeps its width.
        <svg className="czLeaders" width={leadW} height="100%" viewBox={`0 0 ${leadW} ${height + extra}`} preserveAspectRatio="none" aria-hidden="true" style={{ position: "absolute", top: 0, left: atPillar(BAND_HALF) }}>
          {marks.map((m, i) => (
            <line key={i} x1={0} y1={(m.top + m.bottom) / 2 + bandOff[i]} x2={leadW} y2={m.labelY + labelOff[i]} stroke={ZONE_COLOUR[m.side]} strokeOpacity={0.5} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      ) : (
        <svg className="czLeaders" width={leadW} height={height + extra} aria-hidden="true" style={{ position: "absolute", top: 0, left: atPillar(BAND_HALF) }}>
          {marks.map((m, i) => (
            <line key={i} x1={0} y1={(m.top + m.bottom) / 2 + bandOff[i]} x2={leadW} y2={m.labelY + labelOff[i]} stroke={ZONE_COLOUR[m.side]} strokeOpacity={0.5} strokeWidth={1} />
          ))}
        </svg>
      )}
      {marks.map((m, i) => <ZoneLabel key={`l${i}`} mark={m} index={i} price={price} offset={labelOff[i]} phone={phone} onPush={onPush} pos={pos} />)}
    </div>
  );
  // The card's spare height goes to the ladder up to its cap; past that, the ladder is centred in it.
  // The wrapper carries the ladder's margins, so in a plain (phone) card they collapse with its neighbours' as before.
  return fill ? <div className="czFill" style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", justifyContent: "center", marginTop: 16, marginBottom: 6 }}>{ladder}</div> : ladder;
}

export default function ConfluenceCard({
  bars,
  lastPrice,
  nowMs,
  ma50,
  ma200,
  macro,
  credit,
  fill = false,
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
  /** The SPX page (#563 COWORK #129): the ladder takes the card's spare height, which that page's CSS gives it. */
  fill?: boolean;
}) {
  const c = confluence({ bars, nowMs, lastPrice, ma50, ma200, macro });
  const marks = zoneLadder(c);
  const phone = useIsPhone();
  const what = useTapNote();
  const head = useRef<HTMLDivElement | null>(null);
  const whatText = `Levels counted: the moving averages, macro support, the day's, week's and month's open, high and low, the previous closes, last week's and last month's high and low, the 52-week high and low, recent swing highs and lows, weekly pivots, round numbers beside another level, and the next close that would take RSI(14) to 70 or 30 or bring MACD to its signal line. Levels within ${c.band ? priceWords(c.band) : "a fraction of the usual daily range"} of each other form one zone; a zone needs two or more. ${GAP_WHAT}${c.omitted.length ? ` Left out: ${c.omitted.join(" ")}` : ""}`;
  return (
    <section className="czCard" style={cardStyle}>
      <div className="czEyebrow" style={eyebrowStyle}>Confluence</div>
      <div ref={head} style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={titleStyle}>Price zones</h2>
        <span style={{ fontSize: "var(--fs-read)", color: C.muted }}><NoteButton note={what}>What are these?</NoteButton></span>
      </div>
      <FlowPanel note={what} anchor={head} phone={phone} label="What are these?" pointerX={200}>
        <div className="czWhat">{whatText}</div>
      </FlowPanel>

      {marks.length && c.scale && c.price !== null ? <Ladder c={c} count={marks.length} fill={fill} /> : <p className="czReason" style={readStyle}>{c.reason}</p>}

      {/* THE SMALL PRINT, FOLDED (#88 §1): the key, the kinds' dots and the hedge. The Tiingo credit stays below, outside. */}
      <HowToRead>
        {marks.length ? <p className="czKey" style={{ margin: 0 }}>{ZONES_KEY}</p> : null}
        <ul className="czLegend" style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
          {NOTE_KINDS.map((k) => <li key={k.key} style={{ display: "flex", alignItems: "center" }}><NoteDot colour={k.colour} />{k.label}{k.key === "proj" ? ` ${ESTIMATE_SIGN}` : ""}</li>)}
        </ul>
        <p className="czNoteText" style={{ margin: "6px 0 0" }}>{CONFLUENCE_NOTE}</p>
      </HowToRead>
      {credit ? <p className="czCredit" data-fine-print style={noteStyle}>Daily prices: {credit}</p> : null}
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
const eyebrowStyle: CSSProperties = { fontSize: "var(--fs-label)", fontWeight: 950, letterSpacing: "0.1em", textTransform: "uppercase", color: C.label };
const titleStyle: CSSProperties = { margin: 0, fontSize: "1.375rem", lineHeight: 1.12, letterSpacing: "-0.03em" };
const noteStyle: CSSProperties = { margin: "10px 0 0 0", fontSize: "var(--fs-fine)", lineHeight: 1.5, color: C.muted };
const readStyle: CSSProperties = { ...noteStyle, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)" };
