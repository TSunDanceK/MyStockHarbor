// Every Redis key that holds Tiingo data, in one place (#553 COWORK #56/#57).
//
// ONE PREFIX, msh:tiingo:, ON PURPOSE. The contract's §7 says all raw Tiingo
// data is deleted on termination, with written certification. A single prefix
// makes that one SCAN (scripts/tiingo-purge.mjs), and
// scripts/check-tiingo-step1.mjs fails if a key here leaves it.
//
// SEPARATE FROM THE FMP KEYS until a surface is switched. Step 1 writes these
// and no page reads them; PRICE_PROVIDER_<SURFACE> (provider.ts) decides, per
// surface, when one does.
export const TIINGO_PREFIX = "msh:tiingo:";

/** Hash: field = our dashed symbol, value = JSON quote row; field "_meta" = run stamp. */
export const TIINGO_QUOTES_KEY = `${TIINGO_PREFIX}quotes:v1`;
export const TIINGO_QUOTES_META_FIELD = "_meta";
/** Outlives a long weekend, and lapses on its own if the job stops. */
export const TIINGO_QUOTES_TTL_SECONDS = 4 * 24 * 60 * 60;

/**
 * String per symbol: JSON { asOf, fetchedAt, basis, bars }.
 *
 * v2 = PRICE BASIS B, split-adjusted only (#553 COWORK #60). v1 held Tiingo's
 * dividend-adjusted closes. A new version rather than an overwrite, so the two
 * bases never sit side by side for a symbol that failed one night; the v1 keys
 * lapse on their own 8-day TTL, and the purge covers both (same prefix).
 */
export const tiingoEodKey = (symbol: string) => `${TIINGO_PREFIX}eod:v2:${symbol}`;
/**
 * String: JSON { asOf, at, symbols, written, failed } for the last complete
 * night. Versioned WITH the history keys: a v1 stamp for a date must not tell
 * the v2 job that night is already done.
 */
export const TIINGO_EOD_META_KEY = `${TIINGO_PREFIX}eod-meta:v2`;
/** Re-written every weeknight; a week's lapse ages it out rather than serving it. */
export const TIINGO_EOD_TTL_SECONDS = 8 * 24 * 60 * 60;

/** Data Cache tags (COWORK #56 §3, #57 §3). */
export const PRICES_TAG = "prices";
export const EOD_TAG = "eod";
export const eodSymbolTag = (symbol: string) => `eod:${symbol}`;
