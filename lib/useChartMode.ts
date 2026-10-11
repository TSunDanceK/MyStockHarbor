"use client";

// THE CHART'S TWO BROWSER-ONLY READS (#553 COWORK #165), kept out of
// StockPriceChart so that file stays effect-free (the chart checks hold it to
// "reads the bars it was given": no fetch, no effect). Neither reads the
// network:
//   useChartMode   Line | Candles: Line on the server and until mount, then the
//                  browser's remembered choice (localStorage, try/catch).
//   usePlotWidth   the plot's on-screen width, for the >= 3 px candle rule.
import { useEffect, useState, type RefObject } from "react";
import { readChartMode, writeChartMode, type ChartMode } from "@/lib/chartCandles";

export function useChartMode(enabled: boolean): { mode: ChartMode; chooseMode: (m: ChartMode) => void } {
  const [mode, setMode] = useState<ChartMode>("line");
  useEffect(() => {
    if (!enabled) return;
    let stored: ChartMode = "line";
    try { stored = readChartMode(window.localStorage); } catch { stored = "line"; }
    // Mount-time restore of a per-browser choice; nothing cascades from it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "candles") setMode("candles");
  }, [enabled]);
  const chooseMode = (next: ChartMode) => {
    setMode(next);
    try { writeChartMode(window.localStorage, next); } catch {}
  };
  return { mode, chooseMode };
}

export function usePlotWidth(ref: RefObject<Element | null>, fraction: number): number {
  const [px, setPx] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setPx((el.clientWidth || 0) * fraction));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fraction]);
  return px;
}
