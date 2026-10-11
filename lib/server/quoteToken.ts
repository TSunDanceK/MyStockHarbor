import { createHmac, timingSafeEqual } from "crypto";

/**
 * Short-lived, HMAC-signed page tokens for /api/quote.
 *
 * WHY: BotID (lib/botid-guard.ts) answers "is this client a real browser?".
 * It does NOT answer "did this request come from someone actually looking at
 * one of our pages?". A client that passes BotID can still walk
 * /api/quote?symbol=... ticker by ticker forever, which is exactly the
 * scripted-API-walk pattern the 2026-07-21 firewall audit found
 * (claude/firewall-allowed-bot-scraping-audit-2026-07-21.md). A page token
 * closes that: the value is minted server-side while rendering a real page
 * and handed to the client component, so a caller has to load a page first
 * and re-load it once the token ages out.
 *
 * ── Scope: session, NOT per-symbol ──────────────────────────────────────
 * The obvious design is to bind the token to the requested symbol. That
 * breaks the dashboard. app/components/DashboardClient.tsx keeps `symbol` in
 * client state and chooseSymbol() swaps it without a page reload, so a
 * symbol-bound token minted at render would only ever match the FIRST symbol
 * and every subsequent ticker the visitor picked would fail. /stock/[symbol]
 * could take symbol-bound tokens (its symbol is fixed per page), but running
 * two different token shapes across two call sites is worse than one.
 * So: the token proves "a real page was rendered for this visitor recently",
 * bounded by TTL. Tightening to per-symbol needs a mint/refresh endpoint
 * first -- see the follow-ups in the PR description.
 *
 * ── Honest limits ───────────────────────────────────────────────────────
 * The token travels in the page's serialized props, so it IS readable by
 * anything that fetches the HTML. That is inherent (same as any CSRF token)
 * and is not a flaw in the scheme -- the cost being imposed is "you must
 * render a page, and re-render it every TTL", not "you can never get a
 * token". This is a speed bump plus a much clearer traffic signal, not a
 * wall. It is most effective against the bare node/Go-http-client callers
 * the firewall rules already target, and least effective against a full
 * headless browser.
 *
 * ── Safety: this file blocks nobody by default ──────────────────────────
 * Deliberately mirrors how BotID was rolled out (instrumentation-client.ts:
 * "A path listed here does NOTHING until a matching server-side guard is
 * added"). Two independent off-switches, both default-off:
 *   - QUOTE_TOKEN_SECRET unset  -> verification is skipped entirely.
 *   - QUOTE_TOKEN_ENFORCE != "1" -> failures are logged, never blocked.
 * Merging and deploying this with no env vars set is a no-op. Set the
 * secret first, read the logs, and only then flip enforcement -- the log
 * line tells you how often real visitors would have been rejected and what
 * TTL is actually safe.
 *
 * ── Why in-process callers are unaffected ───────────────────────────────
 * Verification lives in app/api/quote/route.ts, the HTTP entry point only.
 * The server-side readers (app/dashboard/page.tsx, lib/insightSnapshots.ts,
 * lib/videoStockData.ts) call fetchQuoteSnapshot() in-process and never
 * touch the route, so they cannot be self-blocked by this. That is the same
 * property that kept them safe when BotID landed, and it is the specific
 * failure mode documented in
 * claude/pickers-firewall-selfblock-2026-07-17.md.
 */

/** Request header the browser sends the minted token back on. */
export const QUOTE_TOKEN_HEADER = "x-msh-page-token";

/** Default lifetime. Deliberately generous for the log-only pilot: long
 *  enough to cover a lengthy dashboard session so the logs measure genuine
 *  failures rather than ordinary session length. Lower it once a refresh
 *  endpoint exists. */
const DEFAULT_TTL_SECONDS = 1800;

// Read env per call rather than at module load so a Vercel env change takes
// effect on the next cold start without needing a code change.
function secret(): string {
  return process.env.QUOTE_TOKEN_SECRET ?? "";
}

function ttlSeconds(): number {
  const raw = Number(process.env.QUOTE_TOKEN_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_SECONDS;
}

/** True only when a secret is set AND enforcement is explicitly enabled. */
export function isQuoteTokenEnforced(): boolean {
  return process.env.QUOTE_TOKEN_ENFORCE === "1" && secret().length > 0;
}

/**
 * Mint a token in a server component. Returns "" when no secret is
 * configured, which the client treats as "send no header" -- so an
 * unconfigured deploy behaves exactly as it does today.
 */
export function mintQuoteToken(): string {
  const key = secret();
  if (!key) return "";
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds();
  const payload = String(expiresAt);
  const sig = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export type QuoteTokenReason =
  | "valid"
  | "not_configured"
  | "missing"
  | "malformed"
  | "bad_signature"
  | "expired";

export type QuoteTokenResult = { ok: boolean; reason: QuoteTokenReason };

/**
 * Verify a token presented on an inbound request.
 *
 * Returns ok:true with reason "not_configured" when no secret is set, so
 * callers can treat "not configured" and "valid" identically and this can
 * never fail closed by accident.
 */
export function verifyQuoteToken(token: string | null | undefined): QuoteTokenResult {
  const key = secret();
  if (!key) return { ok: true, reason: "not_configured" };
  if (!token) return { ok: false, reason: "missing" };

  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: "malformed" };
  }

  const payload = token.slice(0, dot);
  const presented = token.slice(dot + 1);
  const expected = createHmac("sha256", key).update(payload).digest("base64url");

  // Compare before parsing the payload so an attacker cannot learn anything
  // from differing error shapes, and use a length-guarded timing-safe compare
  // (timingSafeEqual throws on length mismatch).
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "malformed" };
  if (Math.floor(Date.now() / 1000) > expiresAt) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, reason: "valid" };
}
