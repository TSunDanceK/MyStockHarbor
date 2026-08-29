"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { SECTORS, sectorNewsPath } from "@/lib/sectors";
import { rememberSymbol } from "@/lib/symbol";

type StockNavKind = "earnings" | "analysis" | "news";

type NavChild = {
  label: string;
  href: string;
  isActive: (pathname: string) => boolean;
  stockNav?: StockNavKind;
  // Visually distinguishes a single "home" link for a dropdown section
  // (e.g. "Advanced Pickers Page") from the grouped items below it.
  emphasize?: boolean;
};

// A top-level row inside a dropdown menu: either a plain link, or a
// "submenu" trigger whose own items open in a second flyout menu to the
// right (or left, if there isn't room) of the trigger row, instead of
// being listed inline underneath a heading.
type NavDropdownLinkEntry = NavChild & { kind: "link" };

type NavDropdownSubmenuEntry = {
  kind: "submenu";
  label: string;
  items: NavChild[];
  isActive: (pathname: string) => boolean;
};

type NavDropdownEntry = NavDropdownLinkEntry | NavDropdownSubmenuEntry;

type NavDropdownItem = {
  kind: "dropdown";
  label: string;
  isActive: (pathname: string) => boolean;
  entries: NavDropdownEntry[];
  menuMinWidth?: number;
  submenuMinWidth?: number;
};

