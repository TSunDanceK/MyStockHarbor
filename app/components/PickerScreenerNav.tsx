"use client";

// Left-hand screener navigation for the picker result pages.
// - Desktop: a sticky, grouped sidebar styled to match the /learn menu.
// - Mobile: a single "Select Screener" button that opens a full overlay
//   (not an inline drop-down) so it doesn't push the page content down.
//
// The screener list mirrors the pill row that used to sit across the top of
// every picker page. Groups/labels here are purely presentational and easy
// to reorder or rename without touching page logic.

import Link from "next/link";
import { useEffect, useState } from "react";

type Tone = "green" | "yellow" | "orange" | "red" | "blue";

type NavItem = { href: string; label: string; icon: string; tone: Tone };
type NavGroup = { label: string; color: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    label: "Signals",
    color: "rgba(96,165,250,0.95)",
    items: [
      { href: "/top-stocks-with-buy-signals", label: "Buy Signals", icon: "\u25B2", tone: "green" },
      { href: "/top-stocks-with-sell-signals", label: "Sell Signals", icon: "\u25BC", tone: "red" },
    ],
  },
  {
    label: "Momentum",
    color: "rgba(52,211,153,0.95)",
    items: [
      { href: "/oversold-stocks-today", label: "Oversold", icon: "\u25CF", tone: "green" },
      { href: "/overbought-stocks-today", label: "Overbought", icon: "\u25CF", tone: "red" },
      { href: "/best-trend-score-stocks", label: "Best Trend", icon: "\u2605", tone: "green" },
    ],
  },
  {
    label: "Breakouts",
    color: "rgba(251,146,60,0.95)",
    items: [
      { href: "/all-time-high-breakout-stocks", label: "ATH Breakouts", icon: "\u2197", tone: "orange" },
      { href: "/3-month-high-breakout-stocks", label: "3-Month Highs", icon: "\u2197", tone: "orange" },
    ],
  },
  {
    label: "Key Levels",
    color: "rgba(250,204,21,0.95)",
    items: [
      { href: "/stocks-down-20-from-all-time-highs", label: "20% From ATH", icon: "\u25C6", tone: "yellow" },
      { href: "/stocks-near-200-day-moving-average", label: "Near 200-Day", icon: "\u25C7", tone: "yellow" },
      { href: "/stocks-near-weekly-200-day-moving-average", label: "Weekly MA200", icon: "\u25C6", tone: "yellow" },
      { href: "/macro-support-resistance-stocks", label: "Macro S/R", icon: "\u21C4", tone: "blue" },
    ],
  },
  {
    label: "Divergence",
    color: "rgba(96,165,250,0.8)",
    items: [
      { href: "/bullish-bearish-divergence-stocks", label: "Divergence", icon: "\u2687", tone: "blue" },
    ],
  },
  {
    label: "Earnings",
    color: "rgba(52,211,153,0.8)",
    items: [
      { href: "/stocks-with-positive-last-earnings", label: "Last Earnings", icon: "\u2713", tone: "green" },
      { href: "/stocks-with-strong-earnings-growth", label: "Earnings Growth", icon: "\u2197", tone: "green" },
    ],
  },
];

