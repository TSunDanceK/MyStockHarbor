// CRYPTO MODE: HIDDEN 2026-09-27 (#553 COWORK #62).
//
// Hidden 2026-09-27: no licensed crypto source after FMP; the Tiingo licence
// covers stocks only (Schedule A: end-of-day stock prices, IEX intraday,
// consolidated intraday). Hide, don't delete: the toggle, CRYPTO_PRESETS, the
// static search pairs and the crypto benchmarks all stay in the code, and this
// one flag brings them back.
//
// While off: the dashboard renders no Stocks/Crypto toggle; searchSymbols
// returns no crypto rows; /api/benchmarks?scope=crypto, /api/quote and
// /api/history answer "not available" for a crypto pair WITHOUT calling FMP;
// /stock/<PAIR> shows a plain "not available" page.
//
// NEXT_PUBLIC_ so the client bundle sees the same value as the server (Next
// inlines it at build time). Anything but "1" is off.
//
// scripts/check-crypto-mode.mjs pins every place this is applied.
export const CRYPTO_MODE_ENABLED = process.env.NEXT_PUBLIC_CRYPTO_MODE_ENABLED === "1";

/**
 * A USD crypto pair as the dashboard spells it (BTCUSD). The same test
 * searchDemand uses to keep pairs out of search demand: ends in USD and at
 * least six characters. No listed US equity ticker is that shape.
 */
export function isCryptoPairSymbol(symbol: string): boolean {
  const s = String(symbol ?? "").trim().toUpperCase();
  return s.length >= 6 && /^[A-Z]+USD$/.test(s);
}

/** True when a crypto pair must not be fetched or shown. */
export function cryptoHidden(symbol: string): boolean {
  return !CRYPTO_MODE_ENABLED && isCryptoPairSymbol(symbol);
}
