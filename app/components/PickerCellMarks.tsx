"use client";

// THE SMALL MARKS INSIDE A PICKERS CELL (#553 COWORK #69 / #90 / #94).
//
//   WhyMark   -- an empty cell: "–", or a word ("Loss", "Neg.", "n/a") in a
//                lighter tone, with its reason on hover (title) and on tap or
//                keyboard (a small popover).
//   BasisCell -- a filed P/E, EPS or Payout: the figure, with a fixed-width
//                slot BEFORE it that holds "FY" for a fiscal-year figure, so
//                the digits stay right-aligned down the column.
//
// Its own module, importing only React and lib/pickerCellWhy.ts, so
// scripts/check-pickers-cell-why.mjs can RENDER these and assert on the markup
// a reader gets, rather than grepping the grid's JSX.
import { useState, type ReactNode } from "react";
import { FY_MARK, fyMarkWords, isFiscalYearBasis } from "@/lib/pickerCellWhy";

/**
 * A mark that explains itself. `inert`: inside the phone row's toggle button,
 * where a nested control is invalid -- the reason stays on hover there, and the
 * expanded row below shows the same mark as a control.
 */
export function TipMark({
  text,
  label,
  className,
  inert,
  children,
}: {
  text: string;
  label: string;
  className: string;
  inert?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (inert) return <span className={className} title={text}>{children}</span>;
  const toggle = () => setOpen((o) => !o);
  return (
    <span
      className={className}
      title={text}
      role="button"
      tabIndex={0}
      aria-label={`${label}: ${text}`}
      aria-expanded={open}
      onClick={(ev) => { ev.stopPropagation(); toggle(); }}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); toggle(); }
        if (ev.key === "Escape") setOpen(false);
      }}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open ? <span className="whyPop" role="tooltip">{text}</span> : null}
    </span>
  );
}

/** An empty cell's mark: the dash, or a word cell in the lighter tone. */
export function WhyMark({ text, mark, word, na, inert }: { text: string; mark: string; word: boolean; na: boolean; inert?: boolean }) {
  return (
    <TipMark
      text={text}
      label={na ? "Not applicable" : word ? mark : "Not available"}
      className={word ? "whyMark whyWord" : "whyMark muted"}
      inert={inert}
    >
      {mark}
    </TipMark>
  );
}

/**
 * A filed figure and its period. The slot is always there when the row has a
 * basis, filled with "FY" only for a fiscal-year figure, and it comes FIRST:
 * the number keeps the cell's right edge either way.
 */
export function BasisCell({ value, basis, inert }: { value: ReactNode; basis: string; inert?: boolean }) {
  const fy = isFiscalYearBasis(basis);
  return (
    <span className="basisCell" title={basis}>
      <span className="basisSlot">
        {fy ? (
          <TipMark text={fyMarkWords(basis)} label="Fiscal year" className="basisFy" inert={inert}>
            {FY_MARK}
          </TipMark>
        ) : null}
      </span>
      <span className="basisVal">{value}</span>
    </span>
  );
}
