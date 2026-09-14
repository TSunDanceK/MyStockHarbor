// The User-Agent the news adapters send, and the one rule that matters about it.
//
// ── WHY THIS FILE EXISTS: A HEADER WAS THE DIFFERENCE BETWEEN 183ms AND A HANG ─
// GlobeNewswire tarpits a request that arrives with no User-Agent. Not a 403,
// not a refusal, not a slow answer — the connection opens and is never
// answered. Measured from a Vercel function on 2026-09-14, round 1 of a 2x2
// (claude/wire-egress-verdict-2026-09-14.md):
//
//   cache mode          User-Agent   result
//   no-store            none         20,001ms, aborted, 0 bytes
//   next: revalidate    none         20,003ms, aborted, 0 bytes   <- the render
//   no-store            present         207ms, 200, 33,016 bytes
//   next: revalidate    present         183ms, 200, 33,031 bytes
//
// The header is the only variable that moves the result. `cause` was EMPTY on
// both aborts — no ECONNREFUSED, no ENOTFOUND, no UND_ERR_CONNECT_TIMEOUT —
// which is the signature of a tarpit rather than a block, and also why this cost
// two days to find: a promise that never settles never reaches a catch, never
// logs, and the per-feed `finally` never runs. THE FAILURE HAD NO OUTPUT AT ALL.
//
// ── THE RULE: THIS VALUE CAN NEVER BE EMPTY ────────────────────────────────
// That is the entire reason the constant is in the tree and the wire path reads
// NO ENVIRONMENT VARIABLE for it. An env-read is precisely the mechanism that
// can silently go missing — an unset or blank variable in one environment and
// the fetch goes out bare again, tarpits for the full adapter budget, logs
// nothing and throws nothing. The invisible failure would be back, and it would
// be back in the one place nobody would look, because the fix "is already
// shipped".
//
// If you are tempted to make the wire UA configurable: don't. There is no
// operational reason to vary it, and the cost of it being empty once is a
// silent five-second hole in every cold render.
//
// ── WHY SEC KEEPS ITS VARIABLE AND THE WIRES DO NOT ────────────────────────
// SEC_USER_AGENT exists for a different reason: sec.gov's fair-access policy
// asks for identification and the operator must be able to change the contact
// address it publishes without a deploy. That is a real requirement and it
// stays. What changes here is only the FALLBACK: instead of its own literal,
// secUserAgent() derives from the same constant, so there is one string to keep
// truthful rather than two that drift. The env var still wins where it is set,
// so nothing operational moves.
//
// Deliberate split, stated so the asymmetry does not read as an oversight:
//
//   wires    constant only, not overridable   emptiness is a silent outage
//   sec      env var, constant as fallback    the address is a published contact
//
// Neither can return "" — that is what the checker asserts.

/**
 * The exact string measured at 183ms/200 in cell D of the 2x2. Shipped
 * verbatim rather than tidied, because the measurement is only evidence for the
 * thing that was measured.
 *
 * It is honest identification, not a spoof: the real product, the real site,
 * and a real contact address a wire operator can write to. Nothing here
 * impersonates a browser. (Owner note: the contact address is the operator's
 * own; swapping it for a role address is a one-line change here and would want
 * a re-measure only in the sense that any change to a measured value does.)
 */
export const NEWS_USER_AGENT =
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; contact sonnybrindle@mystockharbor.com)";

/**
 * The wire feeds' User-Agent. No env read, by design — see the rule above.
 *
 * A function rather than the bare constant so every call site reads the same
 * way as secUserAgent() and so a future change has one place to happen.
 */
export function newsUserAgent(): string {
  return NEWS_USER_AGENT;
}

/**
 * data.sec.gov's User-Agent: the operator's variable when set, the shared
 * constant when not. `.trim()` before the `||` so that a variable set to spaces
 * — which is how an unset value usually arrives from a dashboard — falls
 * through to the constant instead of being sent as whitespace.
 */
export function secUserAgent(): string {
  return process.env.SEC_USER_AGENT?.trim() || NEWS_USER_AGENT;
}
