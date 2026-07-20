"use client";

import Link from "next/link";
import { useState } from "react";
import { TickerSearch } from "@/app/components/TickerSearchBox";

type Tone = "green" | "yellow" | "orange" | "red" | "blue";

// Every item here is a plain navigational link -- no in-place checkbox
// filtering. That model (tried in earlier rounds) filtered only within
// whichever category page you happened to be standing on, which silently
// produced wrong/empty results for anything but that page's own narrow list
// (e.g. ticking "Overbought" while on the Oversold page always showed 0
// matches, since a stock can't be oversold and overbought at once -- and any
// other combination was similarly scoped to a handful of stocks instead of
// the whole market). The site's actual full-universe custom screener
// already lives at /pickers (see PickersClient.tsx's "Custom Screener"
// panel, which filters all ~550+ tracked symbols, not a category's own
// list) -- so instead of duplicating (and getting wrong) that logic here,
// every item either:
//   - links to its own dedicated, correctly-scored category page (most
//     items below), or
//   - for the handful of conditions with no dedicated page of their own
//     (marked with `hint`), deep-links to /pickers?filter=<key> which
//     pre-selects that one condition on the real full-universe screener and
//     scrolls/highlights it into view (see the ?filter= handling in
//     PickersClient.tsx).
type NavItem = { href: string; label: string; icon: string; tone: Tone; hint?: string };
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
      // Finer-grained divergence conditions -- no dedicated page of their
      // own (the combined "Divergence" page above covers the one live page
      // this data has), so these deep-link into the full custom screener.
      { href: "/pickers?filter=bullishRsiDivergence#custom-screener", label: "Bullish RSI Divergence", icon: "↗", tone: "green", hint: "full screener" },
      { href: "/pickers?filter=bearishRsiDivergence#custom-screener", label: "Bearish RSI Divergence", icon: "↘", tone: "red", hint: "full screener" },
      { href: "/pickers?filter=bullishMacdDivergence#custom-screener", label: "Bullish MACD Divergence", icon: "↗", tone: "green", hint: "full screener" },
      { href: "/pickers?filter=bearishMacdDivergence#custom-screener", label: "Bearish MACD Divergence", icon: "↘", tone: "red", hint: "full screener" },
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
    heading: "Volume & Volatility",
    headingColor: "#fb923c",
    items: [
      // No dedicated live screener page for these three -- deep-link into
      // the full custom screener instead.
      { href: "/pickers?filter=breakout#custom-screener", label: "Breakout", icon: "↗", tone: "orange", hint: "full screener" },
      { href: "/pickers?filter=volumeSpike#custom-screener", label: "Volume Spike", icon: "▮", tone: "orange", hint: "full screener" },
      { href: "/pickers?filter=atrSpike#custom-screener", label: "ATR Spike", icon: "≋", tone: "orange", hint: "full screener" },
    ],
  },
  {
    heading: "Moving Averages",
    headingColor: "#facc15",
    items: [
      { href: "/stocks-near-200-day-moving-average", label: "Near 200-Day", icon: "◇", tone: "yellow" },
      { href: "/stocks-near-weekly-200-day-moving-average", label: "Weekly MA200", icon: "◆", tone: "yellow" },
      // No dedicated live screener page for plain above/below MA50/MA200 --
      // deep-link into the full custom screener instead.
      { href: "/pickers?filter=aboveMA50#custom-screener", label: "Above MA50", icon: "▲", tone: "yellow", hint: "full screener" },
      { href: "/pickers?filter=belowMA50#custom-screener", label: "Below MA50", icon: "▼", tone: "yellow", hint: "full screener" },
      { href: "/pickers?filter=aboveMA200#custom-screener", label: "Above MA200", icon: "▲", tone: "yellow", hint: "full screener" },
      { href: "/pickers?filter=belowMA200#custom-screener", label: "Below MA200", icon: "▼", tone: "yellow", hint: "full screener" },
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

// Plain link list -- every item navigates somewhere real (its own page, or
// the full custom screener for the handful of conditions with no page of
// their own). No client-side filtering happens here anymore.
function NavList({ currentHref, onNavigate }: { currentHref: string; onNavigate?: () => void }) {
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
                {item.hint ? <span className="screenerNavHint">{item.hint}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// The call-to-action that lives directly above the "Signals" heading --
// a plain link to the site's real full-universe custom screener at
// /pickers#custom-screener, with no filters pre-applied so it always starts
// fresh (per the "this page will not have any filter already applied"
// requirement). This replaced an earlier in-place checkbox toggle that
// filtered only within the current category page's own (much narrower)
// result list -- see the GROUPS comment above for why that model was wrong.
function CustomScreenerLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link href="/pickers#custom-screener" onClick={onNavigate} className="screenerCustomBtn">
      <span className="screenerCustomBtnLabel">Open Full Custom Screener</span>
      <span className="screenerCustomBtnHint">searches every stock, not just this page</span>
    </Link>
  );
}

// `variant` lets callers split the desktop sidebar and the mobile
// "Select Screener" trigger into two separate places in the page layout
// (each variant renders its own independent open/close state -- only one of
// the two is ever visible at a given viewport width via the existing CSS
// breakpoint, so there's no conflict):
//   - "full" (default): sidebar + trigger, same position (legacy behaviour)
//   - "sidebar": desktop sticky column only, no mobile trigger/overlay
//   - "trigger": mobile "Select Screener" button + overlay only, no sidebar
//
// `showFilters` renders the "Open Full Custom Screener" link (see above);
// it's just a plain nav link so it works with or without a
// PickerFilterProvider wrapping the page. `showSearch` renders the
// cross-picker TickerSearch box, but only inside the mobile overlay -- on
// desktop the ticker search now lives on the results header instead (see
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
          {showFilters ? <CustomScreenerLink /> : null}
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
              {/* On mobile the search box lives inside this same opened
                  overlay (unchanged) -- searching does NOT close the
                  overlay, unlike tapping a category link or the custom
                  screener link, both of which navigate and close it. */}
              {showSearch ? <TickerSearch /> : null}
              {showFilters ? <CustomScreenerLink onNavigate={() => setOpen(false)} /> : null}
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
        .screenerNavHint { margin-left: auto; flex: 0 0 auto; font-size: 9.5px; font-weight: 800; letter-spacing: 0.03em; text-transform: uppercase; color: rgba(148,163,184,0.4); white-space: nowrap; }

        .screenerCustomBtn {
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          padding: 10px 12px; margin-bottom: 12px; border-radius: 10px;
          border: 1px solid rgba(34,197,94,0.35); background: rgba(34,197,94,0.10);
          text-decoration: none; cursor: pointer; text-align: center;
        }
        .screenerCustomBtnLabel { font-size: 12.5px; font-weight: 900; color: #bbf7d0; }
        .screenerCustomBtnHint { font-size: 10px; font-weight: 700; color: rgba(187,247,208,0.65); }

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
          max-height: min(82vh, calc(100vh - 96px - env(safe-area-inset-top)));
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