type NavLinkItem = NavChild & {
  kind: "link";
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
      rememberSymbol(pathSymbol);
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

// A submenu trigger row rendered inside an open NavDropdown's portal menu.
// Its own item list opens as a second, independently-positioned flyout
// menu -- preferring the right of the trigger row, falling back to the
// left if there isn't room, using the same viewport-clamping approach as
// the parent dropdown menu itself.
function NavSubmenu({
  label,
  items,
  lastSymbol,
  minWidth,
  onNavigate,
  closeAll,
  isOpen,
  onOpen,
  onClose,
}: {
  label: string;
  items: NavChild[];
  lastSymbol: string;
  minWidth: number;
  onNavigate: (stockNav: StockNavKind) => void;
  closeAll: () => void;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [flyoutPos, setFlyoutPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const gap = 4;
      const margin = 10;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(minWidth, viewportWidth - margin * 2);

      // Prefer opening to the right of the trigger row; fall back to the
      // left if there isn't enough room so the flyout never gets clipped
      // off the edge of the viewport (e.g. on narrower screens).
      let left = rect.right + gap;
      if (left + width + margin > viewportWidth) {
        left = rect.left - gap - width;
      }
      left = Math.min(Math.max(left, margin), viewportWidth - margin - width);

      let top = rect.top;
      const maxHeight = Math.max(160, viewportHeight - top - 16);
      if (top + 40 > viewportHeight - margin) {
        top = Math.max(margin, viewportHeight - margin - 40);
      }

      setFlyoutPos({ top, left, width, maxHeight });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, minWidth]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  function cancelScheduledClose() {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }

  function scheduleClose() {
    cancelScheduledClose();
    closeTimeoutRef.current = setTimeout(() => onClose(), 150);
  }

  const flyout =
    isOpen && flyoutPos ? (
      <div
        role="menu"
        className="mshGlobalHeaderDropdownMenu"
        style={{
          position: "fixed",
          top: flyoutPos.top,
          left: flyoutPos.left,
          width: flyoutPos.width,
          maxHeight: flyoutPos.maxHeight,
          overflowY: "auto",
          background: "#0b1220",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 10,
          boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
          padding: 6,
          zIndex: 310,
        }}
        onMouseEnter={cancelScheduledClose}
        onMouseLeave={scheduleClose}
      >
        {items.map((child) => {
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
                closeAll();

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
    ) : null;

  return (
    <div
      ref={triggerRef}
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={isOpen}
      tabIndex={0}
      className="mshGlobalHeaderDropdownItem mshGlobalHeaderDropdownItem--submenu"
      onMouseEnter={() => {
        cancelScheduledClose();
        onOpen();
      }}
      onMouseLeave={scheduleClose}
      onClick={() => (isOpen ? onClose() : onOpen())}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          isOpen ? onClose() : onOpen();
        } else if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        {label}
        <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>
          ▶
        </span>
      </span>

      {flyout ? createPortal(flyout, document.body) : null}
    </div>
  );
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
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
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
      const viewportWidth = window.innerWidth;
      const margin = 10;
      const desiredWidth = item.menuMinWidth ?? 180;

      // The menu was previously anchored purely by its right edge
      // (`right: window.innerWidth - rect.right`) with no horizontal
      // clamping. On mobile, triggers like "Pickers"/"News" sit close to
      // the right edge of the nav, so a menu wider than the remaining
      // space to the trigger's left got pushed off the left edge of the
      // viewport -- clipping roughly half its content. Anchor by `left`
      // instead (right-aligned to the trigger by default) and clamp both
      // edges to the viewport, capping the width so the whole menu always
      // stays on-screen and scrolls internally if it's still too tall.
      const width = Math.min(desiredWidth, viewportWidth - margin * 2);
      let left = rect.right - width;
      left = Math.min(Math.max(left, margin), viewportWidth - margin - width);

      setMenuPos({
        top,
        left,
        width,
        // Longer menus can otherwise run off the bottom of the viewport
        // on shorter screens -- clamp to available space below the
        // trigger and let the menu itself scroll instead.
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
  }, [open, item.menuMinWidth]);

  useEffect(() => {
    if (!open) setOpenSubmenu(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      // Flyout submenus (e.g. "Chart Plays" -> its right-hand item list)
      // are portaled to document.body as siblings of this main menu, so
      // they won't be inside menuRef's DOM tree -- match by the shared
      // menu class instead so a click inside an open flyout isn't treated
      // as "outside" and doesn't close everything.
      if (target instanceof Element && target.closest(".mshGlobalHeaderDropdownMenu")) {
        return;
      }
      setOpen(false);
      setOpenSubmenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setOpenSubmenu(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const closeAll = () => {
    setOpen(false);
    setOpenSubmenu(null);
  };

  const menu =
    open && menuPos ? (
      <div
        ref={menuRef}
        role="menu"
        className="mshGlobalHeaderDropdownMenu"
        style={{
          position: "fixed",
          top: menuPos.top,
          left: menuPos.left,
          width: menuPos.width,
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
        {item.entries.map((entry) => {
          if (entry.kind === "submenu") {
            return (
              <NavSubmenu
                key={entry.label}
                label={entry.label}
                items={entry.items}
                lastSymbol={lastSymbol}
                minWidth={item.submenuMinWidth ?? 240}
                onNavigate={onNavigate}
                closeAll={closeAll}
                isOpen={openSubmenu === entry.label}
                onOpen={() => setOpenSubmenu(entry.label)}
                onClose={() =>
                  setOpenSubmenu((prev) => (prev === entry.label ? null : prev))
                }
              />
            );
          }

          const childHref = entry.stockNav ? stockHref(lastSymbol, entry.stockNav) : entry.href;

          return (
            <Link
              key={entry.label}
              href={childHref}
              role="menuitem"
              className={`mshGlobalHeaderDropdownItem${
                entry.emphasize ? " mshGlobalHeaderDropdownItem--emphasis" : ""
              }`}
              onClick={(event) => {
                closeAll();

                if (!entry.stockNav) return;

                event.preventDefault();
                onNavigate(entry.stockNav);
              }}
            >
              {entry.label}
            </Link>
          );
        })}
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

// Full-screen mobile nav overlay, opened from the hamburger button below the
// 720px breakpoint. Reuses the same `navItems` data as the desktop header, but
// presents it as an iOS-style DRILL-DOWN stack rather than inline accordions:
// tapping a group slides to a panel showing only that group's children, with a
// Back button + the current section title, so only one level is ever on screen.
// The old expand-everything-inline accordion got unreadable three levels deep
// on a phone (Pickers -> Chart Plays -> its items all stacked at once).
function MobileNavOverlay({
  navItems,
  activePathname,
  lastSymbol,
  onNavigate,
  onClose,
}: {
  navItems: NavItem[];
  activePathname: string;
  lastSymbol: string;
  onNavigate: (stockNav: StockNavKind) => void;
  onClose: () => void;
}) {
  // The drill-down path: [] = root, [dropdown] = one level in, [dropdown,
  // submenu] = two levels in. Resetting happens automatically because the
  // overlay unmounts/remounts each time the menu opens.
  const [stack, setStack] = useState<Array<{ label: string }>>([]);
  const prevDepthRef = useRef(0);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Escape steps back one level if we've drilled in, otherwise closes.
      setStack((prev) => {
        if (prev.length > 0) return prev.slice(0, -1);
        onClose();
        return prev;
      });
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Slide direction: deeper than last render = forward (in from the right),
  // shallower = back (in from the left). Read before the effect updates the ref.
  const direction = stack.length >= prevDepthRef.current ? "fwd" : "back";
  useEffect(() => {
    prevDepthRef.current = stack.length;
  }, [stack.length]);

  const rootDropdown =
    stack.length >= 1
      ? navItems.find(
          (item): item is NavDropdownItem =>
            item.kind === "dropdown" && item.label === stack[0].label
        )
      : undefined;
  const activeSubmenu =
    stack.length >= 2 && rootDropdown
      ? rootDropdown.entries.find(
          (entry): entry is NavDropdownSubmenuEntry =>
            entry.kind === "submenu" && entry.label === stack[1].label
        )
      : undefined;

  type Row =
    | { kind: "leaf"; child: NavChild }
    | { kind: "branch"; label: string; active: boolean; open: () => void };

  let title = "Menu";
  let parentTitle: string | null = null;
  let rows: Row[] = [];

  if (stack.length === 0) {
    rows = navItems.map((item): Row =>
      item.kind === "dropdown"
        ? {
            kind: "branch",
            label: item.label,
            active: item.isActive(activePathname),
            open: () => setStack([{ label: item.label }]),
          }
        : { kind: "leaf", child: item }
    );
  } else if (stack.length === 1 && rootDropdown) {
    title = rootDropdown.label;
    parentTitle = "Menu";
    rows = rootDropdown.entries.map((entry): Row =>
      entry.kind === "submenu"
        ? {
            kind: "branch",
            label: entry.label,
            active: entry.isActive(activePathname),
            open: () => setStack((prev) => [...prev, { label: entry.label }]),
          }
        : { kind: "leaf", child: entry }
    );
  } else if (activeSubmenu && rootDropdown) {
    title = activeSubmenu.label;
    parentTitle = rootDropdown.label;
    rows = activeSubmenu.items.map((child): Row => ({ kind: "leaf", child }));
  }

  function renderLeaf(child: NavChild) {
    const href = child.stockNav ? stockHref(lastSymbol, child.stockNav) : child.href;
    const active = child.isActive(activePathname);
    return (
      <Link
        key={child.label}
        href={href}
        className={`mshDrillLink${child.emphasize ? " mshDrillLink--emphasis" : ""}${
          active ? " is-active" : ""
        }`}
        onClick={(event) => {
          onClose();
          if (!child.stockNav) return;
          event.preventDefault();
          onNavigate(child.stockNav);
        }}
      >
        {child.label}
      </Link>
    );
  }

  return createPortal(
    <div className="mshMobileOverlay" role="dialog" aria-modal="true" aria-label="Site menu">
      <div className="mshMobileOverlayHeader">
        {stack.length > 0 ? (
          <button
            type="button"
            className="mshDrillBack"
            onClick={() => setStack((prev) => prev.slice(0, -1))}
            aria-label={parentTitle ? `Back to ${parentTitle}` : "Back"}
          >
            <span aria-hidden="true" className="mshDrillBackChevron">‹</span>
            <span>{parentTitle}</span>
          </button>
        ) : (
          <span className="mshMobileOverlayTitle">Menu</span>
        )}
        <button
          type="button"
          className="mshMobileOverlayClose"
          onClick={onClose}
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>

      {stack.length > 0 ? <div className="mshDrillTitle">{title}</div> : null}

      <nav
        key={stack.map((s) => s.label).join("/") || "root"}
        className={`mshDrillPanel mshDrillPanel--${direction}`}
        aria-label="Mobile primary navigation"
      >
        {rows.map((row) =>
          row.kind === "leaf" ? (
            renderLeaf(row.child)
          ) : (
            <button
              key={row.label}
              type="button"
              className={`mshDrillBranch${row.active ? " is-active" : ""}`}
              onClick={row.open}
            >
              <span>{row.label}</span>
              <span aria-hidden="true" className="mshDrillBranchChevron">›</span>
            </button>
          )
        )}
      </nav>
    </div>,
    document.body
  );
}

export default function SiteHeader({
  latestVideoId,
}: {
  // Whichever YouTube video is currently newest, resolved server-side in
  // app/layout.tsx (cached hourly — see lib/youtube.ts) and threaded down
  // as a prop so this client component never needs its own fetch. `null`
  // when the YouTube lookup is unavailable (missing API key, quota, etc.)
  // -- the "Video Breakdowns" nav entry falls back to /insights in that case.
  latestVideoId: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const activePathname = normalisePathname(pathname);
  const lastSymbol = useLastStockSymbol(pathname);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // The mobile overlay is a one-way navigation surface -- once a route
  // change happens (a link was tapped, or the browser back/forward
  // buttons were used), there's no reason for it to still be open
  // underneath the new page.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const navItems = useMemo<NavItem[]>(
    () => [
      {
        kind: "link",
        label: "Dashboard",
        href: "/dashboard",
        isActive: (path) => path === "/" || path === "/dashboard",
      },
      {
        kind: "dropdown",
        label: "Pickers",
        isActive: (path) =>
          path === "/pickers" ||
          path === "/stock-screener" ||
          path === "/plays" ||
          path.startsWith("/plays/") ||
          path === "/macro-support-resistance-stocks" ||
          path === "/overbought-stocks-today" ||
          path === "/oversold-stocks-today" ||
          path === "/bullish-bearish-divergence-stocks" ||
          path === "/bullish-rsi-divergence-stocks" ||
          path === "/bearish-rsi-divergence-stocks" ||
          path === "/bullish-macd-divergence-stocks" ||
          path === "/bearish-macd-divergence-stocks" ||
          path === "/breakout-signal-stocks" ||
          path === "/volume-spike-stocks" ||
          path === "/atr-spike-stocks" ||
          path === "/stocks-above-50-day-moving-average" ||
          path === "/stocks-below-50-day-moving-average" ||
          path === "/stocks-trading-above-200-day-moving-average" ||
          path === "/stocks-below-200-day-moving-average" ||
          path === "/stocks-near-200-day-moving-average" ||
          path === "/stocks-near-weekly-200-day-moving-average" ||
          path === "/stocks-with-bullish-trend-flip" ||
          path === "/stocks-with-bearish-trend-flip" ||
          path === "/stocks-with-weekly-bullish-trend-flip" ||
          path === "/stocks-with-weekly-bearish-trend-flip" ||
          path === "/top-stocks-with-buy-signals" ||
          path === "/top-stocks-with-sell-signals" ||
          path === "/stocks-down-20-from-all-time-highs" ||
          path === "/all-time-high-breakout-stocks" ||
          path === "/3-month-high-breakout-stocks" ||
          path === "/best-trend-score-stocks" ||
          path === "/stocks-with-positive-last-earnings" ||
          path === "/stocks-with-strong-earnings-growth" ||
          path === "/low-pe-stocks" ||
          path === "/high-dividend-yield-stocks" ||
          path === "/dividend-growth-stocks" ||
          path === "/cash-rich-value-stocks" ||
          path === "/semiconductor-stocks" ||
          path === "/cheap-tech-stocks",
        menuMinWidth: 220,
        submenuMinWidth: 250,
        entries: [
          // Two landing options at the top of the Pickers dropdown, named for
          // what they are rather than which came first: "Advanced Screener" ->
          // the full screener at /stock-screener (every condition available as
          // a checkbox, nothing pre-applied), and "Basic Pickers Page" -> the
          // original /pickers accordion. "Advanced Screener" is deliberately
          // the same wording used in ScreenerNav's sidebar and in the page's
          // own H1, so one destination doesn't carry three different names.
          {
            kind: "link",
            label: "Advanced Screener",
            href: "/stock-screener",
            isActive: (path) => path === "/stock-screener",
            emphasize: true,
          },
          {
            kind: "link",
            label: "Basic Pickers Page",
            href: "/pickers",
            isActive: (path) => path === "/pickers",
            emphasize: true,
          },
          // Hand-written landing pages, each one a saved fundamental screen
          // (see claude/preset-pages-universe-blocker-2026-08-04.md). Placed
          // directly under the two landing links rather than at the bottom
          // because this is the primary route to them: they are not reachable
          // from any results page by clicking a condition, so the menu IS the
          // navigation. Internal linking, not the sitemap, is what gets these
          // indexed.
          {
            kind: "submenu",
            label: "Popular Screens",
            isActive: (path) =>
              path === "/low-pe-stocks" ||
              path === "/high-dividend-yield-stocks" ||
              path === "/dividend-growth-stocks" ||
              path === "/cash-rich-value-stocks" ||
              path === "/semiconductor-stocks" ||
              path === "/cheap-tech-stocks",
            items: [
              {
                label: "Low P/E Stocks",
                href: "/low-pe-stocks",
                isActive: (path) => path === "/low-pe-stocks",
              },
              {
                label: "High Dividend Yield",
                href: "/high-dividend-yield-stocks",
                isActive: (path) => path === "/high-dividend-yield-stocks",
              },
              {
                label: "Dividend Growth",
                href: "/dividend-growth-stocks",
                isActive: (path) => path === "/dividend-growth-stocks",
              },
              {
                label: "Cash-Rich Value",
                href: "/cash-rich-value-stocks",
                isActive: (path) => path === "/cash-rich-value-stocks",
              },
              {
                label: "Semiconductor Stocks",
                href: "/semiconductor-stocks",
                isActive: (path) => path === "/semiconductor-stocks",
              },
              {
                label: "Cheap Tech Stocks",
                href: "/cheap-tech-stocks",
                isActive: (path) => path === "/cheap-tech-stocks",
              },
            ],
          },
          {
            kind: "submenu",
            label: "Chart Plays",
            isActive: (path) =>
              path === "/plays" ||
              path.startsWith("/plays/") ||
              path === "/macro-support-resistance-stocks",
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
            kind: "submenu",
            label: "Indicator Plays",
            isActive: (path) =>
              path === "/overbought-stocks-today" ||
              path === "/oversold-stocks-today" ||
              path === "/bullish-bearish-divergence-stocks" ||
              path === "/bullish-rsi-divergence-stocks" ||
              path === "/bearish-rsi-divergence-stocks" ||
              path === "/bullish-macd-divergence-stocks" ||
              path === "/bearish-macd-divergence-stocks",
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
                label: "Bullish RSI Divergence",
                href: "/bullish-rsi-divergence-stocks",
                isActive: (path) => path === "/bullish-rsi-divergence-stocks",
              },
              {
                label: "Bearish RSI Divergence",
                href: "/bearish-rsi-divergence-stocks",
                isActive: (path) => path === "/bearish-rsi-divergence-stocks",
              },
              {
                label: "Bullish MACD Divergence",
                href: "/bullish-macd-divergence-stocks",
                isActive: (path) => path === "/bullish-macd-divergence-stocks",
              },
              {
                label: "Bearish MACD Divergence",
                href: "/bearish-macd-divergence-stocks",
                isActive: (path) => path === "/bearish-macd-divergence-stocks",
              },
            ],
          },
          {
            kind: "submenu",
            label: "Volume & Volatility",
            isActive: (path) =>
              path === "/breakout-signal-stocks" ||
              path === "/volume-spike-stocks" ||
              path === "/atr-spike-stocks",
            items: [
              {
                label: "Breakout Signals",
                href: "/breakout-signal-stocks",
                isActive: (path) => path === "/breakout-signal-stocks",
              },
              {
                label: "Volume Spike",
                href: "/volume-spike-stocks",
                isActive: (path) => path === "/volume-spike-stocks",
              },
              {
                label: "ATR Spike",
                href: "/atr-spike-stocks",
                isActive: (path) => path === "/atr-spike-stocks",
              },
            ],
          },
          {
            kind: "submenu",
            label: "Moving Averages",
            isActive: (path) =>
              path === "/stocks-near-200-day-moving-average" ||
              path === "/stocks-near-weekly-200-day-moving-average" ||
              path === "/stocks-above-50-day-moving-average" ||
              path === "/stocks-below-50-day-moving-average" ||
              path === "/stocks-trading-above-200-day-moving-average" ||
              path === "/stocks-below-200-day-moving-average",
            items: [
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
              {
                label: "Above 50-Day MA",
                href: "/stocks-above-50-day-moving-average",
                isActive: (path) => path === "/stocks-above-50-day-moving-average",
              },
              {
                label: "Below 50-Day MA",
                href: "/stocks-below-50-day-moving-average",
                isActive: (path) => path === "/stocks-below-50-day-moving-average",
              },
              {
                label: "Above 200-Day MA",
                href: "/stocks-trading-above-200-day-moving-average",
                isActive: (path) => path === "/stocks-trading-above-200-day-moving-average",
              },
              {
                label: "Below 200-Day MA",
                href: "/stocks-below-200-day-moving-average",
                isActive: (path) => path === "/stocks-below-200-day-moving-average",
              },
            ],
          },
          {
            kind: "submenu",
            label: "Trend Flips",
            isActive: (path) =>
              path === "/stocks-with-bullish-trend-flip" ||
              path === "/stocks-with-bearish-trend-flip" ||
              path === "/stocks-with-weekly-bullish-trend-flip" ||
              path === "/stocks-with-weekly-bearish-trend-flip",
            items: [
              {
                label: "Bullish Trend Flip (Daily)",
                href: "/stocks-with-bullish-trend-flip",
                isActive: (path) => path === "/stocks-with-bullish-trend-flip",
              },
              {
                label: "Bearish Trend Flip (Daily)",
                href: "/stocks-with-bearish-trend-flip",
                isActive: (path) => path === "/stocks-with-bearish-trend-flip",
              },
              {
                label: "Bullish Trend Flip (Weekly)",
                href: "/stocks-with-weekly-bullish-trend-flip",
                isActive: (path) => path === "/stocks-with-weekly-bullish-trend-flip",
              },
              {
                label: "Bearish Trend Flip (Weekly)",
                href: "/stocks-with-weekly-bearish-trend-flip",
                isActive: (path) => path === "/stocks-with-weekly-bearish-trend-flip",
              },
            ],
          },
          {
            kind: "submenu",
            label: "Earnings",
            isActive: (path) =>
              path === "/stocks-with-positive-last-earnings" ||
              path === "/stocks-with-strong-earnings-growth",
            items: [
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
            kind: "submenu",
            label: "Signals & Screens",
            isActive: (path) =>
              path === "/top-stocks-with-buy-signals" ||
              path === "/top-stocks-with-sell-signals" ||
              path === "/all-time-high-breakout-stocks" ||
              path === "/3-month-high-breakout-stocks" ||
              path === "/stocks-down-20-from-all-time-highs" ||
              path === "/best-trend-score-stocks" ||
              path === "/stocks-with-positive-last-earnings" ||
              path === "/stocks-with-strong-earnings-growth",
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
            ],
          },
          {
            kind: "link",
            label: "Build Screener",
            href: "/pickers#custom-screener",
            isActive: () => false,
          },
        ],
      },
      {
        kind: "dropdown",
        label: "Insights",
        isActive: (path) => path === "/insights" || path.startsWith("/insights/"),
        entries: [
          {
            kind: "link",
            label: "Insights",
            href: "/insights",
            isActive: (path) =>
              path === "/insights" ||
              (path.startsWith("/insights/") && !path.startsWith("/insights/videos")),
            emphasize: true,
          },
          {
            kind: "link",
            // Always points at whichever video is currently newest (see
            // `latestVideoId` above) -- never a hardcoded video ID, so this
            // link never goes stale as new videos get posted. Falls back to
            // /insights if the YouTube lookup didn't resolve a video.
            label: "Video Breakdowns",
            href: latestVideoId ? `/insights/videos/${latestVideoId}` : "/insights",
            isActive: (path) => path.startsWith("/insights/videos"),
          },
        ],
      },
      {
        kind: "link",
        label: "Bottlenecks",
        href: "/bottlenecks",
        isActive: (path) =>
          path === "/bottlenecks" || path.startsWith("/bottlenecks/"),
      },
      {
        kind: "dropdown",
        label: "Earnings",
        isActive: (path) => /^\/stock\/[^/]+\/earnings$/.test(path) || path === "/earnings-calendar",
        entries: [
          {
            kind: "link",
            label: "Company Earnings",
            href: stockHref(lastSymbol, "earnings"),
            stockNav: "earnings",
            isActive: (path) => /^\/stock\/[^/]+\/earnings$/.test(path),
          },
          {
            kind: "link",
            label: "Earnings Calendar",
            href: "/earnings-calendar",
            isActive: (path) => path === "/earnings-calendar",
          },
        ],
      },
      {
        kind: "dropdown",
        label: "News",
        // Wider than the 180px default: "Communication Services" and
        // "Consumer Defensive" need the room in the Sector News flyout.
        menuMinWidth: 210,
        submenuMinWidth: 250,
        isActive: (path) =>
          /^\/stock\/[^/]+\/news$/.test(path) ||
          path === "/sector" ||
          /^\/sector\/[^/]+/.test(path) ||
          path === "/upcoming-ipos" ||
          path === "/headlines",
        entries: [
          {
            kind: "link",
            label: "Stock News",
            href: stockHref(lastSymbol, "news"),
            stockNav: "news",
            isActive: (path) => /^\/stock\/[^/]+\/news$/.test(path),
          },
          {
            kind: "submenu",
            label: "Sector News",
            isActive: (path) => path === "/sector" || /^\/sector\/[^/]+/.test(path),
            items: [
              {
                label: "All Sectors",
                href: "/sector",
                isActive: (path) => path === "/sector",
                emphasize: true,
              },
              ...SECTORS.map((sector) => ({
                label: sector.name,
                href: sectorNewsPath(sector.slug),
                isActive: (path: string) => path === sectorNewsPath(sector.slug),
              })),
            ],
          },
          {
            kind: "link",
            label: "Upcoming IPO's",
            href: "/upcoming-ipos",
            isActive: (path) => path === "/upcoming-ipos",
          },
          {
            kind: "link",
            label: "Headlines",
            href: "/headlines",
            isActive: (path) => path === "/headlines",
          },
        ],
      },
      {
        kind: "dropdown",
        label: "Analysis",
        isActive: (path) => /^\/stock\/[^/]+$/.test(path) || path === "/markets/spx",
        entries: [
          {
            kind: "link",
            label: "Stock Analysis",
            href: stockHref(lastSymbol, "analysis"),
            stockNav: "analysis",
            isActive: (path) => /^\/stock\/[^/]+$/.test(path),
          },
          {
            kind: "link",
            label: "SPX Analysis",
            href: "/markets/spx",
            isActive: (path) => path === "/markets/spx",
          },
        ],
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
    [lastSymbol, latestVideoId]
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

        /* Subtle dark-theme scrollbar for long dropdown/flyout menus
           (e.g. the Pickers dropdown and its Chart/Indicator/Signals
           flyout submenus). */
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
          cursor: pointer;
        }

        .mshGlobalHeaderDropdownItem:hover {
          color: #eaf0fa;
          background: #141b2b;
        }

        /* A dropdown row that opens a flyout submenu instead of navigating
           directly -- same base look as a link item, plus a right-facing
           arrow (added inline) to hint that it expands sideways. */
        .mshGlobalHeaderDropdownItem--submenu {
          user-select: none;
        }

        /* "Home" link for a dropdown section (e.g. "Advanced Pickers Page") --
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

        /* Hamburger trigger for the mobile nav overlay -- hidden by
           default (desktop keeps the horizontal link row), shown only
           below the 720px breakpoint. Same dark-panel look as the
           header's own link buttons, with teal bars instead of a plain
           icon so it matches the site's palette rather than a generic
           stock icon. */
        .mshMobileMenuButton {
          display: none;
          width: 40px;
          height: 40px;
          flex: 0 0 auto;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 5px;
          padding: 0;
          border-radius: 10px;
          border: 1px solid #222c40;
          background: #141b2b;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .mshMobileMenuButton:hover,
        .mshMobileMenuButton:active {
          background: #1b2436;
          border-color: #2a3550;
        }

        .mshMobileMenuBar {
          display: block;
          width: 20px;
          height: 2.5px;
          border-radius: 999px;
          background: #6FE0D0;
        }

        /* Full-screen mobile nav overlay */
        .mshMobileOverlay {
          position: fixed;
          inset: 0;
          z-index: 500;
          background: #0b1220;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.18) transparent;
        }

        .mshMobileOverlayHeader {
          position: sticky;
          top: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          background: #0b1220;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          z-index: 1;
        }

        .mshMobileOverlayTitle {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(148,163,184,0.75);
        }

        .mshMobileOverlayClose {
          width: 38px;
          height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          border: 1px solid #222c40;
          background: #141b2b;
          color: #eaf0fa;
          font-size: 16px;
          line-height: 1;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .mshMobileOverlayClose:hover,
        .mshMobileOverlayClose:active {
          background: #1b2436;
          border-color: #2a3550;
        }

        .mshMobileOverlayNav {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 8px 10px 28px;
        }

        .mshMobileOverlayLink {
          display: block;
          padding: 14px 12px;
          border-radius: 10px;
          color: #d7deea;
          font-size: 15.5px;
          font-weight: 700;
          text-decoration: none;
        }

        .mshMobileOverlayLink:hover,
        .mshMobileOverlayLink:active {
          color: #eaf0fa;
          background: #141b2b;
        }

        .mshMobileOverlayLink.is-active {
          color: #eaf0fa;
          background: #141b2b;
          box-shadow: inset 0 0 0 1px #222c40;
        }

        .mshMobileOverlayLink--emphasis {
          font-weight: 800;
        }

        .mshMobileOverlayLink--nested {
          padding-left: 26px;
          font-size: 14.5px;
          font-weight: 600;
          color: #b7c1d1;
        }

        .mshMobileOverlayLink--nested2 {
          padding-left: 42px;
          font-size: 14px;
          font-weight: 600;
          color: #9aa7bb;
        }

        .mshMobileOverlayGroup {
          display: flex;
          flex-direction: column;
        }

        .mshMobileOverlayGroupTrigger {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 14px 12px;
          border: none;
          border-radius: 10px;
          background: transparent;
          color: #d7deea;
          font-size: 15.5px;
          font-weight: 700;
          font-family: inherit;
          text-align: left;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .mshMobileOverlayGroupTrigger:hover,
        .mshMobileOverlayGroupTrigger:active,
        .mshMobileOverlayGroupTrigger.is-active {
          color: #eaf0fa;
          background: #141b2b;
        }

        .mshMobileOverlayGroupTrigger--nested {
          padding-left: 26px;
          font-size: 14.5px;
          font-weight: 600;
          color: #b7c1d1;
        }

        .mshMobileOverlayChevron {
          font-size: 9px;
          opacity: 0.7;
          flex: 0 0 auto;
          transition: transform .15s;
        }

        .mshMobileOverlaySubgroup {
          display: flex;
          flex-direction: column;
        }

        /* ---- Drill-down mobile nav (iOS-style slide panels) ---- */
        .mshDrillTitle {
          padding: 4px 18px 12px;
          font-size: 27px;
          font-weight: 950;
          letter-spacing: -0.02em;
          color: #f8fafc;
        }

        .mshDrillPanel {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 6px 12px 32px;
        }

        .mshDrillPanel--fwd { animation: mshDrillInFwd 0.19s ease; }
        .mshDrillPanel--back { animation: mshDrillInBack 0.19s ease; }

        @keyframes mshDrillInFwd {
          from { transform: translateX(26px); opacity: 0; }
          to { transform: none; opacity: 1; }
        }
        @keyframes mshDrillInBack {
          from { transform: translateX(-26px); opacity: 0; }
          to { transform: none; opacity: 1; }
        }

        /* A leaf row = an actual page link. */
        .mshDrillLink {
          display: block;
          padding: 15px 14px;
          border-radius: 12px;
          color: #d7deea;
          font-size: 16px;
          font-weight: 700;
          text-decoration: none;
        }
        .mshDrillLink:hover,
        .mshDrillLink:active {
          color: #eaf0fa;
          background: #141b2b;
        }
        .mshDrillLink.is-active {
          color: #eaf0fa;
          background: #141b2b;
          box-shadow: inset 0 0 0 1px #222c40;
        }
        .mshDrillLink--emphasis { font-weight: 850; color: #eaf0fa; }

        /* A branch row = opens a deeper panel. Brighter + a right chevron so
           it's obviously "drills in" rather than "navigates". */
        .mshDrillBranch {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          width: 100%;
          padding: 15px 14px;
          border: none;
          border-radius: 12px;
          background: transparent;
          color: #e8eef8;
          font-size: 16px;
          font-weight: 800;
          font-family: inherit;
          text-align: left;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .mshDrillBranch:hover,
        .mshDrillBranch:active,
        .mshDrillBranch.is-active {
          color: #eaf0fa;
          background: #141b2b;
        }
        .mshDrillBranchChevron {
          flex: 0 0 auto;
          font-size: 22px;
          line-height: 1;
          color: #5c6b83;
        }
        .mshDrillBranch.is-active .mshDrillBranchChevron { color: #93c5fd; }

        /* Back button in the overlay header. */
        .mshDrillBack {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 6px 10px 6px 2px;
          border: none;
          background: transparent;
          color: #93c5fd;
          font-size: 15.5px;
          font-weight: 800;
          font-family: inherit;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .mshDrillBack:active { opacity: 0.7; }
        .mshDrillBackChevron { font-size: 24px; line-height: 1; margin-top: -2px; }

        @media (max-width: 720px) {
          .mshGlobalHeaderInner {
            flex-direction: row !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 8px !important;
            min-height: auto !important;
            padding: 10px 14px !important;
          }

          .mshGlobalHeaderLogo {
            align-self: center !important;
          }

          .mshGlobalHeaderLogo img {
            height: 32px !important;
          }

          /* Below this breakpoint the full link row is replaced by the
             hamburger + full-screen overlay -- hide it here instead of
             removing it from the tree, so the >720px layout above is
             completely untouched. */
          .mshGlobalHeaderNav {
            display: none !important;
          }

          .mshMobileMenuButton {
            display: inline-flex !important;
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
        <button
          type="button"
          className="mshMobileMenuButton"
          aria-label="Open menu"
          aria-haspopup="dialog"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen(true)}
        >
          <span className="mshMobileMenuBar" />
          <span className="mshMobileMenuBar" />
          <span className="mshMobileMenuBar" />
        </button>

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

      {mobileMenuOpen ? (
        <MobileNavOverlay
          navItems={navItems}
          activePathname={activePathname}
          lastSymbol={lastSymbol}
          onNavigate={(stockNav) =>
            router.push(stockHref(currentCachedSymbol(), stockNav))
          }
          onClose={() => setMobileMenuOpen(false)}
        />
      ) : null}
    </header>
  );
}
