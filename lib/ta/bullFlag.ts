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

  flagUpperStartPrice: number;
  flagUpperEndPrice: number;
  flagLowerStartPrice: number;
  flagLowerEndPrice: number;
  flagAngleDeg: number;

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

function visualDownAngleDeg(args: {
  points: ReturnType<typeof normalisePoints>;
  startIdx: number;
  endIdx: number;
  startPrice: number;
  endPrice: number;
}) {
  const width = 420;
  const height = 170;
  const paddingX = 18;
  const paddingTop = 18;
  const paddingBottom = 24;

  const values = args.points
    .flatMap((point) => [point.high, point.low, point.close])
    .concat([args.startPrice, args.endPrice])
    .filter((value) => Number.isFinite(value));

  if (values.length < 2) return 0;

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const buffer = range * 0.12;

  const yMin = minValue - buffer;
  const yMax = maxValue + buffer;
  const yRange = yMax - yMin || 1;

  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingTop - paddingBottom;

  const x1 =
    paddingX +
    (args.startIdx / Math.max(1, args.points.length - 1)) * chartWidth;

  const x2 =
    paddingX +
    (args.endIdx / Math.max(1, args.points.length - 1)) * chartWidth;

  const y1 = paddingTop + ((yMax - args.startPrice) / yRange) * chartHeight;
  const y2 = paddingTop + ((yMax - args.endPrice) / yRange) * chartHeight;

  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx <= 0) return 0;

  return (Math.atan2(dy, dx) * 180) / Math.PI;
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
const minFlagBars =
  options.minFlagBars ?? (timeframe === "W" ? 8 : timeframe === "ST" ? 5 : 7);

const maxFlagBars = options.maxFlagBars ?? (timeframe === "W" ? 24 : 38);

const minPoleBars =
  options.minPoleBars ?? (timeframe === "W" ? 12 : timeframe === "ST" ? 8 : 12);
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
  const latestDateMs = new Date(latest.date).getTime();
const nowMs = Date.now();

const maxStaleDays = timeframe === "W" ? 21 : 7;

const maxStaleMs = maxStaleDays * 24 * 60 * 60 * 1000;

if (Number.isFinite(latestDateMs) && nowMs - latestDateMs > maxStaleMs) {
  return null;
}
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

    const flagHighs = flagPoints.map((point) => point.high);
    const flagLows = flagPoints.map((point) => point.low);

    const flagHigh = Math.max(...flagHighs);
    const flagLow = Math.min(...flagLows);
    const poleRange = poleHighPrice - poleStartPrice;

    if (poleRange <= 0) continue;

    const flagRetracementPct = ((poleHighPrice - flagLow) / poleRange) * 100;

    if (flagRetracementPct < minFlagRetracementPct) continue;
    if (flagRetracementPct > maxFlagRetracementPct) continue;

const channelWindow = Math.max(2, Math.floor(flagPoints.length * 0.35));

const earlyHighAvg = avg(flagHighs.slice(0, channelWindow));
const lateHighAvg = avg(flagHighs.slice(-channelWindow));

const earlyLowAvg = avg(flagLows.slice(0, channelWindow));
const lateLowAvg = avg(flagLows.slice(-channelWindow));

const flagDriftPct = pctDiff(earlyHighAvg, lateHighAvg);
const lowerFlagDriftPct = pctDiff(earlyLowAvg, lateLowAvg);

if (flagDriftPct > maxFlagUpDriftPct) continue;

if (flagDriftPct >= 0) continue;
if (lowerFlagDriftPct >= 0) continue;

const rawChannelWidthStart = earlyHighAvg - earlyLowAvg;
const rawChannelWidthEnd = lateHighAvg - lateLowAvg;
const rawAverageChannelWidth = (rawChannelWidthStart + rawChannelWidthEnd) / 2;

if (!Number.isFinite(rawAverageChannelWidth) || rawAverageChannelWidth <= 0) {
  continue;
}

const channelWidthOfPolePct = (rawAverageChannelWidth / poleRange) * 100;
const channelWidthOfPricePct = (rawAverageChannelWidth / latest.close) * 100;

const minChannelWidthOfPolePct =
  timeframe === "W" ? 12 : timeframe === "ST" ? 9 : 10;

const maxChannelWidthOfPolePct =
  timeframe === "W" ? 48 : timeframe === "ST" ? 42 : 45;

const minChannelWidthOfPricePct =
  timeframe === "W" ? 2.25 : timeframe === "ST" ? 1.4 : 1.6;

if (channelWidthOfPolePct < minChannelWidthOfPolePct) continue;
if (channelWidthOfPolePct > maxChannelWidthOfPolePct) continue;
if (channelWidthOfPricePct < minChannelWidthOfPricePct) continue;

