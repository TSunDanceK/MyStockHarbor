"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import TickerLogo from "@/app/components/TickerLogo";

/**
 * Shared results dropdown for the three "jump to another ticker" search
 * boxes: StockTickerJump (analysis), EarningsSymbolPicker (earnings) and
 * StockNewsTickerJump (news). Each of those keeps its own query state,
 * /api/symbols fetching and navigation target -- only the dropdown itself,
 * its positioning and its open/dismiss behaviour live here.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 * The three had drifted into three different dropdown implementations.
 * StockTickerJump used `position: fixed` with a capture-phase scroll
 * listener recalculating its coordinates on every scroll event. On a phone
 * that is a race the JS cannot win: the page scrolls on the compositor
 * thread while the repositioning runs on the main thread and lands late, so
 * the panel visibly chased the input instead of moving with it (reported
 * from mobile: "both the page and the search drop-down scrolls with thumb
 * movements and it's a bit weird"). The other two used `position:
 * absolute`, which tracks correctly but can be clipped by any ancestor
 * overflow.
 *
 * ── The behaviour this implements ───────────────────────────────────────
 *   - Focusing/typing in the box opens the dropdown.
 *   - While it is open the page behind CANNOT scroll.
 *   - Tapping anywhere outside the dropdown or the input closes it and
 *     restores scrolling, with no navigation and no change of selection.
 *   - Tapping a result navigates to that ticker's page.
 *
 * Locking scroll is what makes the positioning problem disappear rather
 * than merely damping it: nothing can lag behind a page that is not
 * moving. The rAF-throttled reposition below is only a safety net for the
 * cases the lock does not cover (viewport resize, the mobile keyboard
 * opening, or a browser that ignores the lock).
 */

export type SymbolResult = {
  symbol: string;
  name: string;
  exchange: string;
};

type AnchorRect = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

/**
 * Measures where the dropdown should sit, from the input's live bounding
 * rect. Returns null while closed so nothing is rendered.
 *
 * Repositioning is throttled to one measurement per animation frame. The
 * old implementation called setState synchronously inside the scroll
 * handler, which is what made the panel judder during momentum scrolling.
 */
export function useTickerJumpAnchor(
  open: boolean,
  anchorRef: RefObject<HTMLInputElement | null>
): AnchorRect | null {
  const [rect, setRect] = useState<AnchorRect | null>(null);

  useEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }

    let frame = 0;

    function measure() {
      const el = anchorRef.current;
      if (!el) return;

      const r = el.getBoundingClientRect();
      const gap = 8;
      const margin = 10;
      const top = r.bottom + gap;

      setRect({
        top,
        left: r.left,
        width: r.width,
        // Clamp to whatever is left below the input so a long result list
        // scrolls internally instead of running off the bottom of the
        // screen -- which matters most on a phone with the keyboard up.
        maxHeight: Math.max(160, window.innerHeight - top - margin),
      });
    }

    function schedule() {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    }

    measure();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    // The mobile keyboard opening/closing changes the visual viewport
    // without firing a window resize on iOS.
    window.visualViewport?.addEventListener("resize", schedule);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [open, anchorRef]);

  return rect;
}

/**
 * The dropdown itself, portaled to document.body so no ancestor overflow
 * can clip it, over a full-screen backdrop that both blocks scrolling and
 * acts as the "tap outside to dismiss" target.
 */
export function TickerJumpDropdown({
  open,
  rect,
  results,
  onChoose,
  onDismiss,
  maxResults = 8,
}: {
  open: boolean;
  rect: AnchorRect | null;
  results: SymbolResult[];
  onChoose: (result: SymbolResult) => void;
  /** Called for tap-outside and Escape. Must NOT change the selection. */
  onDismiss: () => void;
  maxResults?: number;
}) {
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const visible = open && rect !== null && results.length > 0;

  // Lock the page while the dropdown is up. Restores whatever was there
  // before rather than assuming "" -- another component (e.g. the mobile
  // nav overlay) may legitimately hold its own lock.
  useEffect(() => {
    if (!visible) return;

    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [visible]);

  // `overflow: hidden` on body is not enough on iOS Safari, which will
  // still rubber-band the page. Cancelling touchmove on the backdrop is
  // what actually stops it. This has to be a native listener with
  // { passive: false } -- React attaches touchmove passively, and a
  // passive listener is forbidden from calling preventDefault.
  //
  // Only touches that land ON the backdrop reach this handler, so the
  // dropdown panel above it still scrolls its own overflow normally.
  useEffect(() => {
    const el = backdropRef.current;
    if (!el || !visible) return;

    function blockScroll(event: TouchEvent) {
      event.preventDefault();
    }

    el.addEventListener("touchmove", blockScroll, { passive: false });
    return () => el.removeEventListener("touchmove", blockScroll);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, onDismiss]);

  if (!visible || !rect) return null;

  return createPortal(
    <>
      <div
        ref={backdropRef}
        aria-hidden="true"
        onClick={onDismiss}
        style={{
          position: "fixed",
          inset: 0,
          // Barely-there dim. Without it the frozen page reads as broken
          // rather than deliberately held still; with more it would look
          // like a modal dialog, which this is not.
          background: "rgba(2,6,23,0.38)",
          zIndex: 9998,
        }}
      />

      <div
        role="listbox"
        aria-label="Ticker search results"
        style={{
          position: "fixed",
          top: rect.top,
          left: rect.left,
          width: rect.width,
          maxHeight: rect.maxHeight,
          overflowY: "auto",
          overscrollBehavior: "contain",
          zIndex: 9999,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "#0b1220",
          boxShadow: "0 18px 34px rgba(0,0,0,0.72)",
        }}
      >
        {results.slice(0, maxResults).map((result) => (
          <button
            key={`${result.symbol}-${result.exchange}`}
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => onChoose(result)}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "12px 14px",
              border: "none",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              background: "#0b1220",
              color: "#f8fafc",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <TickerLogo symbol={result.symbol} size={22} radius={6} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 950 }}>{result.symbol}</div>
              <div
                style={{
                  marginTop: 3,
                  fontSize: 13,
                  color: "rgba(241,245,249,0.66)",
                }}
              >
                {result.name}
                {result.exchange ? ` • ${result.exchange}` : ""}
              </div>
            </div>
          </button>
        ))}
      </div>
    </>,
    document.body
  );
}
