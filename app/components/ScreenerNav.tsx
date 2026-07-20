"use client";

import Link from "next/link";
import { useState } from "react";
import { usePickerFilter } from "@/app/components/PickerFilterContext";
import { TickerSearch } from "@/app/components/TickerSearchBox";
import { FILTER_DEFS, toneDotColor, type FilterKey } from "@/lib/pickerFilters";

type Tone = "green" | "yellow" | "orange" | "red" | "blue";

// `filterKey` links a category straight to one of the 18 boolean
// conditions /pickers' own custom screener uses (see lib/pickerFilters.ts).
// Only set on categories with an exact one-to-one match to a single
// boolean field -- e.g. the "Oversold" page is exactly the `oversold`
// flag. Categories that are computed scores or separate datasets (Buy
// Signals, Best Trend, Divergence, Macro S/R, the three chart-pattern
// plays) are left unmapped and keep working as plain navigation links even
// while filter mode is on -- see MoreFilters below for the remaining
// boolean conditions that don't have a category of their own.
type NavItem = { href: string; label: string; icon: string; tone: Tone; filterKey?: FilterKey };
type NavGroup = { heading: string; headingColor: string; items: NavItem[] };

// Grouped so the column reads like the Learn sidebar (coloured section
// headers) instead of one long flat list. Every existing screener page is
// represented; order within a group roughly follows how related the setups
// are.
const GROUPS: NavGroup[] = [
  {
    heading: "Signals",
    headingColor: "#60a5fa",
    items: [
      { href: "/top-stocks-with-buy-signals", label: "Buy Signals", icon: "▲", tone: "green" },
      { href: "/top-stocks-with-sell-signals", label: "Sell Signals", icon: "▼", tone: "red" },
    ],
  },
  {
    heading: "Momentum",
    headingColor: "#22c55e",
    items: [
      { href: "/oversold-stocks-today", label: "Oversold", icon: "●", tone: "green", filterKey: "oversold" },
      { href: "/overbought-stocks-today", label: "Overbought", icon: "●", tone: "red", filterKey: "overbought" },
      { href: "/best-trend-score-stocks", label: "Best Trend", icon: "★", tone: "green" },
      { href: "/bullish-bearish-divergence-stocks", label: "Divergence", icon: "⚇", tone: "blue" },
    ],
  },
  {
    heading: "Highs & Breakouts",
    headingColor: "#fb923c",
    items: [
      { href: "/all-time-high-breakout-stocks", label: "ATH Breakouts", icon: "↗", tone: "orange" },
      { href: "/3-month-high-breakout-stocks", label: "3-Month Highs", icon: "↗", tone: "orange" },
      { href: "/stocks-down-20-from-all-time-highs", label: "20% From ATH", icon: "◆", tone: "yellow", filterKey: "buyTheDip" },
    ],
  },
  {
    heading: "Moving Averages",
    headingColor: "#facc15",
    items: [
      { href: "/stocks-near-200-day-moving-average", label: "Near 200-Day", icon: "◇", tone: "yellow", filterKey: "dailyMa200Proximity" },
      { href: "/stocks-near-weekly-200-day-moving-average", label: "Weekly MA200", icon: "◆", tone: "yellow", filterKey: "weeklyMa200Proximity" },
    ],
  },
  {
    heading: "Earnings",
    headingColor: "#34d399",
    items: [
      { href: "/stocks-with-positive-last-earnings", label: "Last Earnings", icon: "✓", tone: "green", filterKey: "positiveLastEarnings" },
      { href: "/stocks-with-strong-earnings-growth", label: "Earnings Growth", icon: "↗", tone: "green", filterKey: "strongEarningsGrowth" },
    ],
  },
  {
    heading: "Chart Plays",
    headingColor: "#c084fc",
    items: [
      { href: "/macro-support-resistance-stocks", label: "Macro S/R", icon: "⇄", tone: "blue" },
      { href: "/plays", label: "Ascending Triangles", icon: "△", tone: "green" },
      { href: "/plays/bull-flags", label: "Bull Flags", icon: "⚑", tone: "green" },
      { href: "/plays/descending-triangles", label: "Descending Triangles", icon: "▽", tone: "red" },
    ],
  },
];

