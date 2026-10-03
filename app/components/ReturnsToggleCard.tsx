"use client";

// -- Daily | Weekly returns, ONE card with a segmented toggle (#552 COWORK #89) --
//
// Was two stacked ReturnsBarChart cards (COWORK #6). Now one card whose header
// holds a Daily | Weekly toggle; Daily is the default. The toggle swaps the
// WHOLE view together: the chart, its title line, the explainer sentence and
// the 3 stats tiles (latest change / up-down count / average). Each view is a
// complete ReturnsBarChart inside its own tab panel, so no part of one view can
// stay behind when the other is chosen (scripts/check-tiingo-step3.mjs renders
// both states and plants a "tiles don't switch" mutant).
//
// BOTH VIEWS ARE IN THE SERVER HTML. The inactive one carries `hidden`, so a
// crawler or a no-JS reader sees the daily view, and the toggle works the
// moment it hydrates: no client fetch, no data or calculation change (the same
// computeCloseOverCloseReturns / aggregateWeekly inputs, 20 daily, 12 weekly).
//
// ACCESSIBLE: a real tablist (role="tablist" / "tab" / "tabpanel",
// aria-selected, aria-controls), a roving tabindex, Arrow / Home / End keys
// (Enter and Space are the buttons' own). The active tab is not shown by
// colour alone: it carries a check mark, a heavier weight and an underline.
//
// STYLE SOURCE: the earnings page's Quarters/Years toggle named in COWORK #89
// was not found in this tree (no such toggle under app/), so the pill shape
// follows the Pickers data-view tabs (PickerResultPage .viewTab). Swap to the
// earnings toggle's styling once it is located.
import { useId, useRef, useState, type KeyboardEvent } from "react";
import ReturnsBarChart, { cardStyle, type ReturnBar } from "./ReturnsBarChart";

export type ReturnsViewKey = "daily" | "weekly";

type View = { key: ReturnsViewKey; tab: string; periodLabel: string; compareLabel: string; bars: ReturnBar[] };

// ReturnsBarChart renders nothing under 3 bars; a view it would blank is not offered.
const MIN_BARS = 3;

function viewsFor(daily: ReturnBar[], weekly: ReturnBar[]): View[] {
  const all: View[] = [
    { key: "daily", tab: "Daily", periodLabel: "Daily", compareLabel: "previous day's close", bars: daily },
    { key: "weekly", tab: "Weekly", periodLabel: "Weekly", compareLabel: "previous week's close", bars: weekly },
  ];
  return all.filter((v) => v.bars.length >= MIN_BARS);
}

/**
 * Stateless: the card for a given active view. Exported so the check can
 * render each state on the server and compare them.
 */
export function ReturnsToggleView({
  symbol,
  daily,
  weekly,
  active,
  idBase,
  onSelect,
  tabRef,
}: {
  symbol: string;
  daily: ReturnBar[];
  weekly: ReturnBar[];
  active: ReturnsViewKey;
  idBase: string;
  onSelect?: (key: ReturnsViewKey, focus: boolean) => void;
  tabRef?: (index: number, el: HTMLButtonElement | null) => void;
}) {
  const views = viewsFor(daily, weekly);
  if (!views.length) return null;
  const current = views.some((v) => v.key === active) ? active : views[0].key;
  const tabbed = views.length > 1;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = views.findIndex((v) => v.key === current);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % views.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + views.length) % views.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = views.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onSelect?.(views[next].key, true);
  }

  return (
    <div style={cardStyle}>
      {tabbed ? (
        <div className="returns-toggle-head">
          <div role="tablist" aria-label={`${symbol} close-over-close period`} className="returns-toggle" onKeyDown={onKeyDown}>
            {views.map((v, i) => {
              const on = v.key === current;
              return (
                <button
                  key={v.key}
                  ref={(el) => tabRef?.(i, el)}
                  type="button"
                  role="tab"
                  id={`${idBase}-tab-${v.key}`}
                  aria-selected={on}
                  aria-controls={`${idBase}-panel-${v.key}`}
                  tabIndex={on ? 0 : -1}
                  className={`returns-toggle-tab${on ? " is-active" : ""}`}
                  onClick={() => onSelect?.(v.key, false)}
                >
                  {on ? <span aria-hidden="true" className="returns-toggle-check">✓</span> : null}
                  {v.tab}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {views.map((v) => (
        <div
          key={v.key}
          role={tabbed ? "tabpanel" : undefined}
          id={`${idBase}-panel-${v.key}`}
          aria-labelledby={tabbed ? `${idBase}-tab-${v.key}` : undefined}
          hidden={v.key !== current}
        >
          <ReturnsBarChart bare symbol={symbol} periodLabel={v.periodLabel} compareLabel={v.compareLabel} bars={v.bars} />
        </div>
      ))}
      <style>{`
        .returns-toggle-head { display: flex; justify-content: flex-start; margin-bottom: 14px; }
        .returns-toggle { display: inline-flex; gap: 4px; padding: 3px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.03); }
        .returns-toggle-tab { display: inline-flex; align-items: center; gap: 5px; padding: 6px 14px; border-radius: 999px; border: 1px solid transparent; background: transparent; color: rgba(226,232,240,0.72); font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; text-decoration: none; }
        .returns-toggle-tab:hover { color: #dbeafe; }
        .returns-toggle-tab:focus-visible { outline: 2px solid rgba(96,165,250,0.9); outline-offset: 2px; }
        .returns-toggle-tab.is-active { font-weight: 900; text-decoration: underline; text-underline-offset: 4px; text-decoration-thickness: 2px; background: rgba(59,130,246,0.16); border-color: rgba(96,165,250,0.6); color: #eff6ff; }
        .returns-toggle-check { font-size: 11px; line-height: 1; }
      `}</style>
    </div>
  );
}

export default function ReturnsToggleCard({ symbol, daily, weekly }: { symbol: string; daily: ReturnBar[]; weekly: ReturnBar[] }) {
  const [active, setActive] = useState<ReturnsViewKey>("daily");
  const idBase = useId().replace(/:/g, "");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <ReturnsToggleView
      symbol={symbol}
      daily={daily}
      weekly={weekly}
      active={active}
      idBase={`returns${idBase}`}
      tabRef={(i, el) => {
        tabs.current[i] = el;
      }}
      onSelect={(key, focus) => {
        setActive(key);
        if (focus) tabs.current[key === "daily" ? 0 : 1]?.focus();
      }}
    />
  );
}
