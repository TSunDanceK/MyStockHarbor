"use client";

// ESTIMATED AND DERIVED FIGURES IN A PICKERS CELL (#553 COWORK #102, on A's
// layer from #696).
//
//   EstimateCell        -- a filed, estimated or derived figure. A figure with
//                          a mark goes through A's EstimatedValue ("≈" in the
//                          estimate colour, or "derived", with the note on
//                          hover and tap); one without renders as plain text,
//                          exactly as before. Nothing here draws a mark itself.
//   PickerEstimateKey   -- A's EstimateKey, for the marks a reader can see.
//   estimateMarksShown  -- which marks those are (pure, for the check).
//
// `inert`: the phone row's collapsed line sits inside its toggle button, where
// a nested control is invalid. There the mark still SHOWS (the "≈" and colour,
// or "derived"), but the wrapper is `inert`, so a tap opens the row rather
// than the note and nothing inside takes focus; the expanded row below shows
// the same figure as a control. Elsewhere a tap on the mark is kept from the
// table row, whose own click navigates to the stock.
import type { ReactNode } from "react";
import { EstimatedValue } from "@/app/components/EstimatedValue";
import { EstimateKey } from "@/app/components/EstimateKey";
import type { EstimateMark } from "@/app/components/estimateMark";

export type CellMarks = Partial<Record<string, EstimateMark>> | undefined;

/** A figure that may carry A's estimate mark. `text` null: the caller's dash. */
export function EstimateCell({ text, est, inert, empty }: { text: string | null; est?: EstimateMark | null; inert?: boolean; empty: ReactNode }) {
  if (text == null) return <>{empty}</>;
  if (!est) return <>{text}</>;
  const marked = <EstimatedValue text={text} est={est} />;
  if (inert) return <span inert>{marked}</span>;
  // A tap on the mark opens its note; it must not also fire the table row's
  // click, which navigates to the stock (the same rule as PickerCellMarks).
  return <span className="estCell" onClick={(ev) => ev.stopPropagation()}>{marked}</span>;
}

/**
 * The marks on the cells a reader can see: every row's cells in `keysFor`'s
 * columns (the table's columns; on a phone, the headline column, plus every
 * metric column of an expanded row).
 */
export function estimateMarksShown<E extends { cellEst?: CellMarks }>(entries: E[], keysFor: (e: E) => string[]): EstimateMark[] {
  const out: EstimateMark[] = [];
  for (const e of entries) {
    const marks = e.cellEst;
    if (!marks) continue;
    for (const k of keysFor(e)) {
      const m = marks[k];
      if (m) out.push(m);
    }
  }
  return out;
}

/** A's key, listing only the kinds shown; nothing when there are none. */
export function PickerEstimateKey({ marks }: { marks: EstimateMark[] }) {
  return <EstimateKey marks={marks} style={{ margin: "8px 2px 0", color: "rgba(203,213,225,0.9)" }} />;
}
