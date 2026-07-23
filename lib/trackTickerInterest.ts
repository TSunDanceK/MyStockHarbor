// Client-only beacon for the "Popular Searches" demand signal.
//
// Call this ONLY from a real user-selection handler -- when someone deliberately
// picks a ticker from a search result (or explicitly searches one). Never call
// it on mount, render, or keystroke. That's the whole bot defense: crawlers
// don't run these selection handlers, so they never count. Server-side
// validation, dedup and rate-limit live in lib/server/searchDemand.ts, hit via
// POST /api/track/ticker-interest.
//
// Fire-and-forget via navigator.sendBeacon so it never delays the navigation
// that usually follows a selection. Silently no-ops on the server or if the
// browser lacks sendBeacon (falls back to a keepalive fetch).
export function trackTickerInterest(symbol: string): void {
  try {
    if (typeof navigator === "undefined") return;
    const clean = String(symbol || "").trim().toUpperCase();
    if (!clean) return;

    const body = JSON.stringify({ symbol: clean });
    const url = "/api/track/ticker-interest";

    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(url, body);
    } else if (typeof fetch === "function") {
      // keepalive so it still sends if a navigation starts immediately after.
      void fetch(url, { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch {
    // Tracking must never break a user's navigation.
  }
}
