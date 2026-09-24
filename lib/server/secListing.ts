// THE FOURTH DELISTING SIGNAL: SEC's own ticker file (Relay B, #553 COWORK #20).
//
// THE MISS. BK (renamed BNY), EQR (renamed VMRK), EA (delisted 2026-08-04, a
// Form 25-NSE) and WBS (delisted 2026-08-20) sat in the 700-symbol Pickers
// universe for weeks. The sweep in warm-screener-fundamentals has three signals
// and all three are FMP's:
//
//   ABSENCE       FMP's screener still listed them
//   FAIL STREAK   FMP's quote endpoint still answered for them
//   STALE BARS    63 trading days, and EA's last print is ~36 days old
//
// and the whole sweep skips when the screener read fails -- which is every day
// after FMP access ends on 14 October.
//
// THE SIGNAL. SEC's company_tickers_exchange file lists every ticker SEC maps to
// a registrant; a delisted or renamed ticker leaves it. It is already in Redis
// (sec-daily-index refreshes it weekly, secTickerMap validates it), so the
// check costs one GET a day and no network.
//
// MEASURED BEFORE IT ACTS (relay write-sec-delisting-census, 2026-09-24): of
// 760 universe symbols (Pickers 700, dynamic 697, preset 100, deduplicated),
// exactly four are absent from the live map -- BK, EA, EQR, WBS -- and nothing
// live is. The spelling helper is what keeps BRK.B / BRK-B from reading as
// absent.
//
// THREE GUARDS, because a wrong map would otherwise evict the universe:
//   1. Only the LIVE map (source "redis"). The committed file is a seed that
//      lags new listings, so a recent IPO is absent from it while alive.
//   2. Only a FRESH one (secTickerMap's own `stale`: over two refresh
//      intervals old).
//   3. A MASS ABSENCE IS THE MAP'S FAULT, NOT THE MARKET'S. validateTickerMap
//      accepts anything over 5,000 tickers with its sentinels, so a map
//      truncated to 6,000 would pass and name hundreds of live symbols. More
//      than SEC_UNLISTED_MAX (or 2% of the universe, whichever is larger) and
//      the pass refuses outright.
//
// A RENAME IS NOT DETECTED, ONLY SURFACED. No committed data keeps a
// ticker's former CIK (data/cik-map.json has BNY but not BK), so the
// successor cannot be found automatically; the route names every symbol this
// evicts, and a rename's successor is added by hand.
import { lookupBySpelling } from "../symbolSpellings.mjs";
import type { ResolvedTickerMap } from "./secTickerMap";

export const SEC_UNLISTED_MAX = 10;
export const SEC_UNLISTED_MAX_SHARE = 0.02;

export type SecListingVerdict = {
  /** Why the pass did nothing, or null when it ran. */
  skipped: "map-not-live" | "map-stale" | "map-empty" | "universe-empty" | "map-suspect" | null;
  /** Universe symbols SEC no longer lists (empty when skipped). */
  unlisted: string[];
};

type MapView = Pick<ResolvedTickerMap, "map" | "source" | "stale">;

/** Pure. Which universe symbols the live SEC map no longer lists, or why it will not say. */
export function secUnlistedSymbols(universe: string[], live: MapView): SecListingVerdict {
  if (live.source !== "redis") return { skipped: "map-not-live", unlisted: [] };
  if (live.stale) return { skipped: "map-stale", unlisted: [] };
  if (!live.map.size) return { skipped: "map-empty", unlisted: [] };
  const symbols = [...new Set(universe.map((s) => String(s ?? "").trim().toUpperCase()).filter(Boolean))];
  if (!symbols.length) return { skipped: "universe-empty", unlisted: [] };
  const unlisted = symbols.filter((s) => !lookupBySpelling(live.map, s));
  const cap = Math.max(SEC_UNLISTED_MAX, Math.ceil(symbols.length * SEC_UNLISTED_MAX_SHARE));
  if (unlisted.length > cap) return { skipped: "map-suspect", unlisted: [] };
  return { skipped: null, unlisted };
}
