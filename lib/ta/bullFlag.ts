// lib/ta/bullFlag.ts

export type PatternPoint = {
  date: string;
  open?: number;
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
    .map((point) => {
      const close = Number(point.close);
      const open = isFiniteNumber(point.open) ? point.open : close;

      return {
        date: String(point.date ?? ""),
        open,
        close,
        high: isFiniteNumber(point.high) ? point.high : close,
        low: isFiniteNumber(point.low) ? point.low : close,
        volume: isFiniteNumber(point.volume) ? point.volume : undefined,
      };
    })
    .filter(
      (point) =>
        point.date &&
        Number.isFinite(point.open) &&
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

type FlagLineFit = {
  valueAtStart: number;
  valueAtEnd: number;
  slopePerBar: number;
  touchCount: number;
};

/**
 * Fits one boundary of the flag channel as a true envelope line.
 *
 * For the upper boundary ("upper"), the fitted line must stay at or above
 * every flag-bar high (small tolerance); for the lower boundary ("lower"),
 * at or below every flag-bar low. Both boundaries of a bull flag must slope
 * downward. This replaces the old averaged channel (which routinely cut
 * through candles) with lines that actually sit on the candle extremes.
 *
 * Among valid lines, prefers the one the price touched most, then the
 * longest anchor span.
 */
function fitFlagEnvelope(args: {
  values: number[];
  side: "upper" | "lower";
  envelopeTolPct: number;
  touchTolPct: number;
  minTouches: number;
  minAnchorSeparationBars: number;
}): FlagLineFit | null {
  const {
    values,
    side,
    envelopeTolPct,
    touchTolPct,
    minTouches,
    minAnchorSeparationBars,
  } = args;

  const barCount = values.length;

  if (barCount < 3) return null;

  const lastIdx = barCount - 1;

  let best: FlagLineFit | null = null;
  let bestSpan = 0;

  for (let i = 0; i < barCount; i++) {
    for (let j = i + minAnchorSeparationBars; j < barCount; j++) {
      // Flag channels slope down: the later anchor must be lower.
      if (values[j] >= values[i]) continue;

      const slopePerBar = (values[j] - values[i]) / (j - i);

      const lineValueAt = (idx: number) =>
        values[i] + slopePerBar * (idx - i);

      let isEnvelope = true;

      for (let k = 0; k < barCount; k++) {
        const lineValue = lineValueAt(k);

        if (lineValue <= 0) {
          isEnvelope = false;
          break;
        }

        if (
          side === "upper" &&
          values[k] > lineValue * (1 + envelopeTolPct / 100)
        ) {
          isEnvelope = false;
          break;
        }

        if (
          side === "lower" &&
          values[k] < lineValue * (1 - envelopeTolPct / 100)
        ) {
          isEnvelope = false;
          break;
        }
      }

      if (!isEnvelope) continue;

      let touchCount = 0;
      let lastTouchIdx = -Infinity;

      for (let k = 0; k < barCount; k++) {
        const lineValue = lineValueAt(k);

        const touches =
          side === "upper"
            ? values[k] >= lineValue * (1 - touchTolPct / 100)
            : values[k] <= lineValue * (1 + touchTolPct / 100);

        if (touches && k - lastTouchIdx >= 2) {
          touchCount++;
          lastTouchIdx = k;
        }
      }

      if (touchCount < minTouches) continue;

      const span = j - i;

      if (
        !best ||
        touchCount > best.touchCount ||
        (touchCount === best.touchCount && span > bestSpan)
      ) {
        best = {
          valueAtStart: lineValueAt(0),
          valueAtEnd: lineValueAt(lastIdx),
          slopePerBar,
          touchCount,
        };
        bestSpan = span;
      }
    }
  }

  return best;
}

export function detectBullFlag(
  rawPoints: PatternPoint[],
  options: DetectOptions = {}
): BullFlagResult | null {
  const timeframe = options.timeframe ?? "D";

  const lookbackBars = options.lookbackBars ?? (timeframe === "W" ? 104 : 160);
  const minPoleGainPct = options.minPoleGainPct ?? (timeframe === "W" ? 12 : 9);
  const minFlagBars = options.minFlagBars ?? (timeframe === "W" ? 8 : 7);

  const maxFlagBars = options.maxFlagBars ?? (timeframe === "W" ? 24 : 38);

  const minPoleBars = options.minPoleBars ?? (timeframe === "W" ? 12 : 12);
  const maxPoleBars = options.maxPoleBars ?? (timeframe === "W" ? 34 : 55);

  // A real flag has to give back a meaningful part of the pole: floor the
  // minimum retracement at 12% (the old default of 2% let sideways drifts
  // that never pulled back qualify as "flags").
  const minFlagRetracementPct = Math.max(
    options.minFlagRetracementPct ?? 12,
    12
  );

  const maxFlagRetracementPct =
    options.maxFlagRetracementPct ?? (timeframe === "W" ? 55 : 50);
  const maxDistanceToBreakoutPct =
    options.maxDistanceToBreakoutPct ?? (timeframe === "W" ? 16 : 10);
  const maxBreakoutExtensionPct =
    options.maxBreakoutExtensionPct ?? (timeframe === "W" ? 10 : 7);

  const envelopeTolPct = timeframe === "W" ? 1.2 : 0.75;
  const touchTolPct = timeframe === "W" ? 2.5 : 1.5;

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

  const maxUsableFlagBars = Math.min(
    maxFlagBars,
    points.length - minPoleBars - 2
  );

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

    const flagLow = Math.min(...flagLows);
    const poleRange = poleHighPrice - poleStartPrice;

    if (poleRange <= 0) continue;

    const flagRetracementPct = ((poleHighPrice - flagLow) / poleRange) * 100;

    if (flagRetracementPct < minFlagRetracementPct) continue;
    if (flagRetracementPct > maxFlagRetracementPct) continue;

    const minAnchorSeparationBars = Math.max(
      3,
      Math.floor(flagPoints.length / 4)
    );

    const upperFit = fitFlagEnvelope({
      values: flagHighs,
      side: "upper",
      envelopeTolPct,
      touchTolPct,
      minTouches: 2,
      minAnchorSeparationBars,
    });

    if (!upperFit) continue;

    const lowerFit = fitFlagEnvelope({
      values: flagLows,
      side: "lower",
      envelopeTolPct,
      touchTolPct,
      minTouches: 2,
      minAnchorSeparationBars,
    });

    if (!lowerFit) continue;

    const channelUpperStartPrice = upperFit.valueAtStart;
    const channelUpperEndPrice = upperFit.valueAtEnd;
    const channelLowerStartPrice = lowerFit.valueAtStart;
    const channelLowerEndPrice = lowerFit.valueAtEnd;

    const flagDriftPct = pctDiff(channelUpperStartPrice, channelUpperEndPrice);

    const rawChannelWidthStart = channelUpperStartPrice - channelLowerStartPrice;
    const rawChannelWidthEnd = channelUpperEndPrice - channelLowerEndPrice;
    const rawAverageChannelWidth =
      (rawChannelWidthStart + rawChannelWidthEnd) / 2;

    if (
      !Number.isFinite(rawAverageChannelWidth) ||
      rawAverageChannelWidth <= 0 ||
      rawChannelWidthStart <= 0 ||
      rawChannelWidthEnd <= 0
    ) {
      continue;
    }

    const channelWidthOfPolePct = (rawAverageChannelWidth / poleRange) * 100;
    const channelWidthOfPricePct =
      (rawAverageChannelWidth / latest.close) * 100;

    const minChannelWidthOfPolePct = timeframe === "W" ? 12 : 10;

    const maxChannelWidthOfPolePct = timeframe === "W" ? 48 : 45;

    const minChannelWidthOfPricePct = timeframe === "W" ? 2.25 : 1.6;

    if (channelWidthOfPolePct < minChannelWidthOfPolePct) continue;
    if (channelWidthOfPolePct > maxChannelWidthOfPolePct) continue;
    if (channelWidthOfPricePct < minChannelWidthOfPricePct) continue;

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

    const minFlagAngleDeg = timeframe === "W" ? 8 : 9;
    const maxFlagAngleDeg = timeframe === "W" ? 28 : 30;

    if (upperFlagAngleDeg < minFlagAngleDeg) continue;
    if (upperFlagAngleDeg > maxFlagAngleDeg) continue;
    if (lowerFlagAngleDeg < minFlagAngleDeg) continue;
    if (lowerFlagAngleDeg > maxFlagAngleDeg) continue;

    const maxChannelAngleDifferenceDeg = timeframe === "W" ? 9 : 7;

    if (
      Math.abs(upperFlagAngleDeg - lowerFlagAngleDeg) >
      maxChannelAngleDifferenceDeg
    ) {
      continue;
    }

    const flagAngleDeg = (upperFlagAngleDeg + lowerFlagAngleDeg) / 2;

    const breakoutPrice = channelUpperEndPrice;
    const distanceToBreakoutPct = pctDiff(latest.close, breakoutPrice);

    const tightenedMaxDistanceToBreakoutPct =
      timeframe === "W"
        ? Math.min(maxDistanceToBreakoutPct, 5)
        : Math.min(maxDistanceToBreakoutPct, 3.5);

    if (distanceToBreakoutPct > tightenedMaxDistanceToBreakoutPct) continue;
    if (distanceToBreakoutPct < -maxBreakoutExtensionPct) continue;

    const poleScore = clamp((poleGainPct - minPoleGainPct) * 0.8 + 14, 0, 24);

    const retracementScore = clamp(
      22 - Math.abs(flagRetracementPct - 35) * 0.6,
      0,
      22
    );

    const proximityScore = clamp(
      16 - Math.max(0, distanceToBreakoutPct) * 2.5,
      0,
      16
    );

    const durationScore = clamp(
      timeframe === "W"
        ? flagBars >= 5 && flagBars <= 18
          ? 12
          : 8
        : flagBars >= 7 && flagBars <= 28
          ? 12
          : 8,
      0,
      12
    );

    const channelScore = clamp(
      (upperFit.touchCount + lowerFit.touchCount - 4) * 2,
      0,
      8
    );

    const volumeScore = volumeCompressionScore(flagPoints);
    const timeframeBonus = timeframe === "W" ? 4 : 0;

    const score = Math.round(
      clamp(
        poleScore +
          retracementScore +
          proximityScore +
          durationScore +
          channelScore +
          volumeScore +
          timeframeBonus,
        0,
        100
      )
    );

    const minScore = 55;
    if (score < minScore) continue;

    const tone =
      score >= 78
        ? "green"
        : score >= 64
          ? "yellow"
          : score >= 52
            ? "orange"
            : "red";

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

      // Channel endpoints are envelope values at the flag's first and last
      // bar, so the client can draw them verbatim and the lines sit on the
      // candle extremes instead of cutting through them.
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
