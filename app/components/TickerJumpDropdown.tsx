"use client";

import { useEffect, type RefObject } from "react";
import TickerLogo from "@/app/components/TickerLogo";

/**
 * Shared results dropdown for the three "jump to another ticker" search
 * boxes: StockTickerJump (analysis), EarningsSymbolPicker (earnings) and
 * StockNewsTickerJump (news). Each of those keeps its own query state,
 * /api/symbols fetching and navigation target -- only the panel itself and
 * its dismiss behaviour live here.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 * The three had drifted into three different implementations, and the
 * analysis one was broken on mobile. It positioned the panel with
 * `position: fixed` and recalculated the coordinates from the input's
 * bounding rect on every scroll event. On a phone the page scrolls on the
 * compositor thread while that repositioning runs on the main thread and
 * lands late, so the panel chased the input instead of being attached to
 * it ("both the page and the search drop-down scrolls with thumb
 * movements and it's a bit weird").
 *
 * ── Why it is NOT a fixed panel with a scroll lock ──────────────────────
 * The first attempt at this file locked page scroll while the dropdown was
 * open, keeping the fixed panel. That was worse, and it is worth recording
 * why so nobody tries it again:
 *
 * Tapping the input makes iOS scroll the page to clear the keyboard.
 * Applying `overflow: hidden` to the body immediately afterwards makes iOS
 * snap the page back. The input, being in normal flow, moves with it -- but
 * the panel had already been measured and pinned in viewport coordinates,
 * so it stayed where it was. Input and dropdown visibly came apart and
 * overlapped each other.
 *
 * Any approach that measures the input's position and then pins the panel
 * to those coordinates is racing the iOS keyboard, and loses.
 *
 * ── What this does instead ──────────────────────────────────────────────
 * The panel is a normal absolutely-positioned child of the input's
 * wrapper. The browser keeps them together with no JavaScript at all: no
 * measurement, no scroll listener, nothing that can fall out of sync. The
 * page scrolls with the dropdown open, and the dropdown travels with it,
 * attached -- which is the standard behaviour and reads as correct.
 *
 * Requirement on callers: the wrapper element passed as `wrapRef` must be
 * `position: relative` and must NOT sit inside an ancestor with `overflow:
 * hidden`, or the panel will be clipped.
 */

export type SymbolResult = {
  symbol: string;
  name: string;
  exchange: string;
};

/**
 * Closes the dropdown on a tap/click outside `wrapRef`, or on Escape.
 *
 * Listens for `touchstart` as well as `mousedown`: on iOS the synthesised
 * mouse events are unreliable, which is why tapping away from these boxes
 * previously often failed to dismiss them.
 */
export function useDismissOnOutside(
  wrapRef: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void
) {
  useEffect(() => {
    if (!active) return;

    function handleOutside(event: MouseEvent | TouchEvent) {
      const wrap = wrapRef.current;
      if (!wrap) return;
      if (wrap.contains(event.target as Node)) return;
      onDismiss();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside, { passive: true });
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [wrapRef, active, onDismiss]);
}

/**
 * The results panel. Renders nothing unless open with results, and sits
 * directly beneath its wrapper -- see the module comment for why this is
 * deliberately plain.
 */
export function TickerJumpDropdown({
  open,
  results,
  onChoose,
  maxResults = 8,
}: {
  open: boolean;
  results: SymbolResult[];
  onChoose: (result: SymbolResult) => void;
  maxResults?: number;
}) {
  if (!open || results.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Ticker search results"
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        left: 0,
        right: 0,
        zIndex: 60,
        // Caps the list on short screens (and with the keyboard up) so it
        // scrolls internally rather than running off the bottom.
        maxHeight: "52vh",
        overflowY: "auto",
        // Stops a flick inside the list from chaining into the page behind
        // it once the list hits its end.
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
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
  );
}
