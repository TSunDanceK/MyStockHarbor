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
// A SLOW FILL IS NOT A FAILED ONE (#552 COWORK #46, AXTI). The ceiling bounds
// the WAIT FOR THE REPLY, not the fill: AXTI's action logged "filled" ~12s in,
// just after the client had settled, and the page never looked again. So a
// hang, a throw, "queued", "busy" and another visitor's fill in flight now
// all mean POLL (coldFillPoll.ts) rather than a final sentence. Only BotID's
// "bot" verdict and the plain refusals end the sequence.
//
// PURE and import-free (type-only imports), so a check can run it against a
// hung and a rejected promise.
import type { ColdFillReply } from "./coldFillAction";

export type ColdFillPhase = "reading" | "slow" | "none" | "waiting";

export type ColdFillStep =
  | { kind: "phase"; phase: ColdFillPhase }
  /** The fill landed: soft-refresh and say so. */
  | { kind: "filled" }
  /** The fill may still be running (or another visitor's is): poll the store's status. */
  | { kind: "poll" };

/** The hard ceiling on the whole sequence, BotID's challenge included. */
export const COLD_FILL_SETTLE_MS = 12_000;


export const COLD_FILL_WORDS: Record<ColdFillPhase, string> = {
  reading: "Reading this company's SEC filings — this can take a few seconds.",
  slow: "This is taking longer than usual; figures will appear once the company's filings are read.",
  none: "SEC's data for this company has nothing this page can show yet.",
  waiting: "This company's SEC filings have not been read yet. They are read on a schedule, so figures may appear later.",
};

const POLL: ColdFillStep = { kind: "poll" };
const FALLBACK = POLL;

/** What one server reply means for the page. */
export function stepForReply(reply: ColdFillReply): ColdFillStep {
  if (reply.ok) {
    switch (reply.outcome) {
      case "filled": return { kind: "filled" };
      case "no-data": return { kind: "phase", phase: "none" };
      case "queued":
      case "busy": return POLL;
      default: return { kind: "phase", phase: "waiting" };
    }
  }
  if (reply.refused === "in-flight") return POLL;
  // A refused BotID verdict is the automation case: no fill is coming from it,
  // so the sentence, not a poll.
  if (reply.refused === "bot") return { kind: "phase", phase: "slow" };
  return { kind: "phase", phase: "waiting" };
}

/**
 * Ask once, and ALWAYS settle within `timeoutMs`: a reply maps through
 * stepForReply; a throw, a rejection or a hang is "poll" — the fill may be
 * running still, and the status poll is what finds out.
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
