// lib/ta/bullFlag.ts

export type PatternPoint = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type BullFlagTimeframe = "D" | "W";

export type BullFlagResult = {
  pattern: "bullFlag";
  timeframe: BullFlagTimeframe;
  score: number;
  tone: "green" | "yellow" | "orange" | "red";
  note: string;

  poleStartPrice: number;
  poleHighPrice: number;
  latestClose: number;

  poleGainPct: number;
  flagRetracementPct: number;
  distanceToBreakoutPct: number;

  flagHigh: number;
  flagLow: number;
  flagBars: number;
  poleBars: number;
  flagDriftPct: number;

  poleStartDate: string;
  poleHighDate: string;
  flagStartDate: string;
  startDate: string;
  endDate: string;
};

type DetectOptions = {
  timeframe?: BullFlagTimeframe;
  lookbackBars?: number;
  minPoleGainPct?: number;
  minFlagBars?: number;
  maxFlagBars?: number;
  minPoleBars?: number;
  maxPoleBars?: number;
  minFlagRetracementPct?: number;
  maxFlagRetracementPct?: number;
  maxDistanceToBreakoutPct?: number;
  maxFlagUpDriftPct?: number;
  maxBreakoutExtensionPct?: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pctDiff(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return 0;
  return ((to - from) / from) * 100;
}

function normalisePoints(points: PatternPoint[]) {
  return points
    .map((point) => ({
      date: String(point.date ?? ""),
      close: Number(point.close),
      high: isFiniteNumber(point.high) ? point.high : Number(point.close),
      low: isFiniteNumber(point.low) ? point.low : Number(point.close),
      volume: isFiniteNumber(point.volume) ? point.volume : undefined,
    }))
    .filter(
      (point) =>
        point.date &&
        Number.isFinite(point.close) &&
        Number.isFinite(point.high) &&
        Number.isFinite(point.low)
    );
}

function volumeCompressionScore(points: ReturnType<typeof normalisePoints>) {
  const volumePoints = points
    .map((point) => point.volume)
    .filter((volume): volume is number => Number.isFinite(volume));

  if (volumePoints.length < 12) return 0;

  const midpoint = Math.max(1, Math.floor(volumePoints.length / 2));
  const prior = volumePoints.slice(0, midpoint);
  const recent = volumePoints.slice(midpoint);

  const priorAvg = avg(prior);
  const recentAvg = avg(recent);

  if (priorAvg <= 0) return 0;

  const compressionPct = pctDiff(priorAvg, recentAvg);

  if (compressionPct <= -28) return 6;
  if (compressionPct <= -18) return 5;
  if (compressionPct <= -10) return 3;

  return 0;
}

function highAt(points: ReturnType<typeof normalisePoints>, index: number) {
  return points[index]?.high ?? points[index]?.close ?? 0;
}

function lowAt(points: ReturnType<typeof normalisePoints>, index: number) {
  return points[index]?.low ?? points[index]?.close ?? 0;
}

export function detectBullFlag(
  rawPoints: PatternPoint[],
  options: DetectOptions = {}
): BullFlagResult | null {
  const timeframe = options.timeframe ?? "D";

  const lookbackBars = options.lookbackBars ?? (timeframe === "W" ? 104 : 160);
  const minPoleGainPct = options.minPoleGainPct ?? (timeframe === "W" ? 12 : 9);
  const minFlagBars = options.minFlagBars ?? (timeframe === "W" ? 3 : 5);
  const maxFlagBars = options.maxFlagBars ?? (timeframe === "W" ? 24 : 38);
  const minPoleBars = options.minPoleBars ?? (timeframe === "W" ? 3 : 5);
  const maxPoleBars = options.maxPoleBars ?? (timeframe === "W" ? 34 : 55);
  const minFlagRetracementPct = options.minFlagRetracementPct ?? 2;
  const maxFlagRetracementPct =
    options.maxFlagRetracementPct ?? (timeframe === "W" ? 58 : 52);
  const maxDistanceToBreakoutPct =
    options.maxDistanceToBreakoutPct ?? (timeframe === "W" ? 16 : 10);
  const maxFlagUpDriftPct = options.maxFlagUpDriftPct ?? (timeframe === "W" ? 7 : 5);
  const maxBreakoutExtensionPct =
    options.maxBreakoutExtensionPct ?? (timeframe === "W" ? 10 : 7);

  const points = normalisePoints(rawPoints).slice(-lookbackBars);

  if (points.length < minPoleBars + minFlagBars + 5) {
    return null;
  }

  const latest = points[points.length - 1];
  let best: BullFlagResult | null = null;

  const maxUsableFlagBars = Math.min(maxFlagBars, points.length - minPoleBars - 2);

  for (let flagBars = minFlagBars; flagBars <= maxUsableFlagBars; flagBars++) {
    const flagStartIdx = points.length - flagBars;
    const poleSearchStartIdx = Math.max(0, flagStartIdx - maxPoleBars);
    const poleSearch = points.slice(poleSearchStartIdx, flagStartIdx + 1);

    if (poleSearch.length < minPoleBars) continue;

    let poleStartRelativeIdx = 0;
    let poleStartPrice = Number.POSITIVE_INFINITY;

    for (let i = 0; i < poleSearch.length; i++) {
      const low = lowAt(poleSearch, i);
      if (low < poleStartPrice) {
        poleStartPrice = low;
        poleStartRelativeIdx = i;
      }
    }

    const poleStartIdx = poleSearchStartIdx + poleStartRelativeIdx;

    if (flagStartIdx - poleStartIdx < minPoleBars) continue;

    let poleHighIdx = poleStartIdx;
    let poleHighPrice = highAt(points, poleStartIdx);

    for (let i = poleStartIdx + 1; i <= flagStartIdx; i++) {
      const high = highAt(points, i);
      if (high > poleHighPrice) {
        poleHighPrice = high;
        poleHighIdx = i;
      }
    }

    const poleBars = poleHighIdx - poleStartIdx;

    if (poleBars < minPoleBars || poleBars > maxPoleBars) continue;
    if (poleHighIdx < flagStartIdx - 3 && timeframe === "D") continue;

    const poleGainPct = pctDiff(poleStartPrice, poleHighPrice);
    if (poleGainPct < minPoleGainPct) continue;

    const flagPoints = points.slice(poleHighIdx, points.length);
    if (flagPoints.length < minFlagBars) continue;

    const flagHighBeforeLatest = Math.max(
      ...flagPoints.slice(0, Math.max(1, flagPoints.length - 1)).map((point) => point.high)
    );

    const flagHigh = Math.max(flagHighBeforeLatest, poleHighPrice);
    const flagLow = Math.min(...flagPoints.map((point) => point.low));
    const poleRange = poleHighPrice - poleStartPrice;

    if (poleRange <= 0) continue;

    const flagRetracementPct = ((poleHighPrice - flagLow) / poleRange) * 100;

    if (flagRetracementPct < minFlagRetracementPct) continue;
    if (flagRetracementPct > maxFlagRetracementPct) continue;

    const distanceToBreakoutPct = pctDiff(latest.close, flagHighBeforeLatest);

    if (distanceToBreakoutPct > maxDistanceToBreakoutPct) continue;
    if (distanceToBreakoutPct < -maxBreakoutExtensionPct) continue;

    const flagHighs = flagPoints.map((point) => point.high);
    const split = Math.max(1, Math.floor(flagHighs.length / 2));
    const earlyHighAvg = avg(flagHighs.slice(0, split));
    const lateHighAvg = avg(flagHighs.slice(split));
    const flagDriftPct = pctDiff(earlyHighAvg, lateHighAvg);

    if (flagDriftPct > maxFlagUpDriftPct) continue;

    const poleScore = clamp((poleGainPct - minPoleGainPct) * 1.15 + 18, 0, 28);
    const retracementScore = clamp(28 - Math.abs(flagRetracementPct - 32) * 0.62, 0, 26);
    const proximityScore = clamp(18 - Math.max(0, distanceToBreakoutPct) * 0.85, 0, 18);
    const durationScore = clamp(
      timeframe === "W"
        ? flagBars >= 5 && flagBars <= 18
          ? 13
          : 9
        : flagBars >= 7 && flagBars <= 28
          ? 13
          : 9,
      0,
      13
    );
    const driftScore = clamp(9 - Math.max(0, flagDriftPct) * 0.9, 0, 9);
    const volumeScore = volumeCompressionScore(flagPoints);
    const timeframeBonus = timeframe === "W" ? 4 : 0;

    const score = Math.round(
      clamp(
        poleScore +
          retracementScore +
          proximityScore +
          durationScore +
          driftScore +
          volumeScore +
          timeframeBonus,
        0,
        100
      )
    );

    const minScore = timeframe === "W" ? 48 : 50;
    if (score < minScore) continue;

    const tone =
      score >= 75 ? "green" : score >= 62 ? "yellow" : score >= 50 ? "orange" : "red";

    const note =
      timeframe === "W"
        ? `Weekly bull flag candidate: ${poleGainPct.toFixed(1)}% pole move, ${flagRetracementPct.toFixed(1)}% retracement, ${distanceToBreakoutPct.toFixed(1)}% below breakout area.`
        : `Daily bull flag candidate: ${poleGainPct.toFixed(1)}% pole move, ${flagRetracementPct.toFixed(1)}% retracement, ${distanceToBreakoutPct.toFixed(1)}% below breakout area.`;

    const candidate: BullFlagResult = {
      pattern: "bullFlag",
      timeframe,
      score,
      tone,
      note,

      poleStartPrice: Number(poleStartPrice.toFixed(2)),
      poleHighPrice: Number(poleHighPrice.toFixed(2)),
      latestClose: Number(latest.close.toFixed(2)),

      poleGainPct: Number(poleGainPct.toFixed(2)),
      flagRetracementPct: Number(flagRetracementPct.toFixed(2)),
      distanceToBreakoutPct: Number(distanceToBreakoutPct.toFixed(2)),

      flagHigh: Number(flagHighBeforeLatest.toFixed(2)),
      flagLow: Number(flagLow.toFixed(2)),
      flagBars: points.length - poleHighIdx,
      poleBars,
      flagDriftPct: Number(flagDriftPct.toFixed(2)),

      poleStartDate: points[poleStartIdx].date,
      poleHighDate: points[poleHighIdx].date,
      flagStartDate: points[poleHighIdx].date,
      startDate: points[poleStartIdx].date,
      endDate: latest.date,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}
