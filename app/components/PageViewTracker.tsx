"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Fires once per real, client-rendered navigation into this segment --
// both the initial SSR load's hydration and any later client-side route
// change re-run this effect exactly when `pathname` changes.
//
// This deliberately does NOT run for background Link prefetches: a
// prefetch only fetches the RSC payload for a route into Next's router
// cache, it never mounts the component tree, so this effect never fires
// for one no matter how many prefetch requests a page generates. That's
// what makes this a reliable real-visit counter without touching Link
// prefetch behavior anywhere on the site (see
// claude/stock-daily-rate-limit-2026-07-21.md for why that route was
// avoided).
//
// Uses sendBeacon so this never delays or blocks navigation/rendering --
// it's fire-and-forget, off the critical path, and survives the page
// being torn down mid-request (which a plain fetch() can't guarantee).
export default function PageViewTracker({ category }: { category: string }) {
  const pathname = usePathname();

  useEffect(() => {
    const body = JSON.stringify({ category });

    try {
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon("/api/internal/track-view", blob);
      } else {
        fetch("/api/internal/track-view", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Tracking is best-effort; never let it affect the page.
    }
    // Only re-fire on an actual navigation to a new pathname.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
