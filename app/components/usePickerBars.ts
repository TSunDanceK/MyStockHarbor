"use client";

// THE CANDLES FOR THE ROWS ON SCREEN (#553 COWORK #214, cut 1, 2026-10-12).
//
// Picker pages ship each row's chart SUMMARY (lib/pickerChartLite.ts), not its
// 72 bars. A view that draws candles -- the chart view's visible cards, an
// expanded phone row -- asks /api/picker-charts for just those symbols: one
// HMGET of the rows drawn, instead of every symbol's bars on every page read.
//
// Fetched once per symbol per page load (a module-level map, so re-renders and
// paging back and forth do not re-ask), in batches of at most
// PICKER_BARS_BATCH. `undefined` = not asked yet or in flight; `null` = asked
// and the hash had nothing (the chart then says "Chart preview unavailable",
// exactly as before for an un-warmed symbol).
import { useEffect, useState } from "react";
import type { MiniCandlePoint } from "@/app/components/MiniPickerCandleChart";

/** The route's own cap; a visible page is 21 cards or one row. */
export const PICKER_BARS_BATCH = 30;

const known = new Map<string, MiniCandlePoint[] | null>();
const inFlight = new Set<string>();
/** Every mounted grid's re-render, called when a batch lands (so a remount mid-fetch still updates). */
const listeners = new Set<() => void>();

async function fetchBatch(symbols: string[]): Promise<void> {
  symbols.forEach((s) => inFlight.add(s));
  try {
    const res = await fetch(`/api/picker-charts?symbols=${encodeURIComponent(symbols.join(","))}`);
    const body = res.ok ? ((await res.json()) as { bars?: Record<string, MiniCandlePoint[]> }) : null;
    for (const s of symbols) {
      const pts = body?.bars?.[s];
      known.set(s, Array.isArray(pts) && pts.length ? pts : null);
    }
  } catch {
    for (const s of symbols) known.set(s, null);
  } finally {
    symbols.forEach((s) => inFlight.delete(s));
    listeners.forEach((l) => l());
  }
}

/** Bars for `symbols`, fetched on first sight. Keyed by symbol. */
export function usePickerBars(symbols: string[]): Record<string, MiniCandlePoint[] | null | undefined> {
  const [, bump] = useState(0);
  const wantedKey = symbols.join(",");

  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    const missing = Array.from(new Set(wantedKey ? wantedKey.split(",") : [])).filter((s) => s && !known.has(s) && !inFlight.has(s));
    for (let i = 0; i < missing.length; i += PICKER_BARS_BATCH) void fetchBatch(missing.slice(i, i + PICKER_BARS_BATCH));
  }, [wantedKey]);

  const out: Record<string, MiniCandlePoint[] | null | undefined> = {};
  for (const s of symbols) out[s] = known.get(s);
  return out;
}
