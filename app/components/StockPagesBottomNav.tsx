"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { rememberSymbol } from "@/lib/symbol";

/**
 * Bottom nav across the four symbol-scoped pages: the chart (/dashboard),
 * the analysis page, its news and its earnings.
 *
 * These four are one subject looked at four ways, and moving between them
 * currently means the header menu or a scroll to the "Explore More" block at
 * the foot of the analysis page. On a phone that is the wrong shape for
 * something you do repeatedly.
 *
 * This is NOT the site-wide bottom nav from the closed PR #272. It only
 * mounts on these four routes, and every item stays within one ticker.
 */

const STORAGE_KEY = "msh_last_symbol";
// Matches the dashboard's own server-side default in app/dashboard/page.tsx,
// so a first-ever visitor with nothing remembered gets links to the same
// symbol the chart in front of them is showing.
const FALLBACK_SYMBOL = "SPY";

type NavKey = "chart" | "analysis" | "news" | "earnings";

function cleanSymbol(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

function NavIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

/** Candles: the chart. */
function ChartIcon() {
  return (
    <NavIcon>
      <path d="M8 4v3M8 15v5M16 4v5M16 17v3" />
      <rect x="5.5" y="7" width="5" height="8" rx="1.2" />
      <rect x="13.5" y="9" width="5" height="8" rx="1.2" />
    </NavIcon>
  );
}

/**
 * A magnifier over three bars: the analysis page.
 *
 * Round on purpose. Three of these four glyphs would otherwise be rounded
 * rectangles at 22px, which is the mistake the picker controls bar had to be
 * rebuilt to fix -- four slots, one recognisable shape.
 */
function AnalysisIcon() {
  return (
    <NavIcon>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.6-4.6" />
      <path d="M8.5 12.5v-1.8M10.5 12.5v-4M12.5 12.5v-2.8" />
    </NavIcon>
  );
}

/** A newspaper: a lead image and column rules. */
function NewsIcon() {
  return (
    <NavIcon>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <rect x="6" y="8" width="5" height="4.5" rx="1" />
      <path d="M13.5 8.5h4.5M13.5 12h4.5M6 15.5h12" />
    </NavIcon>
  );
}

/** A calendar: earnings are a date before they are a number. */
function EarningsIcon() {
  return (
    <NavIcon>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
      <path d="M8 14h3M8 17h6" />
    </NavIcon>
  );
}

export default function StockPagesBottomNav() {
  const pathname = usePathname() ?? "";

  // On a /stock/... route the ticker is in the URL, so it is known during the
  // first render and the links are correct before hydration. Anywhere else
  // (i.e. the dashboard) it has to be looked up, which is what the effect
  // below does.
  const pathSymbol = cleanSymbol(
    decodeURIComponent((pathname.match(/^\/stock\/([^/]+)/) || [])[1] ?? "")
  );
  const [symbol, setSymbol] = useState(pathSymbol);

  useEffect(() => {
    const readStored = () => {
      try {
        return cleanSymbol(window.localStorage.getItem(STORAGE_KEY));
      } catch {
        return "";
      }
    };

    if (pathSymbol) {
      setSymbol(pathSymbol);
      // Same write SiteHeader makes, for the same reason: arriving at a stock
      // page is what makes it the last-viewed symbol everywhere else.
      // rememberSymbol writes localStorage AND the msh_sym cookie, and
      // swallows its own failures -- localStorage unavailable (Safari private
      // mode) or cookies blocked just means the nav forgets, as before.
      rememberSymbol(pathSymbol);
      return;
    }

    const urlSymbol = cleanSymbol(
      new URLSearchParams(window.location.search).get("symbol")
    );
    setSymbol(readStored() || urlSymbol);

    // The dashboard is the one page here that changes symbol WITHOUT
    // navigating: its search box calls setSymbol in place and DashboardClient
    // writes the new ticker to localStorage. Nothing about that is observable
    // from out here -- the storage event only fires in other tabs -- so the
    // choice is to poll it or to let these three links keep pointing at
    // whatever ticker the page opened on, which on the page whose whole
    // purpose is switching tickers is not a small bug.
    //
    // One localStorage read a second, only on this route, and setState only
    // when the value actually changed, so an idle dashboard re-renders never.
    if (pathname !== "/dashboard") return;
    const timer = window.setInterval(() => {
      const next = readStored();
      if (next) setSymbol((current) => (current === next ? current : next));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pathname, pathSymbol]);

  const active: NavKey = pathname.startsWith("/dashboard")
    ? "chart"
    : /\/news\/?$/.test(pathname)
      ? "news"
      : /\/earnings\/?$/.test(pathname)
        ? "earnings"
        : "analysis";

  const encoded = encodeURIComponent(symbol || FALLBACK_SYMBOL);

  const items: { key: NavKey; label: string; href: string; icon: React.ReactNode }[] = [
    { key: "chart", label: "Chart", href: `/dashboard?symbol=${encoded}`, icon: <ChartIcon /> },
    { key: "analysis", label: "Analysis", href: `/stock/${encoded}`, icon: <AnalysisIcon /> },
    { key: "news", label: "News", href: `/stock/${encoded}/news`, icon: <NewsIcon /> },
    { key: "earnings", label: "Earnings", href: `/stock/${encoded}/earnings`, icon: <EarningsIcon /> },
  ];

  return (
    <>
      <nav className="stockNavBar" aria-label="This stock">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            // Not optional. This bar is permanently in the viewport, and Next
            // prefetches a Link the moment it enters one -- without this it
            // would prefetch four expensive dynamic routes on every page of
            // this section, for every visitor. That is the exact real-user
            // impact claude/list-link-prefetch-disable-2026-07-21.md had to
            // undo, and the reason the closed BottomNav in PR #272 carried
            // the same flag.
            prefetch={false}
            className={
              item.key === active ? "stockNavItem isActive" : "stockNavItem"
            }
            aria-current={item.key === active ? "page" : undefined}
          >
            {item.icon}
            <span className="stockNavLabel">{item.label}</span>
          </Link>
        ))}
      </nav>

      <style>{`
        /* Phone only. A pointer has the header menu, which shows all four
           without costing a strip of the screen. */
        .stockNavBar { display: none; }

        @media (max-width: 980px) {
          .stockNavBar {
            display: flex;
            position: fixed; left: 0; right: 0; bottom: 0;
            /* Under the site header (100) and well under the chart's
               fullscreen overlay (130), which must cover this. */
            z-index: 55;
            align-items: stretch;
            background: #080b12;
            border-top: 1px solid rgba(255,255,255,0.10);
            padding: 0 0 env(safe-area-inset-bottom);
          }

          body { padding-bottom: calc(58px + env(safe-area-inset-bottom)); }

          .stockNavItem {
            flex: 1 1 0; min-width: 0;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center; gap: 3px;
            padding: 7px 4px 6px;
            text-decoration: none;
            font-family: system-ui, Arial;
            font-size: 10.5px; font-weight: 800; line-height: 1;
            color: rgba(148,163,184,0.85);
            transition: color 0.15s;
            -webkit-tap-highlight-color: transparent;
          }
          .stockNavItem:active { background: rgba(255,255,255,0.04); }
          .stockNavItem.isActive { color: #93c5fd; }
          .stockNavLabel {
            max-width: 100%; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap;
          }
        }
      `}</style>
    </>
  );
}