const channelVisualPad = rawAverageChannelWidth * 0.18;

const channelUpperStartPrice = earlyHighAvg + channelVisualPad;
const channelUpperEndPrice = lateHighAvg + channelVisualPad;
const channelLowerStartPrice = earlyLowAvg - channelVisualPad;
const channelLowerEndPrice = lateLowAvg - channelVisualPad;

const flagStartIdxForAngle = poleHighIdx;
const flagEndIdxForAngle = points.length - 1;

const upperFlagAngleDeg = visualDownAngleDeg({
  points,
  startIdx: flagStartIdxForAngle,
  endIdx: flagEndIdxForAngle,
  startPrice: channelUpperStartPrice,
  endPrice: channelUpperEndPrice,
});

const lowerFlagAngleDeg = visualDownAngleDeg({
  points,
  startIdx: flagStartIdxForAngle,
  endIdx: flagEndIdxForAngle,
  startPrice: channelLowerStartPrice,
  endPrice: channelLowerEndPrice,
});

const minFlagAngleDeg = timeframe === "W" ? 11 : 12;
const maxFlagAngleDeg = timeframe === "W" ? 26 : 28;

if (upperFlagAngleDeg < minFlagAngleDeg) continue;
if (upperFlagAngleDeg > maxFlagAngleDeg) continue;
if (lowerFlagAngleDeg < minFlagAngleDeg) continue;
if (lowerFlagAngleDeg > maxFlagAngleDeg) continue;

const maxChannelAngleDifferenceDeg = timeframe === "W" ? 8 : 6;

if (
  Math.abs(upperFlagAngleDeg - lowerFlagAngleDeg) >
  maxChannelAngleDifferenceDeg
) {
  continue;
}

const maxCloseOutsideChannelPct = timeframe === "W" ? 2.2 : 1.35;
const maxWickOutsideChannelPct = timeframe === "W" ? 3.4 : 2.25;
const maxCloseOutsideBars = timeframe === "W" ? 2 : 1;
const maxWickOutsideBars = timeframe === "W" ? 2 : 1;

let closeOutsideChannelBars = 0;
let wickOutsideChannelBars = 0;

for (let i = 0; i < flagPoints.length; i++) {
  const point = flagPoints[i];
  const progress = i / Math.max(1, flagPoints.length - 1);

  const upperAtPoint =
    channelUpperStartPrice +
    (channelUpperEndPrice - channelUpperStartPrice) * progress;

  const lowerAtPoint =
    channelLowerStartPrice +
    (channelLowerEndPrice - channelLowerStartPrice) * progress;

  const closeAboveUpperPct = pctDiff(upperAtPoint, point.close);
  const closeBelowLowerPct = pctDiff(lowerAtPoint, point.close);

  const highAboveUpperPct = pctDiff(upperAtPoint, point.high);
  const lowBelowLowerPct = pctDiff(lowerAtPoint, point.low);

  if (
    closeAboveUpperPct > maxCloseOutsideChannelPct ||
    closeBelowLowerPct < -maxCloseOutsideChannelPct
  ) {
    closeOutsideChannelBars++;
  }

  if (
    highAboveUpperPct > maxWickOutsideChannelPct ||
    lowBelowLowerPct < -maxWickOutsideChannelPct
  ) {
    wickOutsideChannelBars++;
  }
}

if (closeOutsideChannelBars > maxCloseOutsideBars) continue;
if (wickOutsideChannelBars > maxWickOutsideBars) continue;

const flagAngleDeg = (upperFlagAngleDeg + lowerFlagAngleDeg) / 2;

const breakoutPrice = channelUpperEndPrice;
const distanceToBreakoutPct = pctDiff(latest.close, breakoutPrice);

const tightenedMaxDistanceToBreakoutPct =
  timeframe === "W"
    ? Math.min(maxDistanceToBreakoutPct, 5)
    : Math.min(maxDistanceToBreakoutPct, 3.5);

if (distanceToBreakoutPct > tightenedMaxDistanceToBreakoutPct) continue;
if (distanceToBreakoutPct < -maxBreakoutExtensionPct) continue;

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

      flagHigh: Number(breakoutPrice.toFixed(2)),
      flagLow: Number(flagLow.toFixed(2)),
      flagBars: points.length - poleHighIdx,
      poleBars,
      flagDriftPct: Number(flagDriftPct.toFixed(2)),

      flagUpperStartPrice: Number(channelUpperStartPrice.toFixed(2)),
      flagUpperEndPrice: Number(channelUpperEndPrice.toFixed(2)),
      flagLowerStartPrice: Number(channelLowerStartPrice.toFixed(2)),
      flagLowerEndPrice: Number(channelLowerEndPrice.toFixed(2)),
      flagAngleDeg: Number(flagAngleDeg.toFixed(2)),

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
