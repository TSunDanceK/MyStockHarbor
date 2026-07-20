"use client";

import Link from "next/link";
import { useState } from "react";
import { usePickerFilter } from "@/app/components/PickerFilterContext";
import { TickerSearch } from "@/app/components/TickerSearchBox";
import type { AnyFilterKey } from "@/lib/pickerFilters";

type Tone = "green" | "yellow" | "orange" | "red" | "blue";

// `filterKey` turns a category into a real checkbox in filter mode (see
// NavList below) instead of a plain navigation link. Two kinds of key work
// here (see lib/pickerFilters.ts): a `FilterKey` from the 18-condition
// custom builder for categories with an exact one-to-one boolean match
// (e.g. "Oversold" is exactly the `oversold` flag), or a `CategoryFilterKey`
// for everything else -- "is this stock also a member of that category's
// own page right now" (e.g. "Buy Signals" -> `hasBuySignal`), computed for
// every entry regardless of which page it's on (see buildCategoryFlags in
// PickerResultPage.tsx).
//
// `href` is now OPTIONAL: every one of the 18 custom-builder conditions has
// a home here (either on an existing category link, or as its own
// checkbox-only row -- see the Momentum/Volume & Volatility/Moving Averages
// groups below). Conditions with no dedicated live screener page of their
// own (checked -- the closest-sounding pages on the site, e.g.
// /stocks-with-unusual-volume or /stocks-above-200-day-moving-average, are
// static guide articles, not pages built on this picker data) simply have
// no `href`, so they only ever render as a checkbox once filter mode is on
// (see NavList) rather than pretending to link somewhere. Only the three
// chart-pattern plays (Ascending Triangles, Bull Flags, Descending
// Triangles) have no `filterKey`, since they're built from a separate, more
// expensive dataset that was deliberately kept out of every other page's
// payload -- those stay plain links even while filter mode is on.
type NavItem = { href?: string; label: string; icon: string; tone: Tone; filterKey?: AnyFilterKey };
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
      { href: "/top-stocks-with-buy-signals", label: "Buy Signals", icon: "▲", tone: "green", filterKey: "hasBuySignal" },
      { href: "/top-stocks-with-sell-signals", label: "Sell Signals", icon: "▼", tone: "red", filterKey: "hasSellSignal" },
    ],
  },
  {
    heading: "Momentum",
    headingColor: "#22c55e",
    items: [
      { href: "/oversold-stocks-today", label: "Oversold", icon: "●", tone: "green", filterKey: "oversold" },
      { href: "/overbought-stocks-today", label: "Overbought", icon: "●", tone: "red", filterKey: "overbought" },
      { href: "/best-trend-score-stocks", label: "Best Trend", icon: "★", tone: "green", filterKey: "bestTrendPick" },
      { href: "/bullish-bearish-divergence-stocks", label: "Divergence", icon: "⚇", tone: "blue", filterKey: "divergencePick" },
      // Finer-grained divergence conditions -- the combined "Divergence"
      // row above already covers the one live page this data has, so these
      // only ever appear as checkboxes once filter mode is on.
      { label: "Bullish RSI Divergence", icon: "↗", tone: "green", filterKey: "bullishRsiDivergence" },
      { label: "Bearish RSI Divergence", icon: "↘", tone: "red", filterKey: "bearishRsiDivergence" },
      { label: "Bullish MACD Divergence", icon: "↗", tone: "green", filterKey: "bullishMacdDivergence" },
      { label: "Bearish MACD Divergence", icon: "↘", tone: "red", filterKey: "bearishMacdDivergence" },
    ],
  },
  {
    heading: "Highs & Breakouts",
    headingColor: "#fb923c",
    items: [
      { href: "/all-time-high-breakout-stocks", label: "ATH Breakouts", icon: "↗", tone: "orange", filterKey: "athBreakoutPick" },
      { href: "/3-month-high-breakout-stocks", label: "3-Month Highs", icon: "↗", tone: "orange", filterKey: "threeMonthHighPick" },
      { href: "/stocks-down-20-from-all-time-highs", label: "20% From ATH", icon: "◆", tone: "yellow", filterKey: "buyTheDip" },
    ],
  },
  {
    heading: "Volume & Volatility",
    headingColor: "#fb923c",
    items: [
      // No dedicated live screener page for these three yet -- checkboxes
      // only, once filter mode is on.
      { label: "Breakout", icon: "↗", tone: "orange", filterKey: "breakout" },
      { label: "Volume Spike", icon: "▮", tone: "orange", filterKey: "volumeSpike" },
      { label: "ATR Spike", icon: "≈", tone: "orange", filterKey: "atrSpike" },
    ],
  },
  {
    heading: "Moving Averages",
    headingColor: "#facc15",
    items: [
      { href: "/stocks-near-200-day-moving-average", label: "Near 200-Day", icon: "◇", tone: "yellow", filterKey: "dailyMa200Proximity" },
      { href: "/stocks-near-weekly-200-day-moving-average", label: "Weekly MA200", icon: "◆", tone: "yellow", filterKey: "weeklyMa200Proximity" },
      // No dedicated live screener page for plain above/below MA50/MA200
      // conditions -- checkboxes only, once filter mode is on.
      { label: "Above MA50", icon: "▲", tone: "yellow", filterKey: "aboveMA50" },
      { label: "Below MA50", icon: "▼", tone: "yellow", filterKey: "belowMA50" },
      { label: "Above MA200", icon: "▲", tone: "yellow", filterKey: "aboveMA200" },
      { label: "Below MA200", icon: "▼", tone: "yellow", filterKey: "belowMA200" },
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
      { href: "/macro-support-resistance-stocks", label: "Macro S/R", icon: "⇄", tone: "blue", filterKey: "macroSrPick" },
      // These three come from a separate chart-pattern dataset that was
      // deliberately kept out of every other page's payload (see the
      // ticker-search cost discussion earlier in this project) -- no cheap
      // per-symbol membership flag is available for them, so they stay
      // plain links (with the "opens page" hint below) even in filter mode.
      { href: "/plays", label: "Ascending Triangles", icon: "△", tone: "green" },
      { href: "/plays/bull-flags", label: "Bull Flags", icon: "⚑", tone: "green" },
      { href: "/plays/descending-triangles", label: "Descending Triangles", icon: "▽", tone: "red" },
    ],
  },
];

