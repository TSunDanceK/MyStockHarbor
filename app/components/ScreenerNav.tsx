"use client";

import Link from "next/link";
import { useState } from "react";

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

// `variant` lets callers split the desktop sidebar and the mobile
// "Select Screener" trigger into two separate places in the page layout
// (each variant renders its own independent open/close state -- only one
// of the two is ever visible at a given viewport width via the existing
// CSS breakpoint, so there's no conflict):
//   - "full" (default): sidebar + trigger, same position (legacy behaviour)
//   - "sidebar": desktop sticky column only, no mobile trigger/overlay
//   - "trigger": mobile "Select Screener" button + overlay only, no sidebar
export default function ScreenerNav({
  currentHref,
  variant = "full",
}: {
  currentHref: string;
  variant?: "full" | "sidebar" | "trigger";
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
