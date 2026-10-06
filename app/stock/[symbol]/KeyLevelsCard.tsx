// THE "KEY LEVELS" CARD (#563 COWORK #64; the pole, #115 "E1, true scale"):
// the day's, this week's and this month's levels as named ticks on one
// vertical price pole, in the stock page's sidebar directly above the earnings
// snapshot (and on /markets/spx).
//
// One pole on TRUE price scale: a thin track over this month's low–high, a
// thicker band over today's, the last price as an accent bar and pill. Each
// level is a short tick at its true height; its short name and period tags
// ("High D W", #563 COWORK #123) sit on the left on one line, its price on the
// right (green above the last price, red below) with its % distance. Labels
// keep a minimum gap and fan out with leader lines. The layout
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
import { LABEL_LINE_REM, POLE_KEY, TAG_NOTE, keyLevelPole, poleListWords, poleNumber, type Pole, type PoleSide } from "@/lib/ta/keyLevelPole";
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
/**
 * The name column's share of the width beside the pole (#123: the names are short now, the price and its %
 * distance need the room). Below DIST_MIN_REM of pole width (the 300 px sidebar at a large text size) the %
 * distance steps aside so nothing wraps, and the names take NAME_SHARE_NARROW; the hidden list keeps every
 * distance. One CSS variable sets both the labels' columns and the pole's place, so they always line up.
 */
export const NAME_SHARE = 0.46;
export const NAME_SHARE_NARROW = 0.55;
export const DIST_MIN_REM = 16.25;
const NAME_COL = `calc((100% - ${POLE_COL_REM}rem) * var(--kl-name, ${NAME_SHARE}))`;
const U = 10;
/**
 * FILLING ITS CARD (#563 COWORK #129, the SPX page's levels row): the pole may
 * grow to this multiple of its own height to take the row's spare room; past
 * it the levels sit too far apart to read as one scale, and the card centres
 * the pole instead. Every height is then a share of the pole's own height.
 */
export const KL_FILL_MAX = 1.75;