// The FILTER_DEFS conditions with no category of their own above (volume
// spike, ATR spike, MA50/MA200 above-below, the four divergence flags) --
// still reachable while filter mode is on, just grouped separately instead
// of pretending they map onto a category link.
const MAPPED_FILTER_KEYS = new Set(
  GROUPS.flatMap((group) => group.items)
    .map((item) => item.filterKey)
    .filter((key): key is FilterKey => Boolean(key))
);
const OTHER_FILTER_DEFS = FILTER_DEFS.filter((filter) => !MAPPED_FILTER_KEYS.has(filter.key));

function toneColour(tone: Tone) {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#facc15";
  if (tone === "orange") return "#fb923c";
  if (tone === "red") return "#ef4444";
  return "#60a5fa";
}

// Renders the category list. Off, every item is a plain link (legacy
// behaviour: tap "Oversold", go to the Oversold page). On (`filterMode`),
// any item with a `filterKey` grows a checkbox in its place -- ticking
// "Oversold" and "Best Trend"... well, Best Trend has no boolean
// equivalent, but ticking "Oversold" and (say) "Near 200-Day" combines
// them via the same AND logic /pickers' own filter chips use, narrowing
// *this* page's own results instead of navigating anywhere. Items with no
// filterKey keep working as plain links even in filter mode (with a small
// "opens page" hint so that's not confusing).
function NavList({
  currentHref,
  onNavigate,
  filterMode = false,
}: {
  currentHref: string;
  onNavigate?: () => void;
  filterMode?: boolean;
}) {
  const { selectedFilters, toggleFilter } = usePickerFilter();

  return (
    <div className="screenerNavList">
      {GROUPS.map((group) => (
        <div key={group.heading} className="screenerNavGroup">
          <div className="screenerNavHeading" style={{ color: group.headingColor }}>
            {group.heading}
          </div>
          {group.items.map((item) => {
            const active = item.href === currentHref;
            const colour = toneColour(item.tone);

            if (filterMode && item.filterKey) {
              const key = item.filterKey;
              const checked = selectedFilters.includes(key);
              return (
                <label
                  key={item.href}
                  className={checked ? "screenerNavItem screenerNavCheckable checked" : "screenerNavItem screenerNavCheckable"}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleFilter(key)} />
                  <span className="screenerNavIcon" style={{ color: colour }}>
                    {item.icon}
                  </span>
                  <span className="screenerNavLabel">{item.label}</span>
                </label>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={active ? "screenerNavItem active" : "screenerNavItem"}
                aria-current={active ? "page" : undefined}
                style={
                  active
                    ? {
                        borderColor: `${colour}88`,
                        background: `linear-gradient(135deg, ${colour}22, rgba(15,23,42,0.35))`,
                      }
                    : undefined
                }
              >
                <span className="screenerNavIcon" style={{ color: colour }}>
                  {item.icon}
                </span>
                <span className="screenerNavLabel">{item.label}</span>
                {filterMode ? <span className="screenerNavHint">opens page</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// The button that lives directly above the "Signals" heading -- toggles
// whether the category list above renders checkboxes (see NavList) or
// plain links. Mirrors the "Open Filters"/"Hide" wording already used by
// /pickers' own custom screener toggle (PickersClient.tsx) for consistency.
// Shows a badge with the active filter count and, once results have
// reported back a match count (see PickerResultsGrid.tsx), a "N matching"
// line -- so the count is visible even while the checkbox list is hidden.
function FilterModeToggle({ filterMode, onToggle }: { filterMode: boolean; onToggle: () => void }) {
  const { selectedFilters, matchCount, clearFilters } = usePickerFilter();

  return (
    <div className="screenerFilterModeBar">
      <button
        type="button"
        className={filterMode ? "screenerFilterModeBtn active" : "screenerFilterModeBtn"}
        onClick={onToggle}
      >
        {filterMode ? "Hide" : "Open Filters"}
        {selectedFilters.length ? <span className="screenerFilterModeBadge">{selectedFilters.length}</span> : null}
      </button>
      {selectedFilters.length ? (
        <div className="screenerFilterModeMeta">
          {matchCount != null ? <span className="screenerFilterModeCount">{matchCount} matching</span> : <span />}
          <button type="button" className="screenerFilterClear" onClick={clearFilters}>
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}

// The remaining FILTER_DEFS conditions that don't correspond to a category
// link above (volume spike, ATR spike, MA50/MA200 above-below, the
// divergence flags) -- only shown once filter mode is on, so nothing from
// the old standalone checklist is lost, it's just secondary to the
// category checkboxes above it.
function MoreFilters() {
  const { selectedFilters, toggleFilter } = usePickerFilter();

  if (!OTHER_FILTER_DEFS.length) return null;

  return (
    <div className="screenerNavGroup screenerMoreFilters">
      <div className="screenerNavHeading" style={{ color: "#93c5fd" }}>
        More conditions
      </div>
      <div className="screenerFilterList">
        {OTHER_FILTER_DEFS.map((filter) => {
          const checked = selectedFilters.includes(filter.key);
          return (
            <label key={filter.key} className="screenerFilterItem">
              <input type="checkbox" checked={checked} onChange={() => toggleFilter(filter.key)} />
              <span className="screenerFilterDot" style={{ background: toneDotColor(filter.tone) }} aria-hidden="true" />
              <span className="screenerFilterLabel">{filter.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// `variant` lets callers split the desktop sidebar and the mobile
// "Select Screener" trigger into two separate places in the page layout
// (each variant renders its own independent open/close and filter-mode
// state -- only one of the two is ever visible at a given viewport width
// via the existing CSS breakpoint, so there's no conflict):
//   - "full" (default): sidebar + trigger, same position (legacy behaviour)
//   - "sidebar": desktop sticky column only, no mobile trigger/overlay
//   - "trigger": mobile "Select Screener" button + overlay only, no sidebar
//
// `showFilters` renders the filter-mode toggle + checkbox-aware NavList +
// MoreFilters (see above); it does nothing unless the caller also wraps
// the page in <PickerFilterProvider>. `showSearch` renders the cross-picker
// TickerSearch box, but only inside the mobile overlay -- on desktop the
// ticker search now lives on the results header instead (see
// PickerResultsGrid.tsx's inline-variant TickerSearch), so the sidebar
// never renders it regardless of this prop.
export default function ScreenerNav({
  currentHref,
  variant = "full",
  showFilters = false,
  showSearch = false,
}: {
  currentHref: string;
  variant?: "full" | "sidebar" | "trigger";
  showFilters?: boolean;
  showSearch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filterMode, setFilterMode] = useState(false);
  const { matchCount } = usePickerFilter();
  const showSidebar = variant !== "trigger";
  const showTrigger = variant !== "sidebar";

  const currentLabel =
    GROUPS.flatMap((group) => group.items).find((item) => item.href === currentHref)?.label ??
    "Screeners";

  return (
    <>
      {/* Desktop: sticky left column */}
      {showSidebar ? (
        <aside className="screenerSidebar" aria-label="Stock screeners">
          <div className="screenerSidebarTitle">Screeners</div>
          {showFilters ? <FilterModeToggle filterMode={filterMode} onToggle={() => setFilterMode((v) => !v)} /> : null}
          <NavList currentHref={currentHref} filterMode={filterMode} />
          {showFilters && filterMode ? <MoreFilters /> : null}
        </aside>
      ) : null}

      {/* Mobile: single "Select Screener" trigger that opens an overlay */}
      {showTrigger ? (
        <div className="screenerMobileBar">
          <button
            type="button"
            className="screenerSelectBtn"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <span className="screenerSelectMain">
              <span className="screenerSelectIcon" aria-hidden="true">⏷</span>
              Select Screener
            </span>
            <span className="screenerSelectCurrent">
              {currentLabel}
              <span className="screenerSelectChevron" aria-hidden="true">▾</span>
            </span>
          </button>
        </div>
      ) : null}

      {showTrigger && open ? (
        <div className="screenerOverlay" role="dialog" aria-modal="true" aria-label="Select screener">
          <div className="screenerOverlayBackdrop" onClick={() => setOpen(false)} />
          <div className="screenerOverlayPanel">
            <div className="screenerOverlayHeader">
              <span>Select Screener</span>
              <button
                type="button"
                className="screenerOverlayClose"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="screenerOverlayScroll">
              {/* On mobile the search box lives inside this same opened
                  overlay (unchanged) -- searching does NOT close the
                  overlay, unlike tapping a category link, which navigates
                  and closes it. The filter toggle + checkboxes work exactly
                  like desktop; the "Go" footer below (always on screen,
                  not part of this scrolling area) is how you close the
                  overlay once you're done ticking boxes. */}
              {showSearch ? <TickerSearch /> : null}
              {showFilters ? <FilterModeToggle filterMode={filterMode} onToggle={() => setFilterMode((v) => !v)} /> : null}
              <NavList currentHref={currentHref} onNavigate={() => setOpen(false)} filterMode={filterMode} />
              {showFilters && filterMode ? <MoreFilters /> : null}
            </div>
            {showFilters ? (
              <div className="screenerOverlayFooter">
                <button type="button" className="screenerGoBtn" onClick={() => setOpen(false)}>
                  Go{matchCount != null ? ` — ${matchCount} matching` : ""}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <style>{`
        .screenerSidebar {
          position: sticky; top: 16px; align-self: start;
          border: 1px solid rgba(255,255,255,0.08); border-radius: 20px;
          padding: 16px 12px;
          background: linear-gradient(180deg, rgba(10,16,28,0.9), rgba(6,10,18,0.96));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
          max-height: calc(100vh - 32px); overflow-y: auto;
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent;
        }
        .screenerSidebarTitle {
          font-size: 12px; font-weight: 950; letter-spacing: 0.12em; text-transform: uppercase;
          color: #93c5fd; padding: 4px 8px 12px;
        }
        .screenerNavList { display: grid; gap: 14px; }
        .screenerNavGroup { display: grid; gap: 4px; }
        .screenerNavHeading {
          font-size: 10.5px; font-weight: 950; letter-spacing: 0.1em; text-transform: uppercase;
          padding: 4px 8px 2px; opacity: 0.92;
        }
        .screenerNavItem {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 10px; border-radius: 11px; border: 1px solid transparent;
          color: rgba(226,232,240,0.82); text-decoration: none;
          font-size: 13.5px; font-weight: 800;
          transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
        }
        .screenerNavItem:hover { background: rgba(255,255,255,0.045); color: #f8fafc; }
        .screenerNavItem.active { color: #f8fafc; font-weight: 950; }
        .screenerNavIcon { flex: 0 0 auto; width: 16px; text-align: center; font-size: 13px; }
        .screenerNavLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .screenerNavHint { margin-left: auto; flex: 0 0 auto; font-size: 9.5px; font-weight: 800; letter-spacing: 0.03em; text-transform: uppercase; color: rgba(148,163,184,0.4); white-space: nowrap; }

        .screenerNavCheckable {
          cursor: pointer;
        }
        .screenerNavCheckable.checked {
          background: rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.4); color: #f8fafc;
        }
        .screenerNavCheckable input[type="checkbox"] { flex: 0 0 auto; width: 15px; height: 15px; accent-color: #22c55e; cursor: pointer; }

        .screenerFilterModeBar { padding: 0 4px 12px; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .screenerFilterModeBtn {
          width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          padding: 9px 12px; border-radius: 10px; border: 1px solid rgba(96,165,250,0.35);
          background: rgba(59,130,246,0.10); color: #dbeafe; font-size: 12.5px; font-weight: 800; cursor: pointer;
        }
        .screenerFilterModeBtn.active { background: rgba(34,197,94,0.14); border-color: rgba(34,197,94,0.42); color: #bbf7d0; }
        .screenerFilterModeBadge {
          display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px;
          border-radius: 999px; background: rgba(255,255,255,0.16); font-size: 10.5px; font-weight: 900; padding: 0 5px;
        }
        .screenerFilterModeMeta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; padding: 0 2px; }
        .screenerFilterModeCount { font-size: 11.5px; color: rgba(148,163,184,0.85); font-weight: 700; }

        .screenerMoreFilters { margin-top: 8px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.08); }
        .screenerFilterList { display: grid; gap: 2px; }
        .screenerFilterItem {
          display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 9px;
          font-size: 12.5px; font-weight: 700; color: rgba(226,232,240,0.85); cursor: pointer;
        }
        .screenerFilterItem:hover { background: rgba(255,255,255,0.04); }
        .screenerFilterItem input[type="checkbox"] { flex: 0 0 auto; width: 14px; height: 14px; accent-color: #60a5fa; cursor: pointer; }
        .screenerFilterDot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 999px; }
        .screenerFilterLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .screenerFilterClear {
          border: 1px solid rgba(239,68,68,0.28); background: rgba(239,68,68,0.06); color: #fca5a5;
          border-radius: 8px; padding: 4px 9px; font-size: 11px; font-weight: 800; cursor: pointer;
        }

        .screenerSearchGroup { padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .screenerSearchRow { display: flex; gap: 6px; padding: 0 8px; }
        .screenerSearchInput {
          flex: 1 1 auto; min-width: 0; padding: 7px 9px; border-radius: 9px;
          border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.03);
          color: #f1f5f9; font-size: 12.5px; font-weight: 700;
        }
        .screenerSearchInput:focus { outline: none; border-color: rgba(96,165,250,0.55); }
        .screenerSearchBtn {
          flex: 0 0 auto; padding: 7px 12px; border-radius: 9px; border: 1px solid rgba(96,165,250,0.4);
          background: rgba(59,130,246,0.14); color: #dbeafe; font-size: 12px; font-weight: 800; cursor: pointer;
        }
        .screenerSearchBtn:disabled { opacity: 0.5; cursor: default; }
        .screenerSearchNote { margin-top: 8px; padding: 0 8px; font-size: 11.5px; line-height: 1.5; color: rgba(226,232,240,0.7); }
        .screenerSearchResults { margin-top: 6px; display: grid; gap: 6px; padding: 0 8px; }
        .screenerSearchChip {
          display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04);
          color: #e2e8f0; font-size: 11.5px; font-weight: 700; text-decoration: none; width: fit-content;
        }
        .screenerSearchSource { margin-left: 4px; font-size: 10px; font-weight: 700; opacity: 0.55; }

        .screenerMobileBar { display: none; }
        .screenerSelectBtn {
          width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 14px 16px; border-radius: 16px;
          border: 1.5px solid rgba(96,165,250,0.65);
          background: linear-gradient(135deg, rgba(59,130,246,0.34), rgba(37,99,235,0.20));
          color: #f0f7ff; font-weight: 950; font-size: 15px; cursor: pointer;
          box-shadow: 0 10px 26px rgba(37,99,235,0.32), inset 0 1px 0 rgba(255,255,255,0.08);
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
        }
        .screenerSelectBtn:active {
          transform: translateY(1px);
          box-shadow: 0 6px 16px rgba(37,99,235,0.28), inset 0 1px 0 rgba(255,255,255,0.06);
        }
        .screenerSelectMain { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 8px; }
        .screenerSelectIcon { font-size: 14px; color: #93c5fd; }
        .screenerSelectCurrent {
          display: inline-flex; align-items: center; gap: 7px; min-width: 0;
          padding: 5px 10px; border-radius: 999px;
          border: 1px solid rgba(147,197,253,0.42); background: rgba(15,23,42,0.55);
          color: #dbeafe; font-size: 12.5px; font-weight: 900;
          overflow: hidden;
        }
        .screenerSelectCurrent > :not(.screenerSelectChevron) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .screenerSelectChevron { flex: 0 0 auto; color: #93c5fd; }

        .screenerOverlay { position: fixed; inset: 0; z-index: 70; display: flex; }
        .screenerOverlayBackdrop {
          position: absolute; inset: 0; background: rgba(2,6,15,0.72);
          -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
        }
        .screenerOverlayPanel {
          position: relative; margin-top: auto; width: 100%; max-height: 82vh;
          display: flex; flex-direction: column;
          border-top-left-radius: 22px; border-top-right-radius: 22px;
          border: 1px solid rgba(255,255,255,0.10); border-bottom: 0;
          background: linear-gradient(180deg, rgba(12,18,30,0.99), rgba(7,11,20,1));
          box-shadow: 0 -18px 50px rgba(0,0,0,0.5);
        }
        .screenerOverlayHeader {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 18px 12px; font-size: 15px; font-weight: 950; color: #f8fafc;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .screenerOverlayClose {
          width: 34px; height: 34px; border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04);
          color: #e2e8f0; font-size: 13px; font-weight: 900; cursor: pointer;
        }
        .screenerOverlayScroll {
          flex: 1 1 auto; overflow-y: auto; padding: 14px 14px 24px;
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent;
        }
        .screenerOverlayFooter {
          flex: 0 0 auto; padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
          border-top: 1px solid rgba(255,255,255,0.10);
          background: rgba(7,11,20,1);
        }
        .screenerGoBtn {
          width: 100%; padding: 13px 16px; border-radius: 12px;
          border: 1px solid rgba(34,197,94,0.4);
          background: linear-gradient(135deg, rgba(34,197,94,0.28), rgba(22,163,74,0.18));
          color: #ecfdf5; font-weight: 950; font-size: 14.5px; cursor: pointer;
        }

        @media (max-width: 980px) {
          .screenerSidebar { display: none; }
          .screenerMobileBar { display: block; }
        }
        @media (max-width: 420px) {
          .screenerSelectBtn { font-size: 14px; padding: 12px 14px; gap: 10px; }
          .screenerSelectCurrent { font-size: 12px; }
        }
      `}</style>
    </>
  );
}
