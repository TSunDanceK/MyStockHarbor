// THE "KEY LEVELS" CARD (#563 COWORK #64; the pole, #115 "E1, true scale"):
// the day's, this week's and this month's levels as named ticks on one
// vertical price pole, in the stock page's sidebar directly above the earnings
// snapshot (and on /markets/spx).
//
// One pole on TRUE price scale: a thin track over this month's low–high, a
// thicker band over today's, the last price as an accent bar and pill. Each
// level is a short tick at its true height; its name sits on the left in words,
// its price on the right (green above the last price, red below) with its %
// distance. Labels keep a minimum gap and fan out with leader lines. The layout
// is lib/ta/keyLevelPole.ts over lib/ta/keyLevels.ts (the bars the page already
// holds). No fetch, no Redis; the card renders in the server HTML.
//
// The labels' measured height sets their spacing after mount (a large text
// setting, or a wrapped label on a narrow card); the server render uses the
// rem default. The SVG is aria-hidden, a visually hidden list carries the same
// levels in words, and nothing here carries a transform.
//
// COPY IS DESCRIPTIVE: where the levels sit against the last price, never what
// they mean for it or what a reader should do.
"use client";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { keyLevels, priceWords, type KeyBar } from "@/lib/ta/keyLevels";
import { LABEL_LINE_REM, POLE_KEY, keyLevelPole, poleListWords, poleNumber, type Pole, type PoleSide } from "@/lib/ta/keyLevelPole";
import { FlowPanel, NoteButton, useIsPhone, useTapNote } from "./TapNote";

export const KEY_LEVELS_NOTE =
  "Levels some traders watch: the open, high, low and close of the latest session, of this week so far and of this month so far, " +
  "taken from daily prices. They describe where the price has been, not where it will go.";

/** Green above the last price, red below, muted level with it. Never a call. */
export const SIDE_COLOUR: Record<PoleSide, string> = { up: "#22c55e", down: "#ef4444", at: "rgba(203,213,225,0.8)" };

const C = {
  label: "rgba(147,197,253,0.82)",
  muted: "rgba(203,213,225,0.62)",
  value: "rgba(241,245,249,0.94)",
  leader: "#64748b",
  month: "#1e293b",
  day: "#4b5d78",
  accent: "#7cb3f0",
};

/** The pole column's width, in rem; the SVG draws in tenths of a rem (1 unit = 0.1rem). */
export const POLE_COL_REM = 2.25;
const U = 10;

/** The pole, its ticks and leaders: decorative (the labels and the hidden list are the content). */
export function PoleSvg({ pole }: { pole: Pole }) {
  const W = POLE_COL_REM * U, H = pole.height * U, mid = W / 2;
  return (
    <svg className="klPoleSvg" aria-hidden="true" focusable="false" viewBox={`0 0 ${W} ${H}`}
      style={{ position: "absolute", left: `calc((100% - ${POLE_COL_REM}rem) / 2.3)`, top: 0, width: `${POLE_COL_REM}rem`, height: `${pole.height}rem`, overflow: "visible", pointerEvents: "none" }}>
      {pole.month ? <rect className="klMonth" x={mid - 3} y={pole.month.top * U} width={6} height={Math.max(1, (pole.month.bottom - pole.month.top) * U)} rx={3} fill={C.month} /> : null}
      {pole.day ? <rect className="klDay" x={mid - 7} y={pole.day.top * U} width={14} height={Math.max(2, (pole.day.bottom - pole.day.top) * U)} rx={4} fill={C.day} /> : null}
      {pole.rows.map((r, i) => {
        const ty = r.y * U, ly = r.ly * U;
        if (r.last) {
          return (
            <g key={i} className="klLastMark">
              <line x1={mid - 9.5} x2={mid + 9.5} y1={ty} y2={ty} stroke={C.accent} strokeWidth={3} strokeLinecap="round" />
              <path d={`M${mid - 10.5} ${ty} l-3 -3 v6 z`} fill={C.accent} />
              <path d={`M${mid + 9.5} ${ty} L${W} ${ly}`} stroke={C.accent} fill="none" strokeWidth={1} />
            </g>
          );
        }
        const c = SIDE_COLOUR[r.side];
        return (
          <g key={i} className="klTick" data-side={r.side}>
            <line x1={mid - 9} x2={mid + 9} y1={ty} y2={ty} stroke={c} strokeWidth={2} />
            <path className="klLeader" d={`M${mid - 9} ${ty} L${mid - 12} ${ly} L0 ${ly}`} stroke={C.leader} fill="none" strokeWidth={1} />
            <path className="klLeader" d={`M${mid + 9} ${ty} L${mid + 12} ${ly} L${W} ${ly}`} stroke={C.leader} fill="none" strokeWidth={1} />
          </g>
        );
      })}
    </svg>
  );
}

