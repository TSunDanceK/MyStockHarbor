// The Interactive chart's menu, as data (Relay B, #553 COWORK #28).
//
// ONE MODEL, TWO RENDERINGS: the desktop right-click menu (fly-out sub-menus)
// and the phone bottom sheet (expandable sections) are both drawn from
// buildChartMenu(), so they cannot drift apart. Each item carries an ACTION ID
// ("type:area", "ind:RSI", "scale:percent", "recenter" …) that the component
// maps to the same functions the toolbar already calls.
//
// Pure: no DOM, no chart. scripts/check-interactive-tools.mjs runs it.

export type MenuItem = {
  id: string;
  label: string;
  /** A tick in the menu: the current chart type, timeframe, scale, active indicators. */
  checked?: boolean;
};

export type MenuSection = {
  key: string;
  label: string;
  /** Sub-menu items; a section with none is a single action (Recenter, Undo …). */
  items?: MenuItem[];
  /** The action for a section with no items. */
  id?: string;
};

export type ScaleMode = "price" | "percent";

export type MenuState = {
  interval: string;
  chartType: string;
  activeIndicators: string[];
  scale: ScaleMode;
  /** Whether a Fullscreen entry is offered (not when already fullscreen). */
  canFullscreen: boolean;
};

export type MenuCatalog = {
  chartTypes: { key: string; label: string }[];
  intervals: { key: string; label: string }[];
  indicators: { key: string; label: string }[];
  drawTools: { key: string; label: string }[];
  /** Measure tools (COWORK #28 part b); empty until they ship. */
  measureTools?: { key: string; label: string }[];
};

export function buildChartMenu(state: MenuState, cat: MenuCatalog): MenuSection[] {
  const active = new Set(state.activeIndicators);
  const sections: MenuSection[] = [
    { key: "type", label: "Chart type", items: cat.chartTypes.map((t) => ({ id: `type:${t.key}`, label: t.label, checked: t.key === state.chartType })) },
    { key: "tf", label: "Timeframe", items: cat.intervals.map((t) => ({ id: `tf:${t.key}`, label: t.label, checked: t.key === state.interval })) },
    { key: "ind", label: "Indicators", items: cat.indicators.map((t) => ({ id: `ind:${t.key}`, label: t.label, checked: active.has(t.key) })) },
    { key: "draw", label: "Draw", items: cat.drawTools.map((t) => ({ id: `draw:${t.key}`, label: t.label })) },
  ];
  if (cat.measureTools?.length) {
    sections.push({ key: "measure", label: "Measure", items: [...cat.measureTools.map((t) => ({ id: `measure:${t.key}`, label: t.label })), { id: "measure-clear", label: "Clear measures" }] });
  }
  sections.push(
    { key: "scale", label: "Scale", items: [
      { id: "scale:price", label: "Price", checked: state.scale === "price" },
      { id: "scale:percent", label: "% change", checked: state.scale === "percent" },
    ] },
    { key: "recenter", label: "Recenter", id: "recenter" },
    { key: "undo", label: "Undo", id: "undo" },
    { key: "clear", label: "Clear drawings", id: "clear" },
  );
  if (state.canFullscreen) sections.push({ key: "fullscreen", label: "Fullscreen", id: "fullscreen" });
  return sections;
}

/** Split an action id into its verb and argument: "ind:RSI" -> ["ind", "RSI"]. */
export function parseAction(id: string): [string, string | null] {
  const i = id.indexOf(":");
  return i < 0 ? [id, null] : [id.slice(0, i), id.slice(i + 1)];
}

/**
 * The % scale's base: the close of the FIRST VISIBLE bar, which is what
 * klinecharts' "percentage" y-axis measures from (getVisibleFirstData). Used
 * for the chip's label, so the reader can see what 0% means.
 */
export function percentBase(
  data: { timestamp: number; close: number }[],
  visibleFrom: number
): { close: number; timestamp: number } | null {
  const i = Math.max(0, Math.floor(visibleFrom));
  const bar = data[i];
  return bar && Number.isFinite(bar.close) ? { close: bar.close, timestamp: bar.timestamp } : null;
}

/** A value on the % axis: change from the base, in percent. */
export function pctFromBase(value: number, base: number): number {
  return ((value - base) / base) * 100;
}

/** Clamp a menu of size w x h, opened at (x, y), inside a box of size W x H. */
export function clampMenu(x: number, y: number, w: number, h: number, W: number, H: number, pad = 6): { left: number; top: number } {
  return {
    left: Math.max(pad, Math.min(x, W - w - pad)),
    top: Math.max(pad, Math.min(y, H - h - pad)),
  };
}

/**
 * Long-press on touch: fires after LONG_PRESS_MS if the finger has not moved
 * more than LONG_PRESS_SLOP px. A pan or pinch cancels it.
 */
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP = 8;
export function isLongPress(downAt: number, now: number, dx: number, dy: number): boolean {
  return now - downAt >= LONG_PRESS_MS && Math.hypot(dx, dy) <= LONG_PRESS_SLOP;
}

/** The viewer's remembered scale (localStorage, guarded by the caller). */
export const SCALE_KEY = "msh:interactive:scale:v1";
export function readScale(raw: string | null): ScaleMode {
  return raw === "percent" ? "percent" : "price";
}
