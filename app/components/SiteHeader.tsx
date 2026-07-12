"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type StockNavKind = "earnings" | "analysis" | "news";

type NavChild = {
  label: string;
  href: string;
  isActive: (pathname: string) => boolean;
  stockNav?: StockNavKind;
  // Visually distinguishes a single "home" link for a dropdown section
  // (e.g. "Main Pickers Page") from the grouped items below it.
  emphasize?: boolean;
};

type NavDropdownSection = {
  // Omit for a section with no visible group label (e.g. the standalone
  // "home" link at the top, or a standalone item at the bottom).
  heading?: string;
  items: NavChild[];
};

type NavLinkItem = NavChild & {
  kind: "link";
};

type NavDropdownItem = {
  kind: "dropdown";
  label: string;
  isActive: (pathname: string) => boolean;
  sections: NavDropdownSection[];
  menuMinWidth?: number;
};

type NavItem = NavLinkItem | NavDropdownItem;

function cleanSymbol(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");

  return cleaned || "AAPL";
}

function symbolFromPathname(pathname: string | null) {
  if (!pathname) return null;

  const match = pathname.match(/^\/stock\/([^/]+)/i);
  if (!match?.[1]) return null;

  try {
    return cleanSymbol(decodeURIComponent(match[1]));
  } catch {
    return cleanSymbol(match[1]);
  }
}

function stockHref(symbol: string, kind: StockNavKind) {
  const encoded = encodeURIComponent(cleanSymbol(symbol));

  if (kind === "earnings") return `/stock/${encoded}/earnings`;
  if (kind === "news") return `/stock/${encoded}/news`;
  return `/stock/${encoded}`;
}

function useLastStockSymbol(pathname: string | null) {
  const [lastSymbol, setLastSymbol] = useState("AAPL");

  useEffect(() => {
    const pathSymbol = symbolFromPathname(pathname);

    if (pathSymbol) {
      setLastSymbol(pathSymbol);
      window.localStorage.setItem("msh_last_symbol", pathSymbol);
      return;
    }

    setLastSymbol(cleanSymbol(window.localStorage.getItem("msh_last_symbol")));
  }, [pathname]);

  return lastSymbol;
}

function currentCachedSymbol() {
  if (typeof window === "undefined") return "AAPL";
  return cleanSymbol(window.localStorage.getItem("msh_last_symbol"));
}

function normalisePathname(pathname: string | null) {
  if (!pathname) return "/";
  const withoutTrailingSlash = pathname.replace(/\/$/, "");
  return withoutTrailingSlash || "/";
}

