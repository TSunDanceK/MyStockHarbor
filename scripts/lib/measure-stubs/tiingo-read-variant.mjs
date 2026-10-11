// The Tiingo read stub with a swappable series (scripts/measure-spx-layout.mjs):
// globalThis.__SPX_BARS, when set, replaces the default fixture bars, so one
// process can render the SPX page for several weeks' shapes.
import { fixtureBars } from "./fixture-bars.mjs";
export const readTiingoHistory = async () => ({ asOf: "2026-10-02", fetchedAt: 0, basis: "split", bars: globalThis.__SPX_BARS ?? fixtureBars(560) });
export const readTiingoEodLast = async () => null;
export const readTiingoQuotes = async () => null;
export const POOL_CACHE_SECONDS = 3600, EOD_CACHE_SECONDS = 86400;
