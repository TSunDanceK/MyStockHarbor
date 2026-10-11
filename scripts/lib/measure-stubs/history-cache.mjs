import { fixtureBars } from "./fixture-bars.mjs";
const bars = fixtureBars(5600);
export const getDailyHistory = async () => bars.map(([date, open, high, low, close, volume]) => ({ date, open, high, low, close, volume }));
export const getDailyBars = getDailyHistory;
export const getHistoryRedisKey = (s) => `fixture:${s}`;
export const getCachedDailyHistory = getDailyHistory;