const ALL_ITEMS = GROUPS.flatMap((group) => group.items);

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
    <nav className="pscreenNav" aria-label="Stock screeners">
      {GROUPS.map((group) => (
        <div key={group.label} className="pscreenGroup">
          <div className="pscreenGroupLabel" style={{ color: group.color }}>
            {group.label}
          </div>
          <div className="pscreenItems">
            {group.items.map((item) => {
              const active = item.href === currentHref;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={active ? "pscreenItem active" : "pscreenItem"}
                  onClick={onNavigate}
                >
                  <span className="pscreenIcon" style={{ color: toneColour(item.tone) }}>
                    {item.icon}
                  </span>
                  <span className="pscreenLabel">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default function PickerScreenerNav({ currentHref }: { currentHref: string }) {
  const [open, setOpen] = useState(false);
  const current = ALL_ITEMS.find((item) => item.href === currentHref);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <div className="pscreenRoot">
      {/* Desktop sticky sidebar */}
      <aside className="pscreenDesktop" aria-label="Screeners">
        <div className="pscreenSticky">
          <div className="pscreenTitle">Screeners</div>
          <NavList currentHref={currentHref} />
        </div>
      </aside>

      {/* Mobile trigger */}
      <button
        type="button"
        className="pscreenTrigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="pscreenTriggerLabel">
          {current ? (
            <>
              <span className="pscreenIcon" style={{ color: toneColour(current.tone) }}>
                {current.icon}
              </span>
              {current.label}
            </>
          ) : (
            "Select Screener"
          )}
        </span>
        <span className="pscreenTriggerHint">Select screener &#9662;</span>
      </button>

      {/* Mobile overlay */}
      {open ? (
        <div className="pscreenOverlay" role="dialog" aria-modal="true" aria-label="Select screener">
          <button
            type="button"
            className="pscreenBackdrop"
            aria-label="Close screener menu"
            onClick={() => setOpen(false)}
          />
          <div className="pscreenSheet">
            <div className="pscreenSheetHead">
              <span>Select Screener</span>
              <button
                type="button"
                className="pscreenClose"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                &#10005;
              </button>
            </div>
            <div className="pscreenSheetBody">
              <NavList currentHref={currentHref} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        .pscreenRoot { min-width: 0; }

        .pscreenDesktop { border: 1px solid rgba(255,255,255,0.10); border-radius: 16px; background: rgba(255,255,255,0.03); padding: 8px 8px 14px; }
        .pscreenSticky { position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent; }
        .pscreenTitle { font-size: 12px; font-weight: 950; letter-spacing: 0.12em; text-transform: uppercase; color: #93c5fd; padding: 10px 12px 2px; }

        .pscreenNav { display: grid; gap: 2px; }
        .pscreenGroup { display: grid; }
        .pscreenGroupLabel { font-size: 11px; font-weight: 950; letter-spacing: 0.12em; text-transform: uppercase; padding: 12px 12px 6px; }
        .pscreenItems { display: grid; gap: 2px; }
        .pscreenItem { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 10px; text-decoration: none; font-size: 13.5px; line-height: 1.3; font-weight: 600; color: rgba(226,232,240,0.80); border: 1px solid transparent; }
        .pscreenItem:hover { background: rgba(255,255,255,0.05); }
        .pscreenItem.active { font-weight: 900; color: #dbeafe; background: linear-gradient(135deg, rgba(59,130,246,0.24), rgba(37,99,235,0.12)); border: 1px solid rgba(59,130,246,0.40); }
        .pscreenIcon { flex: 0 0 auto; width: 14px; text-align: center; font-size: 12px; }
        .pscreenLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .pscreenTrigger { display: none; width: 100%; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; padding: 12px 14px; border-radius: 14px; border: 1px solid rgba(96,165,250,0.36); background: linear-gradient(135deg, rgba(59,130,246,0.16), rgba(15,23,42,0.62)); color: #eff6ff; font-weight: 900; font-size: 14px; cursor: pointer; }
        .pscreenTriggerLabel { display: inline-flex; align-items: center; gap: 9px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pscreenTriggerHint { flex: 0 0 auto; font-size: 12px; font-weight: 800; color: rgba(219,234,254,0.72); }

        .pscreenOverlay { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; }
        .pscreenBackdrop { position: absolute; inset: 0; border: 0; padding: 0; background: rgba(2,6,15,0.72); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); cursor: pointer; }
        .pscreenSheet { position: relative; margin: auto 12px; width: calc(100% - 24px); max-width: 460px; max-height: 82vh; display: flex; flex-direction: column; border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; background: linear-gradient(180deg, rgba(15,23,42,0.98), rgba(6,10,18,0.99)); box-shadow: 0 30px 80px rgba(0,0,0,0.6); overflow: hidden; }
        .pscreenSheetHead { display: flex; align-items: center; justify-content: space-between; padding: 16px 16px 12px; font-size: 15px; font-weight: 950; letter-spacing: 0.02em; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .pscreenClose { border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.05); color: #e5e7eb; border-radius: 10px; width: 34px; height: 34px; font-size: 14px; cursor: pointer; }
        .pscreenSheetBody { padding: 6px 8px 14px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent; }

        @media (max-width: 980px) {
          .pscreenDesktop { display: none; }
          .pscreenTrigger { display: flex; }
        }
      `}</style>
    </div>
  );
}
