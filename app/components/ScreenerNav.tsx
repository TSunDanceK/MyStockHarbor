"use client";

import Link from "next/link";
import { useState } from "react";
import { usePickerFilter } from "@/app/components/PickerFilterContext";
import { FILTER_DEFS, toneDotColor, type FilterKey } from "@/lib/pickerFilters";

type TickerMatch = { source: string; title: string; tone?: string; href: string };

const SOURCE_LABELS: Record<string, string> = {
  pickers: "Pickers",
  plays: "Ascending Triangles",
  bullFlags: "Bull Flags",
  descendingTriangles: "Descending Triangles",
};

type Tone = "green" | "yellow" | "orange" | "red" | "blue";

type NavItem = { href: string; label: string; icon: string; tone: Tone };
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
      { href: "/oversold-stocks-today", label: "Oversold", icon: "●", tone: "green" },
      { href: "/overbought-stocks-today", label: "Overbought", icon: "●", tone: "red" },
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
      { href: "/stocks-down-20-from-all-time-highs", label: "20% From ATH", icon: "◆", tone: "yellow" },
    ],
  },
  {
    heading: "Moving Averages",
    headingColor: "#facc15",
    items: [
      { href: "/stocks-near-200-day-moving-average", label: "Near 200-Day", icon: "◇", tone: "yellow" },
      { href: "/stocks-near-weekly-200-day-moving-average", label: "Weekly MA200", icon: "◆", tone: "yellow" },
    ],
  },
  {
    heading: "Earnings",
    headingColor: "#34d399",
    items: [
      { href: "/stocks-with-positive-last-earnings", label: "Last Earnings", icon: "✓", tone: "green" },
      { href: "/stocks-with-strong-earnings-growth", label: "Earnings Growth", icon: "↗", tone: "green" },
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

function toneColour(tone: Tone) {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#facc15";
  if (tone === "orange") return "#fb923c";
  if (tone === "red") return "#ef4444";
  return "#60a5fa";
}

function NavList({
  currentHref,
  onNavigate,
}: {
  currentHref: string;
  onNavigate?: () => void;
}) {
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
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Renders the "custom builder" tick-box filters -- the same FILTER_DEFS
// list (and same AND-combine logic) that /pickers' own filter chips use,
// see lib/pickerFilters.ts -- as its own labelled group inside the same
// left-column menu as the category links above. Reads/writes the shared
// PickerFilterContext so PickerResultsGrid (rendered as a sibling on the
// page) can apply the same selection without any refetch. A no-op
// (renders nothing) on any page that isn't wrapped in a
// PickerFilterProvider, so it's safe to opt in per-page via `showFilters`.
function FilterChecklist({ onToggleNavigate }: { onToggleNavigate?: () => void }) {
  const { selectedFilters, toggleFilter, clearFilters, matchCount } = usePickerFilter();

  return (
    <div className="screenerNavGroup screenerFilterGroup">
      <div className="screenerNavHeading" style={{ color: "#93c5fd" }}>
        Filter these results
      </div>
      <div className="screenerFilterList">
        {FILTER_DEFS.map((filter) => {
          const checked = selectedFilters.includes(filter.key as FilterKey);
          return (
            <label key={filter.key} className="screenerFilterItem">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  toggleFilter(filter.key as FilterKey);
                  onToggleNavigate?.();
                }}
              />
              <span className="screenerFilterDot" style={{ background: toneDotColor(filter.tone) }} aria-hidden="true" />
              <span className="screenerFilterLabel">{filter.label}</span>
            </label>
          );
        })}
      </div>
      <div className="screenerFilterFooter">
        {matchCount != null ? <span className="screenerFilterCount">{matchCount} matching</span> : <span />}
        {selectedFilters.length ? (
          <button type="button" className="screenerFilterClear" onClick={clearFilters}>
            Clear ({selectedFilters.length})
          </button>
        ) : null}
      </div>
    </div>
  );
}

// "Search a ticker across our pickers" -- on-demand only (fires on submit,
// never on keystroke/on mount) so it costs nothing on a normal page view.
// Hits /api/ticker-lookup, which itself only ever reads each builder's
// existing memo/Redis cache in-process -- no rebuilds are ever triggered
// from here. See app/api/ticker-lookup/route.ts for the full reasoning.
function TickerSearch() {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ symbol: string; matches: TickerMatch[] } | null>(null);

  async function runSearch() {
    const symbol = value.trim().toUpperCase();
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ticker-lookup?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = await res.json();
      setResult({ symbol, matches: Array.isArray(data.matches) ? data.matches : [] });
    } catch {
      setError("Search failed -- please try again.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screenerNavGroup screenerSearchGroup">
      <div className="screenerNavHeading" style={{ color: "#93c5fd" }}>
        Search a ticker
      </div>
      <div className="screenerSearchRow">
        <input
          type="text"
          className="screenerSearchInput"
          placeholder="e.g. AAPL"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
        />
        <button type="button" className="screenerSearchBtn" onClick={runSearch} disabled={loading || !value.trim()}>
          {loading ? "…" : "Search"}
        </button>
      </div>
      {error ? <div className="screenerSearchNote">{error}</div> : null}
      {result ? (
        result.matches.length ? (
          <div className="screenerSearchResults">
            <div className="screenerSearchNote">
              <b>{result.symbol}</b> qualifies for {result.matches.length} {result.matches.length === 1 ? "list" : "lists"}:
            </div>
            {result.matches.map((match) => (
              <Link key={`${match.source}-${match.title}`} href={match.href} className="screenerSearchChip">
                <span className="screenerFilterDot" style={{ background: toneDotColor(match.tone) }} aria-hidden="true" />
                {match.title}
                <span className="screenerSearchSource">{SOURCE_LABELS[match.source] ?? match.source}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="screenerSearchNote">No current picker lists match &ldquo;{result.symbol}&rdquo;.</div>
        )
      ) : null}
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
// `showFilters` additionally renders the FilterChecklist group (see above)
// inside both the sidebar and the mobile overlay -- it does nothing unless
// the caller also wraps the page in <PickerFilterProvider>. `showSearch`
// renders the cross-picker TickerSearch box (self-contained, needs no
// provider).
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
          {showSearch ? <TickerSearch /> : null}
          {showFilters ? <FilterChecklist /> : null}
          <NavList currentHref={currentHref} />
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
              {/* On mobile the search box and tick boxes live inside this
                  same opened overlay rather than the (hidden) sidebar --
                  searching/ticking filters in place and does NOT close the
                  overlay, unlike tapping a category link, which navigates
                  and closes it. */}
              {showSearch ? <TickerSearch /> : null}
              {showFilters ? <FilterChecklist /> : null}
              <NavList currentHref={currentHref} onNavigate={() => setOpen(false)} />
            </div>
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

        .screenerFilterGroup {
          margin-bottom: 4px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .screenerFilterList { display: grid; gap: 2px; max-height: 260px; overflow-y: auto; }
        .screenerFilterItem {
          display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 9px;
          font-size: 12.5px; font-weight: 700; color: rgba(226,232,240,0.85); cursor: pointer;
        }
        .screenerFilterItem:hover { background: rgba(255,255,255,0.04); }
        .screenerFilterItem input[type="checkbox"] { flex: 0 0 auto; width: 14px; height: 14px; accent-color: #60a5fa; cursor: pointer; }
        .screenerFilterDot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 999px; }
        .screenerFilterLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .screenerFilterFooter { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px 0; }
        .screenerFilterCount { font-size: 11px; color: rgba(148,163,184,0.75); }
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
          overflow-y: auto; padding: 14px 14px 24px;
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent;
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
