// A RE-READ REQUEST, COMMITTED RATHER THAN CALLED (#552 COWORK #30).
//
// The sec-facts job has a manual `?symbol=` mode, but it needs the job's
// secret, and handing a secret around to refresh one page is the wrong trade.
// The cron's own reverify queue is the existing mechanism; this is how a code
// change puts a symbol on it.
//
// ONE-SHOT BY CONSTRUCTION. A request applies only while the symbol's
// manifest `verifiedAt` is older than `requestedAt`. The cron stamps
// verifiedAt when a re-read succeeds, so the request retires itself; a stale
// entry left in the file does nothing. A FAILED re-read leaves needsReverify
// set in the manifest, so the ordinary queue retries it -- no request needed.
//
// CAPPED at SEC_REREAD_REQUESTS_PER_RUN, so a long list can never crowd the
// daily queues. PURE: the job passes in the manifest, the list and the clock.
// Redis cost: none -- the manifest is already read and written once per run.
import requestsFile from "@/data/sec/reread-requests.json";
import type { SecManifest } from "./secManifest";

export type RereadRequest = { symbol: string; requestedAt: string; reason: string };

export const SEC_REREAD_REQUESTS = requestsFile.requests as RereadRequest[];

/**
 * At most this many requests are applied per run. 60 since 2026-10-23 (owner
 * ruling, after two clean runs at 12 on 22 Oct), so a 150-entry batch drains
 * in about three runs instead of a dozen. Still under half of what the
 * reverify queue takes a run (SEC_REVERIFY_PER_RUN, 150), and the job's time
 * budget still defers whatever a run cannot reach. Was 12 (#552 COWORK #31).
 */
export const SEC_REREAD_REQUESTS_PER_RUN = 60;

/**
 * Flag the requested symbols for re-read in the (in-memory) manifest, and
 * return which were flagged. The job writes the manifest back as it always does.
 */
export function applyRereadRequests(
  manifest: SecManifest,
  requests: RereadRequest[],
  nowMs: number,
  cap = SEC_REREAD_REQUESTS_PER_RUN,
): string[] {
  const applied: string[] = [];
  for (const r of requests) {
    if (applied.length >= cap) break;
    const at = Date.parse(r.requestedAt);
    const entry = manifest.symbols[String(r.symbol).toUpperCase()];
    if (!Number.isFinite(at) || at > nowMs || !entry?.cik) continue;
    if (entry.needsReverify) continue;
    if ((entry.verifiedAt ?? 0) >= at) continue;
    entry.needsReverify = true;
    entry.reverifyReason = "requested";
    entry.enqueuedAt = nowMs;
    applied.push(String(r.symbol).toUpperCase());
  }
  return applied;
}

/** A request held open longer than this is listed for the check-in (#552 COWORK #222). */
export const SEC_HELD_OPEN_LIST_DAYS = 14;

export type HeldOpenRequest = {
  symbol: string;
  requestedAt: string;
  /** When the job began keeping the prior over a lagging feed (ms). */
  keptSince: number;
  days: number;
  /** companyfacts' newest period end on the last pass, against the filed one. */
  feedEnd: string | null;
  ff: string | null;
};

/**
 * THE REQUESTS A LAGGING FEED IS HOLDING OPEN (#552 COWORK #222).
 *
 * A pass that keeps the stored set (keepFilled / keepForFx) no longer stamps
 * verifiedAt, so its request stays open until companyfacts carries the filled
 * period. That is meant to be brief. This lists any request still open whose
 * symbol has been held for more than `days` (C's feed already ended at FY2025
 * when this shipped), so a feed that never catches up is seen rather than
 * re-read quietly forever. PURE: the manifest, the list and the clock.
 */
export function heldOpenRequests(
  manifest: SecManifest,
  requests: RereadRequest[],
  nowMs: number,
  days = SEC_HELD_OPEN_LIST_DAYS,
): HeldOpenRequest[] {
  const out = new Map<string, HeldOpenRequest>();
  for (const r of requests) {
    const symbol = String(r.symbol).toUpperCase();
    const entry = manifest.symbols[symbol];
    const kept = entry?.keptOpen;
    const at = Date.parse(r.requestedAt);
    if (!kept || !Number.isFinite(at) || (entry.verifiedAt ?? 0) >= at) continue;
    const held = (nowMs - kept.since) / 86_400_000;
    if (held <= days) continue;
    out.set(symbol, { symbol, requestedAt: r.requestedAt, keptSince: kept.since, days: Math.floor(held), feedEnd: kept.feedEnd, ff: kept.ff });
  }
  return [...out.values()];
}