function toneColour(tone: Tone) {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#facc15";
  if (tone === "orange") return "#fb923c";
  if (tone === "red") return "#ef4444";
  return "#60a5fa";
}

// Renders the category list. Off, every item with an `href` is a plain
// link (legacy behaviour: tap "Oversold", go to the Oversold page). On
// (`filterMode`), any item with a `filterKey` grows a checkbox in its place
// -- ticking "Oversold" and "Best Trend" combines them via the same AND
// logic /pickers' own filter chips use, narrowing *this* page's own results
// instead of navigating anywhere. Items with no `href` (the checkbox-only
// conditions with no dedicated page -- see GROUPS above) only ever appear
// once filter mode is on; a whole group is skipped entirely if none of its
// items would be visible at the current filterMode. The three chart-pattern
// plays have no filterKey and keep working as plain links even in filter
// mode (with a small "opens page" hint so that's not confusing).
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
      {GROUPS.map((group) => {
        const visibleItems = group.items.filter((item) => filterMode || item.href);
        if (!visibleItems.length) return null;

        return (
          <div key={group.heading} className="screenerNavGroup">
            <div className="screenerNavHeading" style={{ color: group.headingColor }}>
              {group.heading}
            </div>
            {visibleItems.map((item) => {
              const active = item.href === currentHref;
              const colour = toneColour(item.tone);

              if (filterMode && item.filterKey) {
                const key = item.filterKey;
                const checked = selectedFilters.includes(key);
                return (
                  <label
                    key={item.filterKey}
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

              if (!item.href) return null;

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
        );
      })}
    </div>
  );
}

// Plain navigation link that replaces the old in-place filter-mode toggle
// on every page except the dedicated /custom-screener page (see
// `alwaysFilterMode` on the default export below). Ticking boxes to combine
// conditions within a single category's own narrow list was fundamentally
// broken -- a stock on the Oversold page can never also be Overbought, so
// any two-condition combination scoped to one category's own short list
// always showed zero matches -- so in-place filtering has been retired in
// favour of sending people to /custom-screener, which searches the full
// analyzed universe instead of one category's own short list.
function OpenCustomScreenerLink() {
  return (
    <div className="screenerFilterModeBar">
      <Link href="/custom-screener" className="screenerFilterModeBtn">
        Open Full Custom Screener
      </Link>
    </div>
  );
}

// The "N matching" + Clear row that used to live under the (now-removed)
// filter-mode toggle button. Only rendered when `alwaysFilterMode` is on
// (i.e. only on /custom-screener, the one page where NavList's checkboxes
// are always showing) -- every other page's NavList always renders plain
// links now, so selectedFilters never becomes non-empty there and this has
// nothing to show.
function FilterSummaryBar() {
  const { selectedFilters, matchCount, clearFilters } = usePickerFilter();
  if (!selectedFilters.length) return null;

  return (
    <div className="screenerFilterModeBar">
      <div className="screenerFilterModeMeta">
        {matchCount != null ? <span className="screenerFilterModeCount">{matchCount} matching</span> : <span />}
        <button type="button" className="screenerFilterClear" onClick={clearFilters}>
          Clear
        </button>
      </div>
    </div>
  );
}

// `variant` lets callers split the desktop sidebar and the mobile
// "Select Screener" trigger into two separate places in the page layout
// (each variant renders its own independent open/close state -- only one
// of the two is ever visible at a given viewport width via the existing
// CSS breakpoint, so there's no conflict):
//   - "full" (default): sidebar + trigger, same position (legacy behaviour)
//   - "sidebar": desktop sticky column only, no mobile trigger/overlay
//   - "trigger": mobile "Select Screener" button + overlay only, no sidebar
//
// `showFilters` renders the checkbox-aware NavList's supporting UI (see
// above); it does nothing unless the caller also wraps the page in
// <PickerFilterProvider>. When `alwaysFilterMode` is false (every existing
// category page), NavList always renders plain links and, if `showFilters`
// is on, a plain link to /custom-screener (OpenCustomScreenerLink) replaces
// what used to be the "Open Filters" toggle button -- in-place per-category
// checkbox filtering has been retired (see OpenCustomScreenerLink's comment
// for why) in favour of that dedicated page. When `alwaysFilterMode` is
// true (only /custom-screener passes this), NavList always renders
// checkboxes and there's no toggle at all, just the always-visible
// checkboxes plus a "N matching" + Clear summary row (FilterSummaryBar)
// once at least one is checked.
// `showSearch` renders the cross-picker TickerSearch box, but only inside
// the mobile overlay -- on desktop the ticker search now lives on the
// results header instead (see PickerResultsGrid.tsx's inline-variant
// TickerSearch), so the sidebar never renders it regardless of this prop.
export default function ScreenerNav({
  currentHref,
  variant = "full",
  showFilters = false,
  showSearch = false,
  alwaysFilterMode = false,
}: {
  currentHref: string;
  variant?: "full" | "sidebar" | "trigger";
  showFilters?: boolean;
  showSearch?: boolean;
  alwaysFilterMode?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { matchCount, selectedFilters, clearFilters } = usePickerFilter();
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
          {showFilters ? (alwaysFilterMode ? <FilterSummaryBar /> : <OpenCustomScreenerLink />) : null}
          <NavList currentHref={currentHref} filterMode={alwaysFilterMode} />
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
                  and closes it. Checkboxes (when alwaysFilterMode is on)
                  work exactly like desktop; Clear + Go (always on screen,
                  not part of this scrolling area) are how you clear/finish
                  once you're done ticking boxes -- see the footer below. */}
              {showSearch ? <TickerSearch /> : null}
              {showFilters && !alwaysFilterMode ? <OpenCustomScreenerLink /> : null}
              <NavList currentHref={currentHref} onNavigate={() => setOpen(false)} filterMode={alwaysFilterMode} />
            </div>
            {showFilters ? (
              <div className="screenerOverlayFooter">
                <div className="screenerOverlayFooterRow">
                  {selectedFilters.length ? (
                    <button type="button" className="screenerFilterClearFixed" onClick={clearFilters}>
                      Clear
                    </button>
                  ) : null}
                  <button type="button" className="screenerGoBtn" onClick={() => setOpen(false)}>
                    Go{matchCount != null ? ` — ${matchCount} matching` : ""}
                  </button>
                </div>
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
          text-decoration: none; box-sizing: border-box;
        }
        .screenerFilterModeBtn.active { background: rgba(34,197,94,0.14); border-color: rgba(34,197,94,0.42); color: #bbf7d0; }
        .screenerFilterModeBadge {
          display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px;
          border-radius: 999px; background: rgba(255,255,255,0.16); font-size: 10.5px; font-weight: 900; padding: 0 5px;
        }
        .screenerFilterModeMeta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; padding: 0 2px; }
        .screenerFilterModeCount { font-size: 11.5px; color: rgba(148,163,184,0.85); font-weight: 700; }

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

        .screenerOverlay {
          position: fixed; inset: 0; z-index: 70; display: flex;
          /* Reserves space at the top for the site's own fixed/sticky
             header so the overlay's "Select Screener" title + close button
             (see .screenerOverlayHeader) never render underneath it. */
          padding-top: calc(64px + env(safe-area-inset-top));
        }
        .screenerOverlayBackdrop {
          position: absolute; inset: 0; background: rgba(2,6,15,0.72);
          -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
        }
        .screenerOverlayPanel {
          position: relative; margin-top: auto; width: 100%;
          max-height: min(82vh, calc(100vh - 76px - env(safe-area-inset-top)));
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
        .screenerOverlayFooterRow { display: flex; align-items: stretch; gap: 10px; }
        .screenerGoBtn {
          flex: 1 1 auto; padding: 13px 16px; border-radius: 12px;
          border: 1px solid rgba(34,197,94,0.4);
          background: linear-gradient(135deg, rgba(34,197,94,0.28), rgba(22,163,74,0.18));
          color: #ecfdf5; font-weight: 950; font-size: 14.5px; cursor: pointer;
        }
        .screenerFilterClearFixed {
          flex: 0 0 auto; padding: 13px 18px; border-radius: 12px;
          border: 1px solid rgba(239,68,68,0.35); background: rgba(239,68,68,0.10);
          color: #fca5a5; font-weight: 900; font-size: 14px; cursor: pointer; white-space: nowrap;
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
