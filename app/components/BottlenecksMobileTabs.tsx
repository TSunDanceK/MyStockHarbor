"use client";

import { useEffect, useState } from "react";

/**
 * Bottom tab bar for /bottlenecks on a phone.
 *
 * The index page stacks three blocks under 960px: the list of built pages,
 * the leaderboard, and the A-Z archive. That is a long scroll to reach the
 * leaderboard, and the two are separate things to look at rather than one
 * continuous read -- the same shape as Insights vs Videos, so it gets the
 * same docked bar.
 *
 * IMPORTANT -- how the switching works. This does NOT conditionally render
 * its children. The page is a server component and its blocks are passed in
 * already rendered; all this does is put a class on a wrapper, and CSS hides
 * whichever block is not the active tab. Two reasons:
 *
 * 1. The archive is the crawl path to every /bottlenecks/{ticker} page (see
 *    the note at the top of BottleneckArchive.tsx). Unmounting it would take
 *    those links out of the served HTML on the mobile layout Googlebot
 *    renders. Hidden by CSS, every <a> is still in the document exactly as
 *    it is today, and link discovery happens at HTML-parse time.
 * 2. Nothing has to be lifted out of page.tsx, so the server component keeps
 *    doing all the data reading.
 *
 * Blocks opt in by carrying data-bntab="list" or data-bntab="board".
 */

type Tab = "list" | "board";

const STORAGE_KEY = "bottlenecksMobileTab";

/** Rows: the list of built pages. Same glyph as the screener list toggle. */
function ListIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M4.6 6.5h.8M4.6 12h.8M4.6 17.5h.8" />
      <path d="M9 6.5h10.5M9 12h10.5M9 17.5h10.5" />
    </svg>
  );
}

/** A podium: three ranked bars, tallest in the middle. */
function LeaderboardIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <rect x="3" y="13" width="5.5" height="7" rx="1.2" />
      <rect x="9.25" y="7.5" width="5.5" height="12.5" rx="1.2" />
      <rect x="15.5" y="15.5" width="5.5" height="4.5" rx="1.2" />
    </svg>
  );
}

export default function BottlenecksMobileTabs({
  children,
}: {
  children: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("list");

  // Restored in an effect rather than as the initial state, so the server and
  // the first client render agree and there is no hydration mismatch.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved === "list" || saved === "board") setTab(saved);
    } catch {
      /* sessionStorage unavailable -- keep the default tab */
    }
  }, []);

  const selectTab = (next: Tab) => {
    setTab(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence failures (private mode, storage disabled) */
    }
  };

  // No re-measure hook needed on switching, and that is worth stating because
  // it very nearly was. Both blocks used to size an inner scroll window by
  // measuring their first rendered row, which measures zero inside a
  // display:none block -- so showing a tab would have needed a synthetic
  // resize to get a correct height. Neither has an inner scroll window at
  // this width any more: the leaderboard caps what it renders instead, and
  // the list's window is switched off under 960px. Nothing here measures, so
  // nothing here has to be told it became visible.

  return (
    <>
      <div className={`bnTabScope bnTabScope--${tab}`}>{children}</div>

      <div className="bnTabBar">
        <button
          type="button"
          className={tab === "list" ? "bnTabItem isActiveList" : "bnTabItem"}
          onClick={() => selectTab("list")}
          aria-current={tab === "list" ? "true" : undefined}
        >
          <ListIcon />
          <span className="bnTabLabel">Bottlenecks</span>
        </button>
        <button
          type="button"
          className={tab === "board" ? "bnTabItem isActiveBoard" : "bnTabItem"}
          onClick={() => selectTab("board")}
          aria-current={tab === "board" ? "true" : undefined}
        >
          <LeaderboardIcon />
          <span className="bnTabLabel">Leaderboard</span>
        </button>
      </div>

      <style>{`
        /* Off above the breakpoint, where the page shows the list and the
           leaderboard side by side and there is nothing to switch between. */
        .bnTabBar { display: none; }

        /* 960px is where the page's own grid collapses to one column -- the
           two have to match, or the bar would be hiding a block that is still
           sitting in a side rail. */
        @media (max-width: 960px) {
          .bnTabScope--list [data-bntab="board"] { display: none !important; }
          .bnTabScope--board [data-bntab="list"] { display: none !important; }

          .bnTabBar {
            display: flex;
            position: fixed; left: 0; right: 0; bottom: 0;
            /* Under the site header (100) and any sheet, over the page. Same
               layer the picker and insights bars use. */
            z-index: 55;
            align-items: stretch;
            /* Opaque. A translucent bar over a column of cards reads as
               smeared rather than as depth. */
            background: #080b12;
            border-top: 1px solid rgba(255,255,255,0.10);
            padding: 0 0 env(safe-area-inset-bottom);
          }

          /* Reserves the bar's height at the foot of the document, so the end
             of the archive and the "See more" button are not sitting
             underneath it. */
          body { padding-bottom: calc(58px + env(safe-area-inset-bottom)); }

          .bnTabItem {
            flex: 1 1 0; min-width: 0;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center; gap: 3px;
            padding: 7px 4px 6px;
            border: 0; background: none; cursor: pointer;
            font-family: system-ui, Arial;
            font-size: 10.5px; font-weight: 800; line-height: 1;
            color: rgba(148,163,184,0.85);
            transition: color 0.15s;
          }
          .bnTabItem:active { background: rgba(255,255,255,0.04); }
          /* The page's own two accent colours: blue for the list, teal for
             the ranking, matching its Latest / A-Z pills. */
          .bnTabItem.isActiveList { color: #93c5fd; }
          .bnTabItem.isActiveBoard { color: #5FD4C7; }
          .bnTabLabel {
            max-width: 100%; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap;
          }
        }
      `}</style>
    </>
  );
}
