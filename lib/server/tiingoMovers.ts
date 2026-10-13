// THE DASHBOARD TICKER'S MOVERS ON TIINGO (step 5, #553 COWORK #98 ruling 6).
//
// WHICH MOVER LISTS A READER SEES. The /api/market discovery rankings
// (topMovers / topTraded / topRanges, kept in msh:market:state) reach exactly
// one rendered place: the dashboard ticker's "XYZ ▲ 4.1% today" items, via the
// Pickers payload's tickerFeed.topMovers. Everywhere else they are only
// universe inputs (the four builders, the price-tier signal), never shown as
// movers. pricePool's three FMP mover buckets are never shown at all.
//
// So on PRICE_PROVIDER_POOL=tiingo the ticker's movers are computed here from
// the Tiingo universe (every symbol the nightly job stored), on the stored EOD
// move, and labelled "Last close · 1 Oct" -- the same basis and label as
// "Sector today" (ruling 4). The rows carry the % move only: no price and no
// volume, because the Pickers payload is stored outside msh:tiingo: and a
// computed % is ours to keep, a raw close is not (contract §7).
import { readTiingoEodLast } from "./marketData/read";
import { eodDayMove, lastCloseLabel, lastCloseRows, type EodLast } from "./marketData/eodLast";
import { isPriceExcluded } from "../priceExcluded.mjs";

export type TiingoMoverRow = {
  symbol: string;
  changePct: number;
  rangePct: null;
  last: null;
  volume: null;
  /** "Last close · 1 Oct" */
  label: string;
};

/** Pure. The biggest stored moves of the newest session, largest first. */
export function tiingoTickerMovers(eod: Record<string, EodLast>, limit: number): TiingoMoverRow[] {
  // The sector panels' own rule: the newest session only, never two mixed.
  const { date, rows: fresh } = lastCloseRows(Object.keys(eod), eod);
  const label = lastCloseLabel(date);
  if (!label) return [];
  const rows: TiingoMoverRow[] = [];
  for (const [symbol, r] of fresh) {
    const move = eodDayMove(r);
    if (move == null || isPriceExcluded(symbol)) continue;
    rows.push({ symbol, changePct: move, rangePct: null, last: null, volume: null, label });
  }
  return rows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, limit);
}

/** From the Data Cache (the same EOD blob the pool readers use). Null on a miss, so the caller keeps its FMP list. */
export async function readTiingoTickerMovers(limit: number): Promise<TiingoMoverRow[] | null> {
  const eod = await readTiingoEodLast().catch(() => null);
  if (!eod) return null;
  const rows = tiingoTickerMovers(eod, limit);
  return rows.length ? rows : null;
}