/** The pole, its ticks and leaders: decorative (the labels and the hidden list are the content). */
export function PoleSvg({ pole, fill = false }: { pole: Pole; fill?: boolean }) {
  const W = POLE_COL_REM * U, H = pole.height * U, mid = W / 2;
  // Filling, the drawing stretches with the pole and its lines keep their width.
  const v = fill ? "non-scaling-stroke" : undefined;
  return (
    <svg className="klPoleSvg" aria-hidden="true" focusable="false" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio={fill ? "none" : undefined}
      style={{ position: "absolute", left: NAME_COL, top: 0, width: `${POLE_COL_REM}rem`, height: fill ? "100%" : `${pole.height}rem`, overflow: "visible", pointerEvents: "none" }}>
      {pole.month ? <rect className="klMonth" x={mid - 3} y={pole.month.top * U} width={6} height={Math.max(1, (pole.month.bottom - pole.month.top) * U)} rx={3} fill={C.month} /> : null}
      {pole.day ? <rect className="klDay" x={mid - 7} y={pole.day.top * U} width={14} height={Math.max(2, (pole.day.bottom - pole.day.top) * U)} rx={4} fill={C.day} /> : null}
      {pole.rows.map((r, i) => {
        const ty = r.y * U, ly = r.ly * U;
        if (r.last) {
          return (
            <g key={i} className="klLastMark">
              <line x1={mid - 9.5} x2={mid + 9.5} y1={ty} y2={ty} stroke={C.accent} strokeWidth={3} strokeLinecap="round" vectorEffect={v} />
              <path d={`M${mid - 10.5} ${ty} l-3 -3 v6 z`} fill={C.accent} />
              <path d={`M${mid + 9.5} ${ty} L${W} ${ly}`} stroke={C.accent} fill="none" strokeWidth={1} vectorEffect={v} />
            </g>
          );
        }
        const c = SIDE_COLOUR[r.side];
        // Every level keeps its own tick at its true height; a crowded label's ticks all lead to it.
        return (
          <g key={i} className="klTick" data-side={r.side}>
            {r.members.map((m, j) => {
              const my = m.y * U;
              return (
                <g key={j}>
                  <line x1={mid - 9} x2={mid + 9} y1={my} y2={my} stroke={c} strokeWidth={2} vectorEffect={v} />
                  <path className="klLeader" d={`M${mid - 9} ${my} L${mid - 12} ${ly} L0 ${ly}`} stroke={C.leader} fill="none" strokeWidth={1} vectorEffect={v} />
                  <path className="klLeader" d={`M${mid + 9} ${my} L${mid + 12} ${ly} L${W} ${ly}`} stroke={C.leader} fill="none" strokeWidth={1} vectorEffect={v} />
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/** One label row at its placed height: name on the left, price and distance (or the last-price pill) on the right. */
function PoleLabel({ r, fillOf }: { r: Pole["rows"][number]; /** Filling: the pole's own height, in rem. */ fillOf?: number }) {
  const at = fillOf ? `calc(100% * ${(r.ly / fillOf).toFixed(5)} - ${LABEL_LINE_REM / 2}rem)` : `calc(${r.ly}rem - ${LABEL_LINE_REM / 2}rem)`;
  return (
    <div className="klLabel" data-label={r.label} data-last={r.last ? "1" : undefined} data-side={r.side}
      style={{ position: "absolute", left: 0, right: 0, top: at, display: "grid", gridTemplateColumns: `${NAME_COL} ${POLE_COL_REM}rem minmax(0, 1fr)`, alignItems: "start", fontSize: "var(--fs-label)", lineHeight: 1.25 }}>
      {/* NEVER WRAPPING (#123): each short name on one line, its period tags small and muted; a label of two names stacks them. */}
      <span className="klName" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", color: C.value, paddingRight: 2, minWidth: 0 }}>
        {r.last ? null : (r.parts.length ? r.parts : [{ name: r.label, tags: [] }]).map((p) => (
          <span key={p.name} className="klPart" style={{ whiteSpace: "nowrap" }}>{p.name}{p.tags.length ? <span className="klTag" style={{ marginLeft: "0.3em", color: C.muted, fontSize: "var(--fs-fine)", fontWeight: 700, letterSpacing: "0.04em" }}>{p.tags.join(" ")}</span> : null}</span>
        ))}
      </span>
      <span />
      {r.last ? (
        <span className="klPill" style={{ justifySelf: "start", display: "inline-flex", flexWrap: "wrap", columnGap: "0.45em", whiteSpace: "nowrap", padding: "0 0.45em", marginTop: "-0.15rem", borderRadius: 6, border: `1px solid ${C.accent}`, background: "rgba(124,179,240,0.16)", color: C.value, fontSize: "var(--fs-label)", fontWeight: 800, lineHeight: 1.4 }}>
          <span>Last price</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{poleNumber(r.value)}</span>
        </span>
      ) : (
        <span className="klValue" style={{ display: "flex", columnGap: "0.5em", paddingLeft: 2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          <span style={{ color: SIDE_COLOUR[r.side], fontWeight: 700, whiteSpace: "nowrap" }}>{r.valueText}</span>
          {r.dist ? <span className="klDist" style={{ color: C.muted, fontSize: "var(--fs-fine)", whiteSpace: "nowrap" }}>{r.dist}</span> : null}
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
  fill = false,
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
  /** The SPX page (#563 COWORK #129): the pole takes the card's spare height, which that page's CSS gives it. */
  fill?: boolean;
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
        <div className="klTags" style={{ marginTop: 6 }}>{TAG_NOTE}</div>
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
          {(() => {
            const poleEl = (
              <div ref={box} className="klPole" aria-hidden="true" data-fill={fill ? "" : undefined}
                style={fill
                  ? { position: "relative", flex: "1 1 auto", minHeight: `${pole.height}rem`, maxHeight: `${pole.height * KL_FILL_MAX}rem`, containerType: "inline-size" }
                  : { position: "relative", height: `${pole.height}rem`, marginTop: 12, containerType: "inline-size" }}>
                <style>{`@container (max-width: ${DIST_MIN_REM}rem) { .klPole > * { --kl-name: ${NAME_SHARE_NARROW}; } .klDist { display: none; } }`}</style>
                <PoleSvg pole={pole} fill={fill} />
                {pole.rows.map((r) => <PoleLabel key={`${r.label}${r.value}`} r={r} fillOf={fill ? pole.height : undefined} />)}
              </div>
            );
            // The wrapper carries the pole's margin and centres it once it reaches its cap.
            return fill ? <div className="klFill" style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", justifyContent: "center", marginTop: 12 }}>{poleEl}</div> : poleEl;
          })()}
          {/* The same levels in words, in price order, for screen readers (the pole above is aria-hidden). */}
          <ul className="klList" style={srOnly}>{poleListWords(pole).map((t) => <li key={t}>{t}</li>)}</ul>
          {/* The key: a legend at --fs-label as #115 rules, tagged as fine print (not reading text). */}
          <p className="klKey" data-fine-print style={{ margin: "10px 0 0", fontSize: "var(--fs-label)", lineHeight: 1.45, color: C.muted }}>
            <strong style={{ color: SIDE_COLOUR.up }}>Green</strong>{POLE_KEY.slice("Green".length, POLE_KEY.indexOf("red"))}<strong style={{ color: SIDE_COLOUR.down }}>red</strong>{POLE_KEY.slice(POLE_KEY.indexOf("red") + 3)}
          </p>
        </>
      ) : k.reasons.map((r) => <p key={r} className="klReason" style={noteStyle}>{r}</p>)}
      {pole?.merged || pole?.skipped || credit ? (
        <p className="klCredit" data-fine-print style={noteStyle}>
          {pole?.merged ? <>{pole.merged}{pole.skipped || credit ? " · " : ""}</> : null}
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
