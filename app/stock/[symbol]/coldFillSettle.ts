// HOW THE COLD-FILL CLIENT SETTLES (#535 COWORK #19 §1, #20).
//
// Production, 2026-09-23: an automated Chrome session sat on "Reading…"
// forever on /stock/WKHS/earnings. BotID's client wraps fetch, and for a
// browser it will not classify, its challenge never answered, so the server
// action's POST was never even sent and the awaited promise never settled.
// A real person's browser filled correctly; only the refused path hung.
//
// THE RULE: the client always settles. The whole sequence — BotID's challenge
// included, since it runs inside the action's fetch — races a hard timer, and
// a hang, a throw, or a bot refusal all land on the same fallback sentence.
//
// PURE and import-free (type-only imports), so a check can run it against a
// hung and a rejected promise.
import type { ColdFillReply } from "./coldFillAction";

export type ColdFillPhase = "reading" | "slow" | "none" | "waiting";

export type ColdFillStep =
  | { kind: "phase"; phase: ColdFillPhase }
  /** Re-render from the store, now or after `afterMs`; settle to "slow" if the page is still cold. */
  | { kind: "refresh"; afterMs: number };

/** The hard ceiling on the whole sequence, BotID's challenge included. */
export const COLD_FILL_SETTLE_MS = 12_000;

/** A second visitor while the first one's fill is running: look again after this. */
export const IN_FLIGHT_RETRY_MS = 6_000;

/** After a refresh, how long a still-cold page waits before showing the fallback. */
export const REFRESH_GRACE_MS = 6_000;

export const COLD_FILL_WORDS: Record<ColdFillPhase, string> = {
  reading: "Reading this company's SEC filings — this can take a few seconds.",
  slow: "This is taking longer than usual; figures will appear once the company's filings are read.",
  none: "SEC's data for this company has nothing this page can show yet.",
  waiting: "This company's SEC filings have not been read yet. They are read on a schedule, so figures may appear later.",
};

const FALLBACK: ColdFillStep = { kind: "phase", phase: "slow" };

/** What one server reply means for the page. */
export function stepForReply(reply: ColdFillReply): ColdFillStep {
  if (reply.ok) {
    switch (reply.outcome) {
      case "filled": return { kind: "refresh", afterMs: 0 };
      case "no-data": return { kind: "phase", phase: "none" };
      case "queued":
      case "busy": return FALLBACK;
      default: return { kind: "phase", phase: "waiting" };
    }
  }
  if (reply.refused === "in-flight") return { kind: "refresh", afterMs: IN_FLIGHT_RETRY_MS };
  // A refused BotID verdict is the automation case: the same fallback as a hang.
  if (reply.refused === "bot") return FALLBACK;
  return { kind: "phase", phase: "waiting" };
}

/**
 * Ask once, and ALWAYS settle within `timeoutMs`: a reply maps through
 * stepForReply; a throw, a rejection or a hang is the fallback.
 */
export function settleColdFill(
  call: () => Promise<ColdFillReply>,
  timeoutMs: number = COLD_FILL_SETTLE_MS,
): Promise<ColdFillStep> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (step: ColdFillStep) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(step);
    };
    const timer = setTimeout(() => finish(FALLBACK), timeoutMs);
    let pending: Promise<ColdFillReply>;
    try {
      pending = call();
    } catch {
      finish(FALLBACK);
      return;
    }
    Promise.resolve(pending).then(
      (reply) => {
        let step: ColdFillStep = FALLBACK;
        try { step = stepForReply(reply); } catch { /* a malformed reply is the fallback */ }
        finish(step);
      },
      () => finish(FALLBACK),
    );
  });
}
