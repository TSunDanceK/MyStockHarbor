// The /dashboard "wide chart" layout (Relay B, #553 COWORK #27). Layout only:
// no price, quote or history code is touched.
//
// The desktop grid is a 360px card column beside the chart (DashboardClient's
// `.msh-grid`). Wide mode gives the chart the full width and moves the Overview
// and Breakdown cards below it, side by side.
//
// THE BASIC CHART HAS TO RE-MEASURE, NOT JUST STRETCH. It is an SVG drawn in a
// fixed 760-unit viewBox at width 100%, so a wider box would scale it up
// uniformly: at 1280px it would grow from ~490px to ~700px tall with oversized
// type. Instead the viewBox widens by the same factor as the box, which keeps
// the unit-to-pixel scale -- and so the chart's height and its type size --
// exactly what they are in the normal layout. The Interactive engine has its
// own ResizeObserver; the TradingView widget is created with autosize.

/** Must match `.msh-grid` in DashboardClient: `grid-template-columns:360px 1fr; gap:16px`. */
export const DASH_CARD_COLUMN_PX = 360;
export const DASH_GRID_GAP_PX = 16;
/** The chart card body's padding, each side. */
export const DASH_CHART_PAD_PX = 16;
/** PriceChart's own drawing width. */
export const BASIC_VIEW_WIDTH = 760;

/** The per-viewer choice, in localStorage. */
export const WIDE_CHART_KEY = "msh:dashboard:wide-chart:v1";

/**
 * The Basic chart's viewBox width in wide mode, given the grid's measured
 * width. Normal mode (or a width too narrow to have two columns) is 760.
 */
export function wideViewWidth(gridWidth: number): number {
  const wide = gridWidth - 2 * DASH_CHART_PAD_PX;
  const normal = gridWidth - DASH_CARD_COLUMN_PX - DASH_GRID_GAP_PX - 2 * DASH_CHART_PAD_PX;
  if (!Number.isFinite(gridWidth) || normal <= 200 || wide <= normal) return BASIC_VIEW_WIDTH;
  return Math.round((BASIC_VIEW_WIDTH * wide) / normal);
}

/** The shared guarded storage read (lib/browserStorage.ts, #553 COWORK #33). */
export { browserStorage } from "./browserStorage";

/** Read the remembered choice; false when storage is absent or throws. */
export function readWideChoice(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
  try {
    return storage?.getItem(WIDE_CHART_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remember the choice; a throwing or absent storage is ignored. */
export function writeWideChoice(storage: Pick<Storage, "setItem"> | null | undefined, wide: boolean): void {
  try {
    storage?.setItem(WIDE_CHART_KEY, wide ? "1" : "0");
  } catch {
    // Private windows and blocked storage: the page still works, it just forgets.
  }
}

/**
 * The button's icon, a bold arrow in a 20-unit box (#553 COWORK #35). An arrow
 * with a shaft, not a bare chevron: the Basic chart's pan control is a "‹".
 * LEFT in the normal layout: the chart extends left over the card column.
 * RIGHT in wide mode: it goes back to its column.
 */
export const WIDE_ARROW_LEFT = "M16 10H4M9 5l-5 5 5 5";
export const WIDE_ARROW_RIGHT = "M4 10h12M11 5l5 5-5 5";