function NavDropdown({
  item,
  active,
  lastSymbol,
  onNavigate,
}: {
  item: NavDropdownItem;
  active: boolean;
  lastSymbol: string;
  onNavigate: (stockNav: StockNavKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number; maxHeight: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // No SSR/hydration guard is needed for the portal target below: `open`
  // starts false on both server and client, so the portal only ever
  // mounts after a click -- by which point this is definitely running in
  // the browser and `document` is available.

  // The nav bar needs `overflow-x: auto` so it can scroll on narrow
  // screens, but that also clips any absolutely-positioned child that
  // extends past the nav's own box -- which silently hid this dropdown's
  // menu entirely (confirmed live: the menu was present in the DOM and
  // marked open, just invisible). Rendering the menu into a portal at
  // document.body, positioned from the trigger's live bounding rect, sidesteps
  // that ancestor overflow clipping regardless of where this component sits.
  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const top = rect.bottom + 6;
      setMenuPos({
        top,
        right: window.innerWidth - rect.right,
        // Longer menus (e.g. the Pickers dropdown, now ~22 items across 3
        // sections) can otherwise run off the bottom of the viewport on
        // shorter screens -- clamp to available space below the trigger
        // and let the menu itself scroll instead.
        maxHeight: Math.max(160, window.innerHeight - top - 16),
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const menu =
    open && menuPos ? (
      <div
        ref={menuRef}
        role="menu"
        className="mshGlobalHeaderDropdownMenu"
        style={{
          position: "fixed",
          top: menuPos.top,
          right: menuPos.right,
          minWidth: item.menuMinWidth ?? 180,
          maxHeight: menuPos.maxHeight,
          overflowY: "auto",
          background: "#0b1220",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 10,
          boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
          padding: 6,
          zIndex: 300,
        }}
      >
        {item.sections.map((section, sectionIndex) => (
          <div
            key={section.heading ?? `section-${sectionIndex}`}
            className={sectionIndex > 0 ? "mshGlobalHeaderDropdownSection" : undefined}
          >
            {section.heading ? (
              <div className="mshGlobalHeaderDropdownHeading">{section.heading}</div>
            ) : null}

            {section.items.map((child) => {
              const childHref = child.stockNav ? stockHref(lastSymbol, child.stockNav) : child.href;

              return (
                <Link
                  key={child.label}
                  href={childHref}
                  role="menuitem"
                  className={`mshGlobalHeaderDropdownItem${
                    child.emphasize ? " mshGlobalHeaderDropdownItem--emphasis" : ""
                  }`}
                  onClick={(event) => {
                    setOpen(false);

                    if (!child.stockNav) return;

                    event.preventDefault();
                    onNavigate(child.stockNav);
                  }}
                >
                  {child.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    ) : null;

  return (
    <div ref={containerRef} style={{ position: "relative", flex: "0 0 auto" }}>
      <button
        type="button"
        ref={triggerRef}
        className={`mshGlobalHeaderLink mshGlobalHeaderDropdownTrigger ${
          active ? "is-active" : ""
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {item.label}
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            marginLeft: 5,
            fontSize: 9,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .15s",
          }}
        >
          ▼
        </span>
      </button>

      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

export default function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const activePathname = normalisePathname(pathname);
  const lastSymbol = useLastStockSymbol(pathname);

  const navItems = useMemo<NavItem[]>(
    () => [
      {
        kind: "link",
        label: "Dashboard",
        href: "/",
        isActive: (path) => path === "/" || path === "/dashboard",
      },
      {
        kind: "dropdown",
        label: "Pickers",
        isActive: (path) =>
          path === "/pickers" ||
          path === "/plays" ||
          path.startsWith("/plays/") ||
          path === "/macro-support-resistance-stocks" ||
          path === "/overbought-stocks-today" ||
          path === "/oversold-stocks-today" ||
          path === "/bullish-bearish-divergence-stocks" ||
          path === "/stocks-with-high-rsi" ||
          path === "/stocks-with-low-rsi" ||
          path === "/stocks-near-200-day-moving-average" ||
          path === "/stocks-near-weekly-200-day-moving-average" ||
          path === "/top-stocks-with-buy-signals" ||
          path === "/top-stocks-with-sell-signals" ||
          path === "/stocks-down-20-from-all-time-highs" ||
          path === "/all-time-high-breakout-stocks" ||
          path === "/3-month-high-breakout-stocks" ||
          path === "/best-trend-score-stocks" ||
          path === "/stocks-with-positive-last-earnings" ||
          path === "/stocks-with-strong-earnings-growth",
        menuMinWidth: 260,
        sections: [
          {
            items: [
              {
                label: "Main Pickers Page",
                href: "/pickers",
                isActive: (path) => path === "/pickers",
                emphasize: true,
              },
            ],
          },
          {
            heading: "Chart Plays",
            items: [
              {
                label: "Ascending Triangle Plays",
                href: "/plays",
                isActive: (path) => path === "/plays",
              },
              {
                label: "Descending Triangle Plays",
                href: "/plays/descending-triangles",
                isActive: (path) => path === "/plays/descending-triangles",
              },
              {
                label: "Bull Flag Plays",
                href: "/plays/bull-flags",
                isActive: (path) => path === "/plays/bull-flags",
              },
              {
                label: "Macro Support & Resistance Plays",
                href: "/macro-support-resistance-stocks",
                isActive: (path) => path === "/macro-support-resistance-stocks",
              },
            ],
          },
          {
            heading: "Indicator Plays",
            items: [
              {
                label: "Overbought Stocks",
                href: "/overbought-stocks-today",
                isActive: (path) => path === "/overbought-stocks-today",
              },
              {
                label: "Oversold Stocks",
                href: "/oversold-stocks-today",
                isActive: (path) => path === "/oversold-stocks-today",
              },
              {
                label: "Bullish / Bearish Divergence",
                href: "/bullish-bearish-divergence-stocks",
                isActive: (path) => path === "/bullish-bearish-divergence-stocks",
              },
              {
                label: "High RSI Stocks",
                href: "/stocks-with-high-rsi",
                isActive: (path) => path === "/stocks-with-high-rsi",
              },
              {
                label: "Low RSI Stocks",
                href: "/stocks-with-low-rsi",
                isActive: (path) => path === "/stocks-with-low-rsi",
              },
              {
                label: "Near 200-Day MA (Daily)",
                href: "/stocks-near-200-day-moving-average",
                isActive: (path) => path === "/stocks-near-200-day-moving-average",
              },
              {
                label: "Near 200-Day MA (Weekly)",
                href: "/stocks-near-weekly-200-day-moving-average",
                isActive: (path) => path === "/stocks-near-weekly-200-day-moving-average",
              },
            ],
          },
          {
            heading: "Signals & Screens",
            items: [
              {
                label: "Buy Signals",
                href: "/top-stocks-with-buy-signals",
                isActive: (path) => path === "/top-stocks-with-buy-signals",
              },
              {
                label: "Sell Signals",
                href: "/top-stocks-with-sell-signals",
                isActive: (path) => path === "/top-stocks-with-sell-signals",
              },
              {
                label: "ATH Breakouts",
                href: "/all-time-high-breakout-stocks",
                isActive: (path) => path === "/all-time-high-breakout-stocks",
              },
              {
                label: "3-Month Highs",
                href: "/3-month-high-breakout-stocks",
                isActive: (path) => path === "/3-month-high-breakout-stocks",
              },
              {
                label: "20% From ATH",
                href: "/stocks-down-20-from-all-time-highs",
                isActive: (path) => path === "/stocks-down-20-from-all-time-highs",
              },
              {
                label: "Best Trend Score",
                href: "/best-trend-score-stocks",
                isActive: (path) => path === "/best-trend-score-stocks",
              },
              {
                label: "Positive Last Earnings",
                href: "/stocks-with-positive-last-earnings",
                isActive: (path) => path === "/stocks-with-positive-last-earnings",
              },
              {
                label: "Strong Earnings Growth",
                href: "/stocks-with-strong-earnings-growth",
                isActive: (path) => path === "/stocks-with-strong-earnings-growth",
              },
            ],
          },
          {
            items: [
              {
                label: "Build Screener",
                href: "/pickers#custom-screener",
                isActive: () => false,
              },
            ],
          },
        ],
      },
      {
        kind: "link",
        label: "Insights",
        href: "/insights",
        isActive: (path) => path === "/insights" || path.startsWith("/insights/"),
      },
      {
        kind: "link",
        label: "Bottlenecks",
        href: "/bottlenecks",
        isActive: (path) =>
          path === "/bottlenecks" || path.startsWith("/bottlenecks/"),
      },
      {
        kind: "link",
        label: "Earnings",
        href: stockHref(lastSymbol, "earnings"),
        stockNav: "earnings",
        isActive: (path) => /^\/stock\/[^/]+\/earnings$/.test(path),
      },
      {
        kind: "dropdown",
        label: "News",
        isActive: (path) =>
          /^\/stock\/[^/]+\/news$/.test(path) ||
          path === "/upcoming-ipos" ||
          path === "/headlines",
        sections: [
          {
            items: [
              {
                label: "Stock News",
                href: stockHref(lastSymbol, "news"),
                stockNav: "news",
                isActive: (path) => /^\/stock\/[^/]+\/news$/.test(path),
              },
              {
                label: "Upcoming IPO's",
                href: "/upcoming-ipos",
                isActive: (path) => path === "/upcoming-ipos",
              },
              {
                label: "Headlines",
                href: "/headlines",
                isActive: (path) => path === "/headlines",
              },
            ],
          },
        ],
      },
      {
        kind: "link",
        label: "Stock Analysis",
        href: stockHref(lastSymbol, "analysis"),
        stockNav: "analysis",
        isActive: (path) => /^\/stock\/[^/]+$/.test(path),
      },
      {
        kind: "link",
        label: "Platforms",
        href: "/platforms",
        isActive: (path) => path === "/platforms",
      },
      {
        kind: "link",
        label: "Calculators",
        href: "/utilities",
        isActive: (path) => path === "/utilities",
      },
      {
        kind: "link",
        label: "Learn",
        href: "/learn",
        isActive: (path) => path === "/learn" || path.startsWith("/learn/"),
      },
    ],
    [lastSymbol]
  );

  return (
    <header
      className="mshGlobalHeader"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "rgba(10,15,26,0.94)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid #1a2336",
      }}
    >
      <style>{`
        .mshGlobalHeaderNav::-webkit-scrollbar { display: none; }

        /* Base Link Styles */
        .mshGlobalHeaderLink {
          color: #8a97ad;
          font-size: 13.5px;
          font-weight: 700;
          text-decoration: none;
          padding: 7px 12px;
          border-radius: 8px;
          transition: color .15s, background .15s, border-color .15s, box-shadow .15s;
          white-space: nowrap;
          border: 1px solid transparent !important;
          background: transparent;
          box-shadow: none !important;
          line-height: 1.2;
          flex: 0 0 auto;
          outline: none !important;
          -webkit-tap-highlight-color: transparent;
        }

        .mshGlobalHeaderDropdownTrigger {
          font-family: inherit;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
        }

        /* Subtle dark-theme scrollbar for long dropdown menus (e.g. the
           Pickers dropdown once it's grouped into 3 sections). */
        .mshGlobalHeaderDropdownMenu {
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.18) transparent;
        }

        .mshGlobalHeaderDropdownMenu::-webkit-scrollbar {
          width: 7px;
        }

        .mshGlobalHeaderDropdownMenu::-webkit-scrollbar-track {
          background: transparent;
        }

        .mshGlobalHeaderDropdownMenu::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.16);
          border-radius: 999px;
        }

        .mshGlobalHeaderDropdownMenu::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.28);
        }

        .mshGlobalHeaderDropdownItem {
          display: block;
          color: #b7c1d1;
          font-size: 13.5px;
          font-weight: 600;
          text-decoration: none;
          padding: 8px 10px;
          border-radius: 7px;
          white-space: nowrap;
          transition: color .15s, background .15s;
        }

        .mshGlobalHeaderDropdownItem:hover {
          color: #eaf0fa;
          background: #141b2b;
        }

        /* "Home" link for a dropdown section (e.g. "Main Pickers Page") --
           slightly bolder/brighter than the grouped items below it. */
        .mshGlobalHeaderDropdownItem--emphasis {
          font-weight: 800;
          color: #eaf0fa;
        }

        /* Small uppercase, muted section label -- same visual language as
           the "Screened Results" / "FAQ" section headers on the pickers
           page (app/pickers/page.tsx). */
        .mshGlobalHeaderDropdownHeading {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(148,163,184,0.65);
          padding: 10px 10px 4px;
        }

        .mshGlobalHeaderDropdownSection {
          margin-top: 2px;
          padding-top: 4px;
          border-top: 1px solid rgba(255,255,255,0.06);
        }

        /* Active Path Styles */
        .mshGlobalHeaderLink.is-active {
          color: #eaf0fa !important;
          background: #141b2b !important;
          border-color: #222c40 !important;
          box-shadow: 0 0 0 1px rgba(255,255,255,0.02) inset !important;
        }

        /* Hover Effect (Optional, for better UX) */
        .mshGlobalHeaderLink:hover:not(.is-active) {
          color: #eaf0fa;
        }

        /* Aggressively Strip Focus Rings on Inactive Elements */
        .mshGlobalHeaderLink:not(.is-active):focus,
        .mshGlobalHeaderLink:not(.is-active):active,
        .mshGlobalHeaderLink:not(.is-active):focus-visible {
          outline: none !important;
          box-shadow: none !important;
          border-color: transparent !important;
          background: transparent !important;
        }

        @media (max-width: 720px) {
          .mshGlobalHeaderInner {
            align-items: stretch !important;
            flex-direction: column !important;
            gap: 8px !important;
            min-height: auto !important;
            padding: 10px 12px 8px !important;
          }

          .mshGlobalHeaderLogo {
            align-self: flex-start !important;
          }

          .mshGlobalHeaderLogo img {
            height: 34px !important;
          }

          .mshGlobalHeaderNav {
            margin-left: 0 !important;
            width: 100% !important;
          }

          .mshGlobalHeaderLink {
            font-size: 12.5px !important;
            padding: 8px 10px !important;
          }
        }
      `}</style>

      <div
        className="mshGlobalHeaderInner"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 18px",
          minHeight: 50,
        }}
      >
        <Link
          href="/"
          aria-label="MyStockHarbor home"
          className="mshGlobalHeaderLogo"
          style={{
            display: "inline-flex",
            alignItems: "center",
            textDecoration: "none",
            flex: "0 0 auto",
            outline: "none",
          }}
        >
          <img
            src="/logo.png"
            alt="MyStockHarbor"
            style={{
              height: 38,
              width: "auto",
              display: "block",
              objectFit: "contain",
            }}
          />
        </Link>

        <nav
          aria-label="Primary navigation"
          className="mshGlobalHeaderNav"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            marginLeft: "auto",
            minWidth: 0,
            overflowX: "auto",
            scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {navItems.map((item) => {
            const active = item.isActive(activePathname);

            if (item.kind === "dropdown") {
              return (
                <NavDropdown
                  key={item.label}
                  item={item}
                  active={active}
                  lastSymbol={lastSymbol}
                  onNavigate={(stockNav) =>
                    router.push(stockHref(currentCachedSymbol(), stockNav))
                  }
                />
              );
            }

            const href = item.stockNav ? stockHref(lastSymbol, item.stockNav) : item.href;

            return (
              <Link
                key={item.label}
                href={href}
                className={`mshGlobalHeaderLink ${active ? "is-active" : ""}`}
                onClick={(event) => {
                  // Force the browser to drop the element focus
                  event.currentTarget.blur();

                  if (!item.stockNav) return;

                  event.preventDefault();
                  router.push(stockHref(currentCachedSymbol(), item.stockNav));
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
