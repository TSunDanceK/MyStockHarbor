// The one symbol normaliser for values that cross the server/client wire.
//
// Why this is a module rather than two matching functions
// -------------------------------------------------------
// /dashboard resolves its symbol on BOTH sides: the server reads `?symbol=`
// while rendering, and the client re-resolves it during hydration so an
// explicit URL wins over the remembered symbol without a flash (#296).
//
// Those two resolutions must agree on every input. Where they disagree the
// server renders one symbol and the client immediately renders another --
// which is the deep-link flash #296 exists to remove, coming back for a narrow
// set of inputs and therefore much harder to notice than the original bug.
//
// The two copies this replaces had already diverged once, before either
// shipped: the server STRIPPED disallowed characters ("NVDA!" -> "NVDA") while
// the first draft of the client copy REJECTED the whole string ("NVDA!" ->
// ""). Every ordinary ticker agreed; only punctuation exposed it. Both copies
// then carried a comment saying an edit to one must be made to the other,
// which is a warning rather than a guarantee -- it holds only for as long as
// whoever edits one happens to read it.
//
// One exported function with two call sites makes divergence impossible
// instead of discouraged. See claude/traps/two-validators-for-one-value.md.
//
// Deliberately in lib/ and NOT lib/server/: a "use client" module cannot
// import from lib/server, and the entire point is that both sides import the
// same thing.

// Accepts what each caller actually holds: a Next.js searchParams value
// (`string | string[]`) on the server, and a possibly-absent string
// (localStorage, a cookie, a URLSearchParams read) on the client. Taking both
// shapes here is what lets both sides share one implementation instead of
// wrapping two.
export type SymbolInput = string | string[] | null | undefined;

// STRIPS disallowed characters rather than rejecting the value, keeps the dot
// and hyphen that real tickers use (BRK.B, PBR-A), and upper-cases. Returns ""
// when nothing usable is left, which every caller already treats as "no symbol
// requested" and falls back from.
export function cleanSymbol(value: SymbolInput): string {
  const raw = Array.isArray(value) ? value[0] : value;

  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

// ---------------------------------------------------------------------------
// The remembered "last stock symbol"
// ---------------------------------------------------------------------------
//
// /dashboard renders whichever symbol the visitor was last looking at. That
// memory lived only in localStorage, which the SERVER cannot read -- so the
// server rendered SPY, the client hydrated to the remembered symbol, and all
// five server-fetched payloads were discarded and refetched. Observed live:
// three loads out of three.
//
// Mirroring the same value into a cookie lets the server resolve the symbol
// BEFORE rendering, so the HTML it sends is already the one the client wants.
// localStorage is still written and is still the fallback: it is the older of
// the two, several components read it directly, and a visitor who blocks
// cookies keeps exactly today's behaviour.

export const SYMBOL_COOKIE = "msh_sym";
export const SYMBOL_STORAGE_KEY = "msh_last_symbol";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Deliberately NOT HttpOnly: this cookie is written by client JS, so it cannot
// be. It mirrors a local preference the visitor set on this site -- a ticker
// they chose -- and holds no identifier, no account, and nothing that is not
// already in the URL of the page they came from. SameSite=Lax keeps it off
// cross-site requests; Secure is added on https so it never travels in the
// clear, while localhost development still works.
function writeSymbolCookie(symbol: string): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie =
      `${SYMBOL_COOKIE}=${encodeURIComponent(symbol)}` +
      `; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax${secure}`;
  } catch {
    /* Cookies blocked -- localStorage still carries the memory. */
  }
}

// A cookie is attacker-writable, so its value is normalised on the way out
// rather than trusted, and an undecodable escape returns "" instead of
// throwing.
function readSymbolCookie(): string {
  try {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${SYMBOL_COOKIE}=([^;]*)`)
    );
    return cleanSymbol(match ? decodeURIComponent(match[1]) : "");
  } catch {
    return "";
  }
}

function readStoredSymbol(): string {
  try {
    return cleanSymbol(window.localStorage.getItem(SYMBOL_STORAGE_KEY));
  } catch {
    return "";
  }
}

// Records an EXPLICIT choice. Writes both stores.
export function rememberSymbol(value: SymbolInput): void {
  const symbol = cleanSymbol(value);
  if (!symbol) return;
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SYMBOL_STORAGE_KEY, symbol);
  } catch {
    /* Safari private mode and friends -- the cookie below may still work. */
  }

  writeSymbolCookie(symbol);
}

// Reads the memory the way the SERVER will read it: cookie first, so a client
// seeding from this agrees with the HTML it was just sent. localStorage is the
// fallback for visitors who block cookies, and for the window between this
// shipping and their first cookie write.
export function readRememberedSymbol(): string {
  if (typeof window === "undefined") return "";
  return readSymbolCookie() || readStoredSymbol();
}

// One-time migration for a visitor who already had a remembered symbol before
// the cookie existed -- which is EVERY existing user, exactly once.
//
// Without this, #300 helps only visitors who pick a symbol after it ships, and
// for them the discard was never the problem: their first explicit choice
// writes the cookie anyway. A returning visitor would keep getting a
// server-rendered SPY and a client-rendered CAG on every single visit, forever,
// which is the discard the cookie exists to remove.
//
// THIS IS NOT THE LANDMINE, and the difference is the thing to understand
// before editing either:
//
//   The landmine writes a RENDER-DERIVED value -- `symbol`, which may be a
//   server default -- into the memory, and so can overwrite CAG with SPY and
//   destroy the thing it is meant to keep.
//
//   This writes an EXISTING REMEMBERED value into a second store. Same value,
//   different place. Nothing here is derived from what rendered.
//
// The guarantee is structural, not a matter of care: it writes ONLY when
// localStorage already holds something. Both stores empty -- a genuinely new
// visitor -- writes nothing, so a server default can never be pinned. #294's
// failure mode is unreachable by construction rather than merely avoided.
//
// The caller must also skip this when the URL carries an explicit ?symbol=, so
// a deep link's own write is never raced by a backfill of a different symbol.
//
// Returns the symbol it migrated, or "" if it did nothing.
export function backfillSymbolCookie(): string {
  if (typeof window === "undefined") return "";
  // Already migrated (or chosen since) -- nothing to do.
  if (readSymbolCookie()) return "";

  // The structural guarantee. No stored memory -> no write.
  const stored = readStoredSymbol();
  if (!stored) return "";

  writeSymbolCookie(stored);
  return stored;
}
