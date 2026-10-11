"use client";

import { usePickerFilter } from "@/app/components/PickerFilterContext";
import { describePredicate, predicateId } from "@/lib/screenerFields";

/**
 * The applied-filters row, sitting directly above the results.
 *
 * Before this, "what is currently filtering this list" was answerable three
 * different half-ways -- ticked checkboxes (invisible once the Select Screener
 * sheet is closed), a sentence in the results header (not actionable), and the
 * Go button's count (only visible while the sheet is open). On a phone that
 * meant scrolling a filtered list with no indication of what was filtering it.
 *
 * This replaces the sentence rather than adding to it, so the page gains no
 * extra vertical space: same information, now removable in one tap. Chips are
 * rendered from describePredicate, so a numeric filter reads "PE Ratio under
 * 15" with no work here.
 *
 * The page's own condition (Oversold on /oversold-stocks-today) deliberately
 * appears as an ordinary chip. Removing it turns the page into the Advanced
 * Screener in place, which is exactly the behaviour the condition pages were
 * rebuilt around -- and it's already removable via its checkbox, so giving the
 * chip different rules would be inconsistent for no gain. Getting back is
 * covered by the "Back to ..." link in the hero.
 */
export default function ScreenerFilterBar({
  matched,
  total,
}: {
  matched: number;
  total: number;
}) {
  const { predicates, removePredicate, clearFilters } = usePickerFilter();

  if (!predicates.length) return null;

  return (
    <div className="screenerChipBar">
      <span className="screenerChipCount">
        {matched} of {total}
      </span>

      {predicates.map((predicate) => (
        <button
          key={predicateId(predicate)}
          type="button"
          className="screenerChip"
          onClick={() => removePredicate(predicate.kind, predicate.field)}
          aria-label={`Remove filter: ${describePredicate(predicate)}`}
          title="Remove this filter"
        >
          <span className="screenerChipLabel">{describePredicate(predicate)}</span>
          <span className="screenerChipX" aria-hidden="true">
            ✕
          </span>
        </button>
      ))}

      {predicates.length > 1 ? (
        <button type="button" className="screenerChipClear" onClick={clearFilters}>
          Clear all
        </button>
      ) : null}

      <style>{`
        .screenerChipBar {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin: 12px 0 0;
        }
        .screenerChipCount {
          flex: 0 0 auto;
          font-size: 12.5px;
          font-weight: 800;
          color: rgba(226,232,240,0.65);
          white-space: nowrap;
        }
        .screenerChip {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          max-width: 100%;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid rgba(96,165,250,0.42);
          background: rgba(59,130,246,0.14);
          color: #dbeafe;
          font-family: inherit;
          font-size: 12.5px;
          font-weight: 800;
          line-height: 1.2;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: background 140ms ease, border-color 140ms ease;
        }
        .screenerChip:hover { background: rgba(59,130,246,0.24); border-color: rgba(96,165,250,0.7); }
        .screenerChip:active { transform: translateY(1px); }
        /* The label can be long once numeric filters are in play ("Dividend
           Yield over 3"), so it truncates rather than wrapping the chip onto
           two lines and breaking the pill shape. */
        .screenerChipLabel {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .screenerChipX { flex: 0 0 auto; font-size: 10px; opacity: 0.75; }
        .screenerChip:hover .screenerChipX { opacity: 1; }
        .screenerChipClear {
          flex: 0 0 auto;
          padding: 6px 11px;
          border-radius: 999px;
          border: 1px solid rgba(239,68,68,0.32);
          background: rgba(239,68,68,0.08);
          color: #fca5a5;
          font-family: inherit;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .screenerChipClear:hover { background: rgba(239,68,68,0.16); }
        @media (max-width: 720px) {
          .screenerChipBar { gap: 6px; }
          .screenerChip { font-size: 12px; padding: 6px 9px; }
          /* Keeps a long chip from pushing the row wider than the viewport on a
             narrow phone -- it truncates instead. */
          .screenerChipLabel { max-width: 62vw; }
        }
      `}</style>
    </div>
  );
}
