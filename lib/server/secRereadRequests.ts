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

/** At most this many requests are applied per run. */
export const SEC_REREAD_REQUESTS_PER_RUN = 1;

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
