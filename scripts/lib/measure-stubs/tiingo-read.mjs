import { fixtureBars } from "./fixture-bars.mjs";
export const readTiingoHistory = async () => ({ asOf: "2026-10-02", fetchedAt: 0, basis: "split", bars: fixtureBars(560) });
export const readTiingoEodLast = async () => null;
export const readTiingoQuotes = async () => null;
export const POOL_CACHE_SECONDS = 3600, EOD_CACHE_SECONDS = 86400;