/** One label row at its placed height: name on the left, price and distance (or the last-price pill) on the right. */
function PoleLabel({ r }: { r: Pole["rows"][number] }) {
  return (
    <div className="klLabel" data-label={r.label} data-last={r.last ? "1" : undefined} data-side={r.side}
      style={{ position: "absolute", left: 0, right: 0, top: `calc(${r.ly}rem - ${LABEL_LINE_REM / 2}rem)`, display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${POLE_COL_REM}rem minmax(0, 1.3fr)`, alignItems: "start", fontSize: "var(--fs-label)", lineHeight: 1.25 }}>
      <span className="klName" style={{ textAlign: "right", color: C.value, paddingRight: 2 }}>{r.last ? "" : r.label}</span>
      <span />
      {r.last ? (
        <span className="klPill" style={{ justifySelf: "start", display: "inline-flex", flexWrap: "wrap", columnGap: "0.45em", whiteSpace: "nowrap", padding: "0 0.45em", marginTop: "-0.15rem", borderRadius: 6, border: `1px solid ${C.accent}`, background: "rgba(124,179,240,0.16)", color: C.value, fontSize: "var(--fs-label)", fontWeight: 800, lineHeight: 1.4 }}>
          <span>Last price</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{poleNumber(r.value)}</span>
        </span>
      ) : (
        <span className="klValue" style={{ display: "flex", flexWrap: "wrap", columnGap: "0.5em", paddingLeft: 2, fontVariantNumeric: "tabular-nums" }}>
          <span style={{ color: SIDE_COLOUR[r.side], fontWeight: 700 }}>{poleNumber(r.value)}</span>
          <span className="klDist" style={{ color: C.muted, fontSize: "var(--fs-fine)" }}>{r.dist}</span>
        </span>
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
   * bar counts (the Day is today so far); otherwise the last completed
   * session. Without it, completed sessions only.
   */
  nowMs?: number;
  /** The linked Tiingo credit, passed only when the bars are Tiingo's. */
  credit?: ReactNode;
}) {
  const k = keyLevels(bars, { nowMs });
  const hasPrice = typeof lastPrice === "number" && Number.isFinite(lastPrice) && lastPrice > 0;
  const last = hasPrice ? lastPrice : k.lastClose;
  const phone = useIsPhone();
  const what = useTapNote();
  const head = useRef<HTMLDivElement | null>(null);
  // EACH LABEL'S OWN HEIGHT SETS ITS ROOM (#115: at least about 1.4× the label line height, in rem): after
  // mount the card measures every label, so one that wrapped (a long name on a narrow card, a large text size)
  // pushes the next one down by its height, and only it. The pole grows only when the labels need it.
  const box = useRef<HTMLDivElement | null>(null);
  const [heights, setHeights] = useState<Record<string, number> | undefined>(undefined);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const next: Record<string, number> = {};
      for (const x of el.querySelectorAll<HTMLElement>(".klLabel")) next[x.dataset.label ?? ""] = Math.round((x.offsetHeight / root) * 100) / 100;
      setHeights((h) => (h && Object.keys(next).every((key) => Math.abs((h[key] ?? 0) - next[key]) < 0.02) ? h : next));
    };
    fit();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const pole = keyLevelPole(k, last, undefined, heights);
  return (
    <section className="klCard" style={cardStyle}>
      {/* "DAY · WEEK · MONTH" (#563 COWORK #77): not "Price levels", which names the main column's ladder. */}
      <div className="klEyebrow" style={eyebrowStyle}>Day · week · month</div>
      <div ref={head} style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={titleStyle}>Key levels</h2>
        <span style={{ fontSize: "var(--fs-read)", color: C.muted }}><NoteButton note={what}>What are these?</NoteButton></span>
      </div>
      <FlowPanel note={what} anchor={head} phone={phone} label="What are these?" pointerX={200}>
        <div className="klWhat">{KEY_LEVELS_NOTE}</div>
      </FlowPanel>
      {k.asOf && last != null ? (
        <p className="klAsOf" data-fine-print style={noteStyle}>
          {hasPrice || k.live ? "Last price" : "Last close"} <strong style={{ color: C.value }}>{priceWords(last)}</strong> ·{" "}
          {k.live
            ? k.live.phase === "afterClose"
              ? <>close{k.live.time ? `, ${k.live.time} ET` : ""} (IEX)</>
              : <>today so far{k.live.time ? `, ${k.live.time} ET` : ""} (IEX)</>
            : <>as of the close on {k.asOfWords}</>}
        </p>
      ) : null}

      {pole ? (
        <>
          <div ref={box} className="klPole" aria-hidden="true" style={{ position: "relative", height: `${pole.height}rem`, marginTop: 12 }}>
            <PoleSvg pole={pole} />
            {pole.rows.map((r) => <PoleLabel key={`${r.label}${r.value}`} r={r} />)}
          </div>
          {/* The same levels in words, in price order, for screen readers (the pole above is aria-hidden). */}
          <ul className="klList" style={srOnly}>{poleListWords(pole).map((t) => <li key={t}>{t}</li>)}</ul>
          {/* The key: a legend at --fs-label as #115 rules, tagged as fine print (not reading text). */}
          <p className="klKey" data-fine-print style={{ margin: "10px 0 0", fontSize: "var(--fs-label)", lineHeight: 1.45, color: C.muted }}>
            <strong style={{ color: SIDE_COLOUR.up }}>Green</strong>{POLE_KEY.slice("Green".length, POLE_KEY.indexOf("red"))}<strong style={{ color: SIDE_COLOUR.down }}>red</strong>{POLE_KEY.slice(POLE_KEY.indexOf("red") + 3)}
          </p>
        </>
      ) : k.reasons.map((r) => <p key={r} className="klReason" style={noteStyle}>{r}</p>)}
      {pole?.skipped || credit ? (
        <p className="klCredit" data-fine-print style={noteStyle}>
          {pole?.skipped ? <>{pole.skipped}{credit ? " · " : ""}</> : null}
          {credit ? <>Daily prices: {credit}</> : null}
        </p>
      ) : null}
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
const srOnly: CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };
