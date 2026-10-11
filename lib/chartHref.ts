// EVERY "CHART" LINK LANDS ON THE CHART (#563 COWORK #151).
//
// /dashboard opens on the research landing; the analyser (chart, levels,
// zones, filed earnings, news) sits below it at #analyser. A reader who taps
// "Chart" anywhere on the site must land on the analyser, scrolled to it, with
// the symbol loaded, so every chart-intent link is built here and nowhere else
// (scripts/check-chart-href.mjs holds the site to that). The brand logo, the
// header's "Dashboard" item and "← Dashboard" back links are navigation to the
// page itself and keep a plain "/" or "/dashboard".
import { cleanSymbol } from "@/lib/symbol";

export const ANALYSER_ID = "analyser";

type ChartParams = Record<string, string | number | null | undefined>;

/** `/dashboard?symbol=SYM&…#analyser`, or `/dashboard#analyser` with no symbol. Extra params (tf, indicator, srLower…) ride ahead of the hash. */
export function chartHref(symbol?: string | null, params?: ChartParams): string {
  const qs = new URLSearchParams();
  const sym = cleanSymbol(symbol);
  if (sym) qs.set("symbol", sym);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (k === "symbol" || v === null || v === undefined || v === "") continue;
    qs.set(k, String(v));
  }
  const q = qs.toString();
  return `/dashboard${q ? `?${q}` : ""}#${ANALYSER_ID}`;
}

/**
 * A chart link from stored data (the picker and plays builders' `dashboardHref`,
 * which older cached payloads hold as "/?symbol=X&tf=D…#chart"), rebuilt through
 * chartHref: its query params are kept, its path and hash are not, and
 * `fallbackSymbol` fills a missing symbol.
 */
export function chartHrefFrom(stored: string | null | undefined, fallbackSymbol?: string | null): string {
  const raw = String(stored ?? "").trim();
  const query = raw.startsWith("/") ? raw.split("#")[0].split("?")[1] ?? "" : "";
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  return chartHref(params.symbol || fallbackSymbol, params);
}

/** Does this URL ask for the analyser? chartHref's #analyser, the older #chart, or any ?symbol= deep link. */
export function wantsAnalyser(hash: string, symbol: string | null | undefined): boolean {
  return hash === `#${ANALYSER_ID}` || hash === "#chart" || !!cleanSymbol(symbol);
}

/** A reader who asks for reduced motion gets a jump, never an animated scroll. */
export function scrollMotion(): ScrollBehavior {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
  } catch {
    return "instant";
  }
}

/** What ends the hold: the reader moving the page themselves. */
const READER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * LAND ON THE ANALYSER AND STAY THERE WHILE THE PAGE SETTLES (#563 COWORK #152).
 * One jump is not enough on a phone: arriving by client navigation, Next scrolls
 * the new page to its top AFTER the page's own effects run, and the hero's
 * images and fonts can still move the analyser down. So: jump now, then re-jump
 * whenever the analyser has drifted from where the jump put it (on the next two
 * frames, on any layout change, when fonts and the window load), for at most
 * `settleMs`. The moment the reader scrolls, taps or types, it lets go and
 * never re-scrolls. Always a jump ("instant"), never an animation. Returns the
 * cleanup.
 */
export function holdOnAnalyser(get: () => HTMLElement | null, settleMs = 3000): () => void {
  let done = false, target: number | null = null, raf1 = 0, raf2 = 0;
  const jump = () => {
    const el = get();
    if (!el) return;
    el.scrollIntoView({ behavior: "instant", block: "start" });
    target = el.getBoundingClientRect().top;
  };
  const again = () => {
    if (done) return;
    const el = get();
    if (!el) return;
    if (target === null || Math.abs(el.getBoundingClientRect().top - target) > 2) jump();
  };
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(again);
  const stop = () => {
    if (done) return;
    done = true;
    for (const e of READER_INPUT) window.removeEventListener(e, stop, true);
    window.removeEventListener("load", again);
    window.removeEventListener("scroll", again);
    ro?.disconnect();
    cancelAnimationFrame(raf1);
    cancelAnimationFrame(raf2);
    window.clearTimeout(timer);
  };
  jump();
  for (const e of READER_INPUT) window.addEventListener(e, stop, { capture: true, passive: true });
  // A scroll the reader did not make (the router's, a layout shift) is undone.
  window.addEventListener("scroll", again, { passive: true });
  raf1 = requestAnimationFrame(() => { again(); raf2 = requestAnimationFrame(again); });
  ro?.observe(document.body);
  document.fonts?.ready.then(again).catch(() => {});
  if (document.readyState !== "complete") window.addEventListener("load", again, { once: true });
  const timer = window.setTimeout(stop, settleMs);
  return stop;
}
