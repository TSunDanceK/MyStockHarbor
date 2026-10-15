"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { rememberSymbol, SYMBOL_STORAGE_KEY } from "@/lib/symbol";
import { readStored } from "@/lib/browserStorage";
import { useFiledEarnings } from "@/app/components/useFiledEarnings";
import { navMatches } from "@/lib/navMatch";
import type { HeaderNavChild, HeaderNavItem, NavMatch, StockNavKind } from "@/lib/navSections";

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

    setLastSymbol(cleanSymbol(readStored(SYMBOL_STORAGE_KEY)));
  }, [pathname]);

  return lastSymbol;
}

function currentCachedSymbol() {
  if (typeof window === "undefined") return "AAPL";
  return cleanSymbol(readStored(SYMBOL_STORAGE_KEY));
}

/** The rule a child uses when the data names none: its own href, exactly. */
const ownHref = (child: HeaderNavChild): NavMatch => child.match ?? { exact: [child.href] };

/**
 * The header data (lib/navSections.ts) as the menus below consume it: rules
 * become isActive predicates, stock links take the last symbol, "Company
 * Earnings" is dropped unless that symbol has a filed set, and "Video
 * Breakdowns" points at the newest video when one is known.
 */
function buildNavItems(
  items: HeaderNavItem[],
  ctx: { lastSymbol: string; latestVideoId: string | null; earningsLinked: boolean }
): NavItem[] {
  const child = (c: HeaderNavChild): NavChild => {
    const rule = ownHref(c);
    return {
      label: c.label,
      href: c.stockNav ? stockHref(ctx.lastSymbol, c.stockNav) : c.latestVideo && ctx.latestVideoId ? `/insights/videos/${ctx.latestVideoId}` : c.href,
      isActive: (path) => navMatches(rule, path),
      ...(c.stockNav ? { stockNav: c.stockNav } : {}),
      ...(c.emphasize ? { emphasize: true } : {}),
    };
  };
  const shown = (c: HeaderNavChild) => !c.requiresFiledEarnings || ctx.earningsLinked;
  return items.map((item): NavItem => {
    if (item.kind === "link") return { kind: "link", ...child(item) };
    return {
      kind: "dropdown",
      label: item.label,
      isActive: (path) => navMatches(item.match, path),
      ...(item.menuMinWidth ? { menuMinWidth: item.menuMinWidth } : {}),
      ...(item.submenuMinWidth ? { submenuMinWidth: item.submenuMinWidth } : {}),
      entries: item.entries.filter((e) => e.kind === "submenu" || shown(e)).map((e) =>
        e.kind === "submenu"
          ? { kind: "submenu", label: e.label, isActive: (path: string) => navMatches(e.match, path), items: e.items.filter(shown).map(child) }
          : { kind: "link", ...child(e) }
      ),
    };
  });
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
  const flyoutRef = useRef<HTMLDivElement | null>(null);
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
      // The flyout sizes to its longest label (width: max-content below);
      // `minWidth` is a floor, not the width. Position by the MEASURED width
      // once it has rendered, so a long label is never clipped behind a
      // horizontal scrollbar (#563 COWORK #9).
      const width = Math.min(Math.max(minWidth, flyoutRef.current?.offsetWidth ?? 0), viewportWidth - margin * 2);

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
    // Once more after the flyout has rendered, now with its measured width.
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
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
        ref={flyoutRef}
        role="menu"
        className="mshGlobalHeaderDropdownMenu"
        style={{
          position: "fixed",
          top: flyoutPos.top,
          left: flyoutPos.left,
          minWidth: minWidth,
          width: "max-content",
          maxWidth: `calc(100vw - 20px)`,
          maxHeight: flyoutPos.maxHeight,
          overflowX: "hidden",
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
      // The menu sizes to its longest label (width: max-content below);
      // `menuMinWidth` is a floor, not the width. A fixed 180px clipped
      // "Capex — Follow the money" behind a horizontal scrollbar (#563
      // COWORK #9). Position by the MEASURED width once it has rendered.
      const measured = menuRef.current?.offsetWidth ?? 0;

      // The menu was previously anchored purely by its right edge
      // (`right: window.innerWidth - rect.right`) with no horizontal
      // clamping. On mobile, triggers like "Pickers"/"News" sit close to
      // the right edge of the nav, so a menu wider than the remaining
      // space to the trigger's left got pushed off the left edge of the
      // viewport -- clipping roughly half its content. Anchor by `left`
      // instead (right-aligned to the trigger by default) and clamp both
      // edges to the viewport, capping the width so the whole menu always
      // stays on-screen and scrolls internally if it's still too tall.
      const width = Math.min(Math.max(desiredWidth, measured), viewportWidth - margin * 2);
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
    // Once more after the menu has rendered, now with its measured width.
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
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
          minWidth: Math.min(item.menuMinWidth ?? 180, menuPos.width),
          width: "max-content",
          maxWidth: `calc(100vw - 20px)`,
          maxHeight: menuPos.maxHeight,
          overflowX: "hidden",
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

// The mobile menu as plain HTML (#553 COWORK #234): every top-level item and
// its links, server-rendered inside the header and hidden by CSS until the
// hamburger's checkbox is :checked. Groups are native <details>, so the whole
// menu opens and expands with JavaScript off, or before it has loaded (iPhone
// Safari left the button dead when the island did not hydrate). It is the
// fallback only: a hydrated island intercepts the hamburger and opens
// MobileNavOverlay (the drill-down) instead, so this never shows alongside it.
function StaticMobileMenu({
  navItems,
  activePathname,
  onNavigate,
}: {
  navItems: NavItem[];
  activePathname: string;
  onNavigate: () => void;
}) {
  const link = (child: NavChild, extra: string) => (
    <Link
      key={child.label}
      href={child.href}
      className={`mshMobileOverlayLink${extra}${child.emphasize ? " mshMobileOverlayLink--emphasis" : ""}${child.isActive(activePathname) ? " is-active" : ""}`}
      onClick={onNavigate}
    >
      {child.label}
    </Link>
  );
  const trigger = (label: string, active: boolean, nested: boolean) => (
    <summary className="mshStaticSummary">
      <span className={`mshMobileOverlayGroupTrigger${nested ? " mshMobileOverlayGroupTrigger--nested" : ""}${active ? " is-active" : ""}`}>
        <span>{label}</span>
        <span aria-hidden="true" className="mshMobileOverlayChevron">▶</span>
      </span>
    </summary>
  );
  return (
    <nav className="mshStaticMenu" aria-label="Site menu">
      <div className="mshMobileOverlayHeader">
        <span className="mshMobileOverlayTitle">Menu</span>
        <label htmlFor="mshMenuToggle" className="mshMobileOverlayClose" role="button" aria-label="Close menu">
          ✕
        </label>
      </div>
      <div className="mshMobileOverlayNav">
        {navItems.map((item) =>
          item.kind === "link" ? (
            link(item, "")
          ) : (
            <details key={item.label} className="mshMobileOverlayGroup" open={item.isActive(activePathname) || undefined}>
              {trigger(item.label, item.isActive(activePathname), false)}
              {item.entries.map((entry) =>
                entry.kind === "link" ? (
                  link(entry, " mshMobileOverlayLink--nested")
                ) : (
                  <details key={entry.label} className="mshMobileOverlaySubgroup" open={entry.isActive(activePathname) || undefined}>
                    {trigger(entry.label, entry.isActive(activePathname), true)}
                    {entry.items.map((child) => link(child, " mshMobileOverlayLink--nested2"))}
                  </details>
                )
              )}
            </details>
          )
        )}
      </div>
    </nav>
  );
}

/**
 * THE HEADER'S CLIENT ISLAND (#552 COWORK #231). SiteHeader (a server
 * component) renders the bar, its styles and the logo, and passes the nav tree
 * as data (lib/navSections.ts HEADER_NAV). Everything that needs the browser
 * lives here: the active state (usePathname), the dropdown and flyout menus,
 * the mobile overlay, the stock links resolved from the last symbol in
 * localStorage, and "Company Earnings" only when that symbol has a filed set.
 * It renders the button, the logo it is given, the nav row and the overlay, in
 * the bar's own order, so the markup is the same as before the split.
 */
export default function SiteHeaderNav({
  items,
  latestVideoId,
  logo,
}: {
  items: HeaderNavItem[];
  // Whichever YouTube video is currently newest, resolved server-side in
  // app/layout.tsx (cached hourly — see lib/youtube.ts) and threaded down
  // as a prop so this client component never needs its own fetch. `null`
  // when the YouTube lookup is unavailable (missing API key, quota, etc.)
  // -- the "Video Breakdowns" nav entry falls back to /insights in that case.
  latestVideoId: string | null;
  logo: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const activePathname = normalisePathname(pathname);
  const lastSymbol = useLastStockSymbol(pathname);
  // #552 COWORK #197: "Company Earnings" only when the last symbol has a filed SEC set.
  const { hasFiledEarnings } = useFiledEarnings();
  const earningsLinked = hasFiledEarnings(lastSymbol);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // The checkbox behind the no-JS menu (see StaticMobileMenu).
  const toggleRef = useRef<HTMLInputElement>(null);
  const closeStaticMenu = () => {
    if (toggleRef.current) toggleRef.current.checked = false;
  };

  // The mobile overlay is a one-way navigation surface -- once a route
  // change happens (a link was tapped, or the browser back/forward
  // buttons were used), there's no reason for it to still be open
  // underneath the new page.
  useEffect(() => {
    setMobileMenuOpen(false);
    closeStaticMenu();
  }, [pathname]);

  // Esc closes the no-JS menu if it was opened before this island hydrated.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeStaticMenu();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const navItems = useMemo<NavItem[]>(
    () => buildNavItems(items, { lastSymbol, latestVideoId, earningsLinked }),
    [items, lastSymbol, latestVideoId, earningsLinked]
  );

  return (
    <>
      {/* The hamburger is a checkbox + label so it works with no JavaScript
          (and before this island hydrates): see StaticMobileMenu. Once
          hydrated, a tap is taken over here and opens the drill-down overlay;
          the checkbox is put straight back, so the static menu only ever shows
          when this handler has not run. */}
      <input
        ref={toggleRef}
        id="mshMenuToggle"
        type="checkbox"
        className="mshMenuToggle"
        aria-label="Open menu"
        onChange={(event) => {
          if (!event.target.checked) return;
          event.target.checked = false;
          setMobileMenuOpen(true);
        }}
      />
      <label htmlFor="mshMenuToggle" className="mshMobileMenuButton" aria-hidden="true">
        <span className="mshMobileMenuBar" />
        <span className="mshMobileMenuBar" />
        <span className="mshMobileMenuBar" />
      </label>

      {logo}

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
                onNavigate={(stockNav) => {
                  // The cached symbol can have moved on since the menu was built: no filed set, no earnings page.
                  const sym = currentCachedSymbol();
                  router.push(stockHref(sym, stockNav === "earnings" && !hasFiledEarnings(sym) ? "analysis" : stockNav));
                }}
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

      <StaticMobileMenu navItems={navItems} activePathname={activePathname} onNavigate={closeStaticMenu} />

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
    </>
  );
}
