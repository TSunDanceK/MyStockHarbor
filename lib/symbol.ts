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
// instead of discouraged. See claude/silent-failure-traps.md #5.
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
