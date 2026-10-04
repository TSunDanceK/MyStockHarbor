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
  CONFLUENCE_NOTE, NOTE_KINDS, ZONE_LADDER_HEIGHT, ZONE_NOTE_FOOTER, bulletWords, confluence, countWords, ladderTop, rangeWords, zoneDistance, zoneLadder, zoneNoteParts,
  type Confluence, type ZoneMark,
} from "@/lib/ta/confluence";
import { FlowPanel, HowToRead, NOTE_GAP, NoteButton, NoteDot, NotePanel, anchoredPlacement, pushOffsets, useIsPhone, useTapNote } from "./TapNote";

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
      <div className="czNoteFoot" style={{ marginTop: 6, fontSize: 11, color: C.muted }}>{ZONE_NOTE_FOOTER}</div>
    </div>
  );
}

/** One zone's label and its note. On a phone the card pushes what sits below the open label down (`onPush`). */
function ZoneLabel({ mark, index, price, offset, phone, onPush }: {
  mark: ZoneMark; index: number; price: number; offset: number; phone: boolean;
  onPush: (index: number, from: number, height: number | null) => void;
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
        style={{ position: "absolute", left: PILLAR_X + ZONE_LABEL_OFFSET, right: 0, top: mark.labelY + offset, transform: "translateY(-50%)", lineHeight: 1.25, minWidth: 0 }}>
        <div className="czCount" style={{ fontSize: 12.5, fontWeight: 850, color: ZONE_COLOUR[mark.side], whiteSpace: "nowrap" }}>
          <NoteButton note={note}>{countWords(mark.zone)}</NoteButton>
          {mark.side === "inside" ? null : <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}> · {zoneDistance(mark.zone, price)}</span>}
        </div>
        <div className="czRange" style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{rangeWords(mark.zone)}</div>
        {mark.side === "inside" ? <div className="czInside" style={{ fontSize: 11, fontWeight: 700, color: C.value, whiteSpace: "nowrap" }}>{zoneDistance(mark.zone, price)}</div> : null}
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

function Ladder({ c, marks }: { c: Confluence; marks: ZoneMark[] }) {
  const phone = useIsPhone();
  const [push, setPush] = useState<{ index: number; from: number; height: number } | null>(null);
  const onPush = useCallback((index: number, from: number, height: number | null) => {
    setPush((p) => (height === null ? (p && p.index === index ? null : p) : p && p.index === index && p.from === from && p.height === height ? p : { index, from, height }));
  }, []);
  const sc = c.scale!, price = c.price!;
  const priceY = ladderTop(price, sc);
  // Phone, a note open: everything whose top is below the open label moves down by the note.
  const ys = [priceY, ...marks.map((m) => m.top), ...marks.map((m) => m.labelY)];
  const off = push ? pushOffsets(ys, push.from, push.height) : ys.map(() => 0);
  const dotOff = off[0], bandOff = off.slice(1, 1 + marks.length), labelOff = off.slice(1 + marks.length);
  const extra = push ? push.height + NOTE_GAP * 2 : 0;
  return (
    <div className="czLadder" style={{ position: "relative", height: ZONE_LADDER_HEIGHT + extra, marginTop: 16, marginBottom: 6 }}>
      <div className="czAxis" style={{ position: "absolute", left: PILLAR_X - 1, top: 0, bottom: 0, width: 2, background: C.axis, borderRadius: 1 }} />
      {marks.map((m, i) => (
        <div key={`b${i}`} className="czBand" data-side={m.side}
          style={{ position: "absolute", left: PILLAR_X - BAND_HALF, width: BAND_HALF * 2, top: m.top + bandOff[i], height: Math.max(4, m.bottom - m.top), background: `${ZONE_COLOUR[m.side]}33`, border: `1px solid ${ZONE_COLOUR[m.side]}99`, borderRadius: 3, boxSizing: "border-box" }} />
      ))}
      {/* THE PRICE: at its true height on the fixed scale, labelled on the pillar's left. */}
      <div className="czDot" style={{ position: "absolute", left: PILLAR_X - 6, top: priceY + dotOff - 6, width: 12, height: 12, borderRadius: 999, background: "#f8fafc", border: "2px solid #0b1220", boxSizing: "border-box", zIndex: 2 }} />
      <div className="czPrice" style={{ position: "absolute", left: 0, width: PILLAR_X - 12, top: priceY + dotOff, transform: "translateY(-50%)", textAlign: "right", lineHeight: 1.15 }}>
        <div style={{ fontSize: 10, color: C.muted }}>price</div>
        <div style={{ fontSize: 11.5, fontWeight: 850, color: C.value, fontVariantNumeric: "tabular-nums" }}>{priceWords(price)}</div>
      </div>
      <svg className="czLeaders" width={ZONE_LABEL_OFFSET - BAND_HALF - ZONE_LEADER_GAP} height={ZONE_LADDER_HEIGHT + extra} aria-hidden="true" style={{ position: "absolute", top: 0, left: PILLAR_X + BAND_HALF }}>
        {marks.map((m, i) => (
          <line key={i} x1={0} y1={(m.top + m.bottom) / 2 + bandOff[i]} x2={ZONE_LABEL_OFFSET - BAND_HALF - ZONE_LEADER_GAP} y2={m.labelY + labelOff[i]} stroke={ZONE_COLOUR[m.side]} strokeOpacity={0.5} strokeWidth={1} />
        ))}
      </svg>
      {marks.map((m, i) => <ZoneLabel key={`l${i}`} mark={m} index={i} price={price} offset={labelOff[i]} phone={phone} onPush={onPush} />)}
    </div>
  );
}

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
  const phone = useIsPhone();
  const what = useTapNote();
  const head = useRef<HTMLDivElement | null>(null);
  const whatText = `Levels counted: the moving averages, macro support, the day's, week's and month's open, high and low, the previous closes, last week's and last month's high and low, the 52-week high and low, recent swing highs and lows, weekly pivots, round numbers beside another level, and the next close that would take RSI(14) to 70 or 30 or bring MACD to its signal line. Levels within ${c.band ? priceWords(c.band) : "a fraction of the usual daily range"} of each other form one zone; a zone needs two or more.${c.omitted.length ? ` Left out: ${c.omitted.join(" ")}` : ""}`;
  return (
    <section className="czCard" style={cardStyle}>
      <div className="czEyebrow" style={eyebrowStyle}>Confluence</div>
      <div ref={head} style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={titleStyle}>Price zones</h2>
        <span style={{ fontSize: 12, color: C.muted }}><NoteButton note={what}>What are these?</NoteButton></span>
      </div>
      <FlowPanel note={what} anchor={head} phone={phone} label="What are these?" pointerX={200}>
        <div className="czWhat">{whatText}</div>
      </FlowPanel>

      {marks.length && c.scale && c.price !== null ? <Ladder c={c} marks={marks} /> : <p className="czReason" style={noteStyle}>{c.reason}</p>}

      {/* THE SMALL PRINT, FOLDED (#88 §1): the key, the kinds' dots and the hedge. The Tiingo credit stays below, outside. */}
      <HowToRead>
        {marks.length ? <p className="czKey" style={{ margin: 0 }}>{ZONES_KEY}</p> : null}
        <ul className="czLegend" style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
          {NOTE_KINDS.map((k) => <li key={k.key} style={{ display: "flex", alignItems: "center" }}><NoteDot colour={k.colour} />{k.label}{k.key === "proj" ? ` ${ESTIMATE_SIGN}` : ""}</li>)}
        </ul>
        <p className="czNoteText" style={{ margin: "6px 0 0" }}>{CONFLUENCE_NOTE}</p>
      </HowToRead>
      {credit ? <p className="czCredit" style={noteStyle}>Daily prices: {credit}</p> : null}
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
