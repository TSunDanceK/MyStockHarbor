// THE "PERFORMANCE VS THE S&P 500" CARD'S LAYOUT (#563 COWORK #111): one row per
// period, 1M · 3M · YTD · 1Y · 3Y · 5Y, each a bar from a centre zero line with
// the S&P 500's change as a tick on the same scale.
//
// NOTHING IS RECOMPUTED HERE: the returns and the S&P 500 comparison are the
// performance strip's own (lib/ta/performance.ts, B's arithmetic over the bars
// the page already reads). This module only places them.
//
// THE SCALE: square root, shared by all six rows, the sign kept. A linear shared
// scale would squash a +4% month against a +136% five years; one per row would
// make rows look alike that aren't. At sqrt, +4% draws at about a sixth of +136%
// rather than a thirty-fourth, and every row is still on the same ruler.
// Positions are % of the track's width, 50 being zero; the widest value reaches
// the track's end (2% inside it).
//
// COPY IS DESCRIPTIVE: past price change, "ahead of" / "behind" the S&P 500. No
// "best" / "weakest" tags: ranking returns over different spans misleads (#563 COWORK #113).
import { LEVEL_WITH_PTS, PRICE_ONLY, pctWords, type PerfKey, type PerfStrip } from "./performance";

export type PerfRow = {
  key: PerfKey;
  pct: number | null;
  spyPct: number | null;
  diffPts: number | null;
  /** Why a period shows "—" (too little history), or why the S&P 500 comparison is missing. */
  reason: string | null;
  tone: "up" | "down" | "flat";
  /** The bar: from the zero line (50) to `barTo`, in % of the track; null when the period is missing. */
  barTo: number | null;
  /** The S&P 500 tick's position, in % of the track; null without a comparison. */
  tick: number | null;
  /** "ahead" / "behind" / "level" against the S&P 500, or null without a comparison. */
  vs: "ahead" | "behind" | "level" | null;
  /** "+13.2 pts vs S&P", "−4.1 pts vs S&P", "level with S&P". */
  vsWords: string | null;
};

export type PerfCard = {
  rows: PerfRow[];
  /** "Ahead of the S&P 500 in 4 of 6 periods", counted from the rows; null with no comparison at all. */
  summary: string | null;
  /** The largest |value| on the shared scale (a % change). */
  maxAbs: number;
  /** The tap note's sentences. */
  note: string[];
};

/** Square root with the sign kept. */
export const signedSqrt = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
/** A % change's place on the track, 0–100, 50 being zero, on the shared square-root scale. */
export function trackPos(v: number, maxAbs: number): number {
  if (!(maxAbs > 0)) return 50;
  return 50 + (signedSqrt(v) / Math.sqrt(maxAbs)) * 48;
}

/** "+13.2 pts vs S&P" / "−4.1 pts vs S&P" / "level with S&P". */
export function vsWords(diff: number): string {
  const d = Math.round(Math.abs(diff) * 10) / 10;
  if (d < LEVEL_WITH_PTS) return "level with S&P";
  return `${diff > 0 ? "+" : "−"}${d.toFixed(1)} pts vs S&P`;
}

export const SCALE_NOTE = "The bars use a square-root scale shared by all six rows (the sign kept), so a one-month move and a five-year move both stay readable on the same ruler.";

export function performanceCard(strip: PerfStrip): PerfCard {
  const vals = strip.chips.flatMap((c) => [c.pct, strip.benchmark ? c.spyPct : null]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const maxAbs = vals.length ? Math.max(...vals.map(Math.abs)) : 0;
  const rows = strip.chips.map((c): PerfRow => {
    const tone = c.pct === null ? "flat" : c.pct > 0 ? "up" : c.pct < 0 ? "down" : "flat";
    const diff = strip.benchmark ? c.diffPts : null;
    const vs = diff === null ? null : Math.round(Math.abs(diff) * 10) / 10 < LEVEL_WITH_PTS ? "level" : diff > 0 ? "ahead" : "behind";
    return {
      key: c.key, pct: c.pct, spyPct: strip.benchmark ? c.spyPct : null, diffPts: diff,
      reason: c.pct === null ? c.reason : strip.benchmark && c.spyPct === null ? c.spyReason : null,
      tone,
      barTo: c.pct === null ? null : trackPos(c.pct, maxAbs),
      tick: strip.benchmark && c.spyPct !== null && c.pct !== null ? trackPos(c.spyPct, maxAbs) : null,
      vs, vsWords: diff === null ? null : vsWords(diff),
    };
  });
  const compared = rows.filter((r) => r.vs !== null);
  const ahead = compared.filter((r) => r.vs === "ahead").length;
  const summary = compared.length ? `Ahead of the S&P 500 in ${ahead} of ${compared.length} period${compared.length === 1 ? "" : "s"}` : null;
  const end = strip.live
    ? strip.live.phase === "afterClose" ? `the close${strip.live.time ? `, ${strip.live.time} ET` : ""} (IEX)` : `the last price${strip.live.time ? `, ${strip.live.time} ET` : ""} (IEX)`
    : strip.asOfWords ? `the close on ${strip.asOfWords}` : "the latest close";
  const note = [
    `Each row is the price change from the close at the start of the period (the nearest trading day before it; for YTD, the last close of the previous year) to ${end}.`,
    PRICE_ONLY,
    ...(strip.benchmark ? ["The thin tick on each bar is the S&P 500 (SPY) over the same dates. A bar that ends to the right of its tick did better than the S&P 500 over that period; one that ends to the left did worse."] : []),
    SCALE_NOTE,
    ...rows.filter((r) => r.reason).map((r) => `${r.key}: ${r.reason}`),
  ];
  return { rows, summary, maxAbs, note };
}

/** "+29.0%", or "—" when the period is missing. */
export const rowPctWords = (r: PerfRow) => (r.pct === null ? "—" : pctWords(r.pct));
