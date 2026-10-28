// THE VALUATION CARD'S PRICE AND ITS BASIS (audit r3 item 5): what market cap
// and P/E use, with what it is, so the card can label it. The page title
// deliberately stays on the last completed close (owner ruling).
import type { PriceBasis } from "../priceBasis";
import type { SurfacePrice } from "./tiingoSurfacePrice";

export type EarningsPrice = { price: number; basis: PriceBasis };

/**
 * On Tiingo: readSurfacePrice's pick (the newer of the EOD close and today's
 * session IEX print). Otherwise: the newest bar of the FMP history, a close.
 */
export function earningsPrice(
  onTiingo: boolean,
  surface: SurfacePrice | null,
  lastBar: { date: string; close: number } | null
): EarningsPrice | null {
  if (onTiingo) {
    if (!surface) return null;
    return {
      price: surface.price,
      basis: { kind: surface.kind === "iex" ? "trade" : "close", date: surface.date, time: surface.kind === "iex" ? surface.time : null },
    };
  }
  if (!lastBar || typeof lastBar.close !== "number" || !Number.isFinite(lastBar.close) || !lastBar.date) return null;
  return { price: lastBar.close, basis: { kind: "close", date: lastBar.date, time: null } };
}
