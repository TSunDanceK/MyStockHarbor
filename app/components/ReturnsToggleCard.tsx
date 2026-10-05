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
// MONTHLY (#553 COWORK #115): a third tab, each bar a calendar month's last
// close vs the previous month's, the last 12 complete months, from the same
// bars (lib/closeReturns.ts). THE MONTH IN PROGRESS is never shown as a full
// month. Two treatments, for the owner to choose between on a preview:
//   "omit" (default)  left out, with a line saying "October so far isn't included."
//   "show"            drawn as "Oct so far" with a lighter, dashed bar
// The tiles count complete months only in both. On a PREVIEW deployment only,
// `?monthPartial=show` switches to the second treatment, so both can be seen on
// one build; production always uses the default until the owner rules.
//
// STYLE SOURCE: the earnings page's Quarters/Years toggle named in COWORK #89
// was not found in this tree (no such toggle under app/), so the pill shape
// follows the Pickers data-view tabs (PickerResultPage .viewTab). Swap to the
// earnings toggle's styling once it is located.
import { useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import ReturnsBarChart, { cardStyle, type ReturnBar } from "./ReturnsBarChart";

export type ReturnsViewKey = "daily" | "weekly" | "monthly";

/** How the month in progress is treated (see the header). */
export type MonthPartialMode = "omit" | "show";

/** The monthly series as lib/closeReturns.ts's monthlyReturnBars returns it. */
export type MonthlyInput = { complete: ReturnBar[]; partial: ReturnBar | null; partialMonth: string | null };

type View = { key: ReturnsViewKey; tab: string; periodLabel: string; compareLabel: string; bars: ReturnBar[]; note?: string };

// ReturnsBarChart renders nothing under 3 bars; a view it would blank is not offered.
const MIN_BARS = 3;

function monthlyView(monthly: MonthlyInput | undefined, mode: MonthPartialMode): View | null {
  if (!monthly) return null;
  const show = mode === "show" && monthly.partial;
  return {
    key: "monthly",
    tab: "Monthly",
    periodLabel: "Monthly",
    compareLabel: "previous month's close",
    bars: show ? [...monthly.complete, monthly.partial as ReturnBar] : monthly.complete,
    note: monthly.partialMonth && !show ? `${monthly.partialMonth} so far isn't included.` : undefined,
  };
}

function viewsFor(daily: ReturnBar[], weekly: ReturnBar[], monthly?: MonthlyInput, mode: MonthPartialMode = "omit"): View[] {
  const m = monthlyView(monthly, mode);
  const all: View[] = [
    { key: "daily", tab: "Daily", periodLabel: "Daily", compareLabel: "previous day's close", bars: daily },
    { key: "weekly", tab: "Weekly", periodLabel: "Weekly", compareLabel: "previous week's close", bars: weekly },
    ...(m ? [m] : []),
  ];
  // Offered only with enough COMPLETE periods to chart (a partial bar does not count).
  return all.filter((v) => v.bars.filter((b) => !b.partial).length >= MIN_BARS);
}

/**
 * Stateless: the card for a given active view. Exported so the check can
 * render each state on the server and compare them.
 */
export function ReturnsToggleView({
  symbol,
  daily,
  weekly,
  monthly,
  partialMode = "omit",
  active,
  idBase,
  onSelect,
  tabRef,
}: {
  symbol: string;
  daily: ReturnBar[];
  weekly: ReturnBar[];
  monthly?: MonthlyInput;
  partialMode?: MonthPartialMode;
  active: ReturnsViewKey;
  idBase: string;
  onSelect?: (key: ReturnsViewKey, focus: boolean) => void;
  tabRef?: (index: number, el: HTMLButtonElement | null) => void;
}) {
  const views = viewsFor(daily, weekly, monthly, partialMode);
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
          <ReturnsBarChart bare symbol={symbol} periodLabel={v.periodLabel} compareLabel={v.compareLabel} bars={v.bars} note={v.note} />
        </div>
      ))}
      <style>{`
        .returns-toggle-head { display: flex; justify-content: flex-start; margin-bottom: 14px; }
        .returns-toggle { display: inline-flex; flex-wrap: wrap; max-width: 100%; gap: 4px; padding: 3px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.03); }
        .returns-toggle-tab { display: inline-flex; align-items: center; gap: 5px; padding: 6px 14px; border-radius: 999px; border: 1px solid transparent; background: transparent; color: rgba(226,232,240,0.72); font-family: inherit; font-size: var(--fs-label); font-weight: 600; cursor: pointer; white-space: nowrap; text-decoration: none; }
        .returns-toggle-tab:hover { color: #dbeafe; }
        .returns-toggle-tab:focus-visible { outline: 2px solid rgba(96,165,250,0.9); outline-offset: 2px; }
        .returns-toggle-tab.is-active { font-weight: 900; text-decoration: underline; text-underline-offset: 4px; text-decoration-thickness: 2px; background: rgba(59,130,246,0.16); border-color: rgba(96,165,250,0.6); color: #eff6ff; }
        .returns-toggle-check { font-size: var(--fs-label); line-height: 1; }
        /* #563 COWORK #100: room for the label size at 320 px (CSS only). */
        @media (max-width: 360px) { .returns-toggle-tab { padding: 6px 10px; } }
      `}</style>
    </div>
  );
}

/**
 * The month-in-progress treatment for this page view: "omit" everywhere, except
 * a preview deployment asked for `?monthPartial=show` (#553 COWORK #115). A
 * preview is told by its host: Vercel serves previews on *.vercel.app, and
 * production only on the site's own domain. Pure; exported for the check.
 */
export function partialModeFor(hostname: string, search: string): MonthPartialMode {
  if (!hostname.endsWith(".vercel.app")) return "omit";
  return new URLSearchParams(search).get("monthPartial") === "show" ? "show" : "omit";
}

const noSubscribe = () => () => {};

export default function ReturnsToggleCard({ symbol, daily, weekly, monthly }: { symbol: string; daily: ReturnBar[]; weekly: ReturnBar[]; monthly?: MonthlyInput }) {
  const [active, setActive] = useState<ReturnsViewKey>("daily");
  // "omit" in the server HTML; a preview's ?monthPartial=show applies on hydration.
  const partialMode = useSyncExternalStore(
    noSubscribe,
    () => partialModeFor(window.location.hostname, window.location.search),
    () => "omit" as MonthPartialMode
  );
  const idBase = useId().replace(/:/g, "");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <ReturnsToggleView
      symbol={symbol}
      daily={daily}
      weekly={weekly}
      monthly={monthly}
      partialMode={partialMode}
      active={active}
      idBase={`returns${idBase}`}
      tabRef={(i, el) => {
        tabs.current[i] = el;
      }}
      onSelect={(key, focus) => {
        setActive(key);
        // By id, not position: a view without enough bars is not offered.
        if (focus) tabs.current.find((el) => el?.id.endsWith(`-tab-${key}`))?.focus();
      }}
    />
  );
}
