// THE MACRO SUPPORT ZONE, for pages other than the stock page (#563 COWORK #90:
// the SPX page's Price levels ladder and Price zones). A COPY, line for line, of
// StockSymbolPageClient.tsx's avg / aggregateWeekly / computeMacroSupport: the
// stock page keeps its own (a shared file this change doesn't edit), and
// scripts/check-spx-page.mjs lifts those functions and asserts this module
// returns exactly what they return on the same bars. Change both or neither.

export type MacroPoint = { date: string; close: number; high?: number; low?: number; volume?: number };
type Point = MacroPoint;
export type MacroSupportResult = {
  lower: number; upper: number; level: number; distancePct: number; touches: number; volumeRatio: number | null;
};

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function aggregateWeekly(points: Point[]): Point[] {
  const buckets = new Map<string, Point>();
  for (const point of points) {
    const date = new Date(`${point.date}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) continue;
    const day = date.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    date.setUTCDate(date.getUTCDate() + mondayOffset);
    const key = date.toISOString().slice(0, 10);
    const existing = buckets.get(key);
    const high = typeof point.high === "number" && Number.isFinite(point.high) ? point.high : point.close;
    const low = typeof point.low === "number" && Number.isFinite(point.low) ? point.low : point.close;
    const volume = typeof point.volume === "number" && Number.isFinite(point.volume) ? point.volume : 0;
    if (!existing) { buckets.set(key, { date: key, close: point.close, high, low, volume }); }
    else { buckets.set(key, { date: key, close: point.close, high: Math.max(existing.high ?? existing.close, high), low: Math.min(existing.low ?? existing.close, low), volume: (existing.volume ?? 0) + volume }); }
  }
  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function computeMacroSupport(points: Point[], lastClose: number | null): MacroSupportResult | null {
  if (typeof lastClose !== "number" || !Number.isFinite(lastClose) || lastClose <= 0) return null;
  const weekly = aggregateWeekly(points).slice(-156);
  if (weekly.length < 35) return null;
  type Pivot = { idx: number; price: number };
  const pivots: Pivot[] = [];
  const leftRight = 2;
  for (let i = leftRight; i < weekly.length - leftRight; i++) {
    const point = weekly[i];
    const low = typeof point.low === "number" ? point.low : point.close;
    if (!Number.isFinite(low)) continue;
    let isSwingLow = true;
    for (let offset = 1; offset <= leftRight; offset++) {
      const leftLow = weekly[i - offset].low ?? weekly[i - offset].close;
      const rightLow = weekly[i + offset].low ?? weekly[i + offset].close;
      if (low > leftLow || low > rightLow) { isSwingLow = false; break; }
    }
    if (isSwingLow && low > 0) pivots.push({ idx: i, price: low });
  }
  if (pivots.length < 2) return null;
  const maxZonePct = 5.5;
  const candidates: Array<MacroSupportResult & { score: number }> = [];
  for (const pivot of pivots) {
    const members = pivots.filter((candidate) => {
      const mid = (candidate.price + pivot.price) / 2;
      if (mid <= 0) return false;
      return Math.abs(((candidate.price - pivot.price) / mid) * 100) <= maxZonePct;
    });
    if (members.length < 2) continue;
    const prices = members.map((member) => member.price);
    const lower = Math.min(...prices), upper = Math.max(...prices), level = avg(prices);
    const zoneWidthPct = level > 0 ? ((upper - lower) / level) * 100 : 999;
    if (zoneWidthPct > maxZonePct) continue;
    const firstIdx = Math.min(...members.map((member) => member.idx));
    const lastIdx = Math.max(...members.map((member) => member.idx));
    const spanWeeks = lastIdx - firstIdx;
    if (spanWeeks < 8) continue;
    const distancePct = lastClose >= upper ? ((lastClose - upper) / lastClose) * 100 : 0;
    if (lastClose < lower * 0.97) continue;
    if (distancePct > 35) continue;
    const normalVolume = avg(weekly.slice(-52).map((week) => week.volume ?? 0).filter((volume) => volume > 0));
    const zoneVolumes = weekly.filter((week) => { const l = week.low ?? week.close; const h = week.high ?? week.close; return h >= lower && l <= upper; }).map((week) => week.volume ?? 0).filter((volume) => volume > 0);
    const volumeRatio = normalVolume > 0 && zoneVolumes.length ? avg(zoneVolumes) / normalVolume : null;
    const touchScore = Math.min(members.length / 5, 1) * 36;
    const proximityScore = Math.max(0, 1 - distancePct / 35) * 28;
    const spanScore = Math.min(spanWeeks / 80, 1) * 16;
    const tightnessScore = Math.max(0, 1 - zoneWidthPct / maxZonePct) * 12;
    const volumeScore = typeof volumeRatio === "number" ? Math.min(volumeRatio / 1.6, 1) * 8 : 2;
    candidates.push({ lower, upper, level, distancePct, touches: members.length, volumeRatio, score: touchScore + proximityScore + spanScore + tightnessScore + volumeScore });
  }
  return candidates.sort((a, b) => b.score - a.score || a.distancePct - b.distancePct)[0] ?? null;
}
