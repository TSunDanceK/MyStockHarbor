"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type StockNavKind = "earnings" | "analysis" | "news";

type NavChild = {
  label: string;
  href: string;
  isActive: (pathname: string) => boolean;
  stockNav?: StockNavKind;
};

type NavLinkItem = NavChild & {
  kind: "link";
};

type NavDropdownItem = {
  kind: "dropdown";
  label: string;
  isActive: (pathname: string) => boolean;
  children: NavChild[];
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
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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

  return (
    <div ref={containerRef} style={{ position: "relative", flex: "0 0 auto" }}>
      <button
        type="button"
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

      {open && (
        <div
          role="menu"
          className="mshGlobalHeaderDropdownMenu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 180,
            background: "#0b1220",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
            padding: 6,
            zIndex: 200,
          }}
        >
          {item.children.map((child) => {
            const childHref = child.stockNav ? stockHref(lastSymbol, child.stockNav) : child.href;

            return (
              <Link
                key={child.label}
                href={childHref}
                role="menuitem"
                className="mshGlobalHeaderDropdownItem"
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
      )}
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
        kind: "link",
        label: "Pickers",
        href: "/pickers",
        isActive: (path) => path === "/pickers",
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
        isActive: (path) => /^\/stock\/[^/]+\/news$/.test(path) || path === "/upcoming-ipos",
        children: [
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
