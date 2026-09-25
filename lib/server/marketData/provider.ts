// WHICH PROVIDER EACH PRICE SURFACE READS (#553 COWORK #55 §2).
//
// One env var per surface, PRICE_PROVIDER_<SURFACE>, "fmp" or "tiingo". Anything
// else, including unset, is fmp: a typo keeps the surface on the provider that
// is known to work. FMP stays each surface's fallback until that surface is
// verified on Tiingo (COWORK #56, failure behaviour), so switching back is an
// env change and a redeploy, not a code change.
//
// Step 1 ships this switch with every surface on fmp and no caller reading it
// yet: backend only, no page switches (COWORK #55).
export const PRICE_SURFACES = ["POOL", "HISTORY", "CHARTS", "PICKERS", "STOCK_PAGE"] as const;
export type PriceSurface = (typeof PRICE_SURFACES)[number];
export type PriceProvider = "fmp" | "tiingo";

export function priceProviderFor(
  surface: PriceSurface,
  env: Record<string, string | undefined> = process.env
): PriceProvider {
  return String(env[`PRICE_PROVIDER_${surface}`] ?? "").trim().toLowerCase() === "tiingo" ? "tiingo" : "fmp";
}
