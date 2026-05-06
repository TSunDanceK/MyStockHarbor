// lib/ta/descendingTriangle.ts

export type PatternPoint = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type DescendingTriangleTimeframe = "D" | "W";

export type DescendingTriangleResult = {
  pattern: "descendingTriangle";
  timeframe: DescendingTriangleTimeframe;
  score: number;
  tone: "green" | "yellow" | "orange" | "red";
  note: string;

  support: number;
  latestClose: number;
  distanceToSupportPct: number;

  supportTouches: number;
  fallingHighTouches: number;
  patternBars: number;

  supportZonePct: number;
  highSlopePct: number;

  resistanceStartDate: string;
  resistanceStartPrice: number;
  resistanceEndDate: string;
  resistanceEndPrice: number;

  startDate: string;
  endDate: string;
};

type Pivot = {
  idx: number;
  date: string;
  price: number;
};

type DetectOptions = {
  timeframe?: DescendingTriangleTimeframe;
  lookbackBars?: number;
  pivotLeftRight?: number;
  maxSupportZonePct?: number;
  maxDistanceAboveSupportPct?: number;
  minSupportTouches?: number;
  minFallingHighTouches?: number;
  minPatternBars?: number;
  minTouchSeparationBars?: number;
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

function visualResistanceAngleDeg(args: {
  points: ReturnType<typeof normalisePoints>;
  support: number;
  latestClose: number;
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

  const lows = args.points
    .map((point) => point.low)
    .filter((value) => Number.isFinite(value));

  const highs = args.points
    .map((point) => point.high)
    .filter((value) => Number.isFinite(value));

  const values = [
    ...lows,
    ...highs,
    args.support,
    args.latestClose,
    args.startPrice,
    args.endPrice,
  ].filter((value) => Number.isFinite(value));

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

  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);

  if (dx <= 0) return 0;

  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function findPivotHighs(
  points: ReturnType<typeof normalisePoints>,
  leftRight: number
) {
  const pivots: Pivot[] = [];

  for (let i = leftRight; i < points.length - leftRight; i++) {
    const current = points[i].high;
    let isPivot = true;

    for (let j = i - leftRight; j <= i + leftRight; j++) {
      if (j === i) continue;

      if (points[j].high > current) {
        isPivot = false;
        break;
      }
    }

    if (isPivot) {
      pivots.push({
        idx: i,
        date: points[i].date,
        price: current,
      });
    }
  }

  return pivots;
}

function findPivotLows(
  points: ReturnType<typeof normalisePoints>,
  leftRight: number
) {
  const pivots: Pivot[] = [];

  for (let i = leftRight; i < points.length - leftRight; i++) {
    const current = points[i].low;
    let isPivot = true;

    for (let j = i - leftRight; j <= i + leftRight; j++) {
      if (j === i) continue;

      if (points[j].low < current) {
        isPivot = false;
        break;
      }
    }

    if (isPivot) {
      pivots.push({
        idx: i,
        date: points[i].date,
        price: current,
      });
    }
  }

  return pivots;
}

function filterSpacedPivots(pivots: Pivot[], minSeparationBars: number) {
  const sorted = [...pivots].sort((a, b) => a.idx - b.idx);
  const spaced: Pivot[] = [];

  for (const pivot of sorted) {
    const previous = spaced[spaced.length - 1];

    if (!previous || pivot.idx - previous.idx >= minSeparationBars) {
      spaced.push(pivot);
      continue;
    }

    if (pivot.price < previous.price) {
      spaced[spaced.length - 1] = pivot;
    }
  }

  return spaced;
}

function findBestSupportCluster(
  pivotLows: Pivot[],
  maxSupportZonePct: number,
  minTouches: number,
  minTouchSeparationBars: number
) {
  let best: Pivot[] = [];

  for (let i = 0; i < pivotLows.length; i++) {
    const anchor = pivotLows[i].price;

    const cluster = pivotLows.filter((pivot) => {
      const distancePct = Math.abs(pctDiff(anchor, pivot.price));
      return distancePct <= maxSupportZonePct;
    });

    const spacedCluster = filterSpacedPivots(cluster, minTouchSeparationBars);

    const currentSpan =
      spacedCluster.length >= 2
        ? spacedCluster[spacedCluster.length - 1].idx - spacedCluster[0].idx
        : 0;

    const bestSpan =
      best.length >= 2 ? best[best.length - 1].idx - best[0].idx : 0;

    if (
      spacedCluster.length > best.length ||
      (spacedCluster.length === best.length && currentSpan > bestSpan)
    ) {
      best = spacedCluster;
    }
  }

  if (best.length < minTouches) return null;

  const support = avg(best.map((pivot) => pivot.price));
  const highest = Math.max(...best.map((pivot) => pivot.price));
  const lowest = Math.min(...best.map((pivot) => pivot.price));
  const zonePct = Math.abs(pctDiff(lowest, highest));

  return {
    touches: best.sort((a, b) => a.idx - b.idx),
    support,
    zonePct,
  };
}

function getFallingHighs(pivotHighs: Pivot[]) {
  if (pivotHighs.length < 2) return [];

  let best: Pivot[] = [];

  for (let start = 0; start < pivotHighs.length; start++) {
    const falling: Pivot[] = [pivotHighs[start]];

    for (let i = start + 1; i < pivotHighs.length; i++) {
      const previous = falling[falling.length - 1];

      if (pivotHighs[i].price < previous.price) {
        falling.push(pivotHighs[i]);
      }
    }

    const currentSpan =
      falling.length >= 2
        ? falling[falling.length - 1].idx - falling[0].idx
        : 0;

    const bestSpan =
      best.length >= 2 ? best[best.length - 1].idx - best[0].idx : 0;

    if (
      falling.length > best.length ||
      (falling.length === best.length && currentSpan > bestSpan)
    ) {
      best = falling;
    }
  }

  return best;
}

function volumeCompressionScore(points: ReturnType<typeof normalisePoints>) {
  const volumePoints = points
    .map((point) => point.volume)
    .filter((volume): volume is number => Number.isFinite(volume));

  if (volumePoints.length < 30) return 0;

  const recent = volumePoints.slice(-15);
  const prior = volumePoints.slice(-45, -15);

  if (!recent.length || !prior.length) return 0;

  const recentAvg = avg(recent);
  const priorAvg = avg(prior);

  if (priorAvg <= 0) return 0;

  const compressionPct = pctDiff(priorAvg, recentAvg);

  if (compressionPct <= -25) return 5;
  if (compressionPct <= -15) return 4;
  if (compressionPct <= -8) return 3;

  return 0;
}

export function detectDescendingTriangle(
  rawPoints: PatternPoint[],
  options: DetectOptions = {}
): DescendingTriangleResult | null {
  const timeframe = options.timeframe ?? "D";

  const lookbackBars = options.lookbackBars ?? (timeframe === "W" ? 80 : 120);

  const pivotLeftRight = options.pivotLeftRight ?? (timeframe === "W" ? 1 : 2);

  const maxSupportZonePct =
    options.maxSupportZonePct ?? (timeframe === "W" ? 5 : 4);

  const maxDistanceAboveSupportPct = options.maxDistanceAboveSupportPct ?? 8;

  const minSupportTouches = options.minSupportTouches ?? 2;

  const minFallingHighTouches = options.minFallingHighTouches ?? 2;

  const minPatternBars = options.minPatternBars ?? (timeframe === "W" ? 8 : 20);

  const minTouchSeparationBars =
    options.minTouchSeparationBars ?? (timeframe === "W" ? 2 : 5);

  const points = normalisePoints(rawPoints).slice(-lookbackBars);

  if (points.length < minPatternBars + pivotLeftRight * 2 + 5) {
    return null;
  }

  const latest = points[points.length - 1];
  const pivotHighs = findPivotHighs(points, pivotLeftRight);
  const pivotLows = findPivotLows(points, pivotLeftRight);

  if (
    pivotLows.length < minSupportTouches ||
    pivotHighs.length < minFallingHighTouches
  ) {
    return null;
  }

  const supportCluster = findBestSupportCluster(
    pivotLows,
    maxSupportZonePct,
    minSupportTouches,
    minTouchSeparationBars
  );

  if (!supportCluster) return null;

  const firstSupportTouch = supportCluster.touches[0];
  const lastSupportTouch =
    supportCluster.touches[supportCluster.touches.length - 1];

  const supportSpanBars = lastSupportTouch.idx - firstSupportTouch.idx;

  if (supportSpanBars <= 0) {
    return null;
  }

  const supportSlopePct = pctDiff(
    firstSupportTouch.price,
    lastSupportTouch.price
  );

  const maxRisingSupportSlopePct = timeframe === "W" ? 3.5 : 2.75;

  if (supportSlopePct > maxRisingSupportSlopePct) {
    return null;
  }

  const supportTouchPrices = supportCluster.touches.map(
    (touch) => touch.price
  );

  const earlySupportTouches = supportTouchPrices.slice(
    0,
    Math.max(1, Math.floor(supportTouchPrices.length / 2))
  );

  const lateSupportTouches = supportTouchPrices.slice(
    Math.max(1, Math.floor(supportTouchPrices.length / 2))
  );

  const earlySupportAvg = avg(earlySupportTouches);
  const lateSupportAvg = avg(lateSupportTouches);

  const supportDriftPct = pctDiff(earlySupportAvg, lateSupportAvg);

  const maxRisingSupportDriftPct = timeframe === "W" ? 3 : 2.25;

  if (supportDriftPct > maxRisingSupportDriftPct) {
    return null;
  }

  const relevantHighs = pivotHighs.filter(
    (pivot) =>
      pivot.idx >= Math.max(0, firstSupportTouch.idx - 12) &&
      pivot.idx <= points.length - 1 &&
      pivot.price > supportCluster.support
  );

  const fallingHighs = getFallingHighs(relevantHighs);

  if (fallingHighs.length < minFallingHighTouches) {
    return null;
  }

  const firstHigh = fallingHighs[0];
  const lastHigh = fallingHighs[fallingHighs.length - 1];

  const patternStartIdx = Math.min(firstSupportTouch.idx, firstHigh.idx);
  const patternBars = points.length - 1 - patternStartIdx;

  if (patternBars < minPatternBars) {
    return null;
  }

  const distanceToSupportPct = pctDiff(supportCluster.support, latest.close);

  if (distanceToSupportPct < -1.5) {
    return null;
  }

  if (distanceToSupportPct > maxDistanceAboveSupportPct * 4) {
    return null;
  }

  const closeBreakTolerancePct = timeframe === "W" ? 1.5 : 1;
  const maxCloseBreakBars = timeframe === "W" ? 2 : 2;

  let closeBreakBars = 0;

  for (let i = patternStartIdx; i < points.length; i++) {
    const closeBelowSupportPct = pctDiff(
      supportCluster.support,
      points[i].close
    );

    if (closeBelowSupportPct < -closeBreakTolerancePct) {
      closeBreakBars++;
    }

    if (closeBreakBars > maxCloseBreakBars) {
      return null;
    }
  }

  const wickBreakTolerancePct = timeframe === "W" ? 3.5 : 2.75;
  const hardWickBreakPct = timeframe === "W" ? 5.5 : 4.25;
  const maxWickBreakBars = timeframe === "W" ? 2 : 2;

  let wickBreakBars = 0;
  let deepestLowBelowSupportPct = 0;

  for (let i = patternStartIdx; i < points.length; i++) {
    const lowBelowSupportPct = pctDiff(supportCluster.support, points[i].low);

    deepestLowBelowSupportPct = Math.min(
      deepestLowBelowSupportPct,
      lowBelowSupportPct
    );

    if (lowBelowSupportPct < -hardWickBreakPct) {
      return null;
    }

    if (lowBelowSupportPct < -wickBreakTolerancePct) {
      wickBreakBars++;
    }

    if (wickBreakBars > maxWickBreakBars) {
      return null;
    }
  }

  const failedBreakdownLowPct = timeframe === "W" ? -3.25 : -2.5;
  const failedBreakdownBouncePct = timeframe === "W" ? 4 : 3.25;

  if (
    deepestLowBelowSupportPct < failedBreakdownLowPct &&
    distanceToSupportPct > failedBreakdownBouncePct
  ) {
    return null;
  }

  const highSlopePct = pctDiff(firstHigh.price, lastHigh.price);

  if (highSlopePct >= 0) {
    return null;
  }

  const resistanceAngleDeg = visualResistanceAngleDeg({
    points,
    support: supportCluster.support,
    latestClose: latest.close,
    startIdx: firstHigh.idx,
    endIdx: lastHigh.idx,
    startPrice: firstHigh.price,
    endPrice: lastHigh.price,
  });

  if (resistanceAngleDeg < 7) {
    return null;
  }

  const resistanceProjectionBars = lastHigh.idx - firstHigh.idx;

  if (resistanceProjectionBars <= 0) {
    return null;
  }

  const resistanceSlopePerBar =
    (lastHigh.price - firstHigh.price) / resistanceProjectionBars;

  const projectedResistanceAtLatest =
    firstHigh.price +
    resistanceSlopePerBar * (points.length - 1 - firstHigh.idx);

  const resistanceToSupportGapPct = pctDiff(
    supportCluster.support,
    projectedResistanceAtLatest
  );

  const maxResistanceBelowSupportPct = timeframe === "W" ? 1.75 : 1.25;

  if (resistanceToSupportGapPct < -maxResistanceBelowSupportPct) {
    return null;
  }

  const latestAboveProjectedResistancePct = pctDiff(
    projectedResistanceAtLatest,
    latest.close
  );

  const maxLatestAboveResistancePct = timeframe === "W" ? 3 : 2.25;

  if (latestAboveProjectedResistancePct > maxLatestAboveResistancePct) {
    return null;
  }

  const supportQualityScore = clamp(25 - supportCluster.zonePct * 4, 0, 25);

  const fallingHighsScore = clamp(
    10 + Math.abs(highSlopePct) * 1.2 + fallingHighs.length * 3,
    0,
    25
  );

  const priceLocationScore = clamp(
    15 - Math.max(0, distanceToSupportPct) * 0.5,
    0,
    15
  );

  const durationScore = clamp(
    timeframe === "W"
      ? patternBars >= 12
        ? 15
        : 10
      : patternBars >= 35
        ? 15
        : 10,
    0,
    15
  );

  const touchScore = clamp(
    supportCluster.touches.length * 3 + fallingHighs.length * 2,
    0,
    10
  );

  const volumeScore = volumeCompressionScore(points);

  const timeframeBonus = timeframe === "W" ? 5 : 0;

  const score = Math.round(
    clamp(
      supportQualityScore +
        fallingHighsScore +
        priceLocationScore +
        durationScore +
        touchScore +
        volumeScore +
        timeframeBonus,
      0,
      100
    )
  );

  if (score < 45) return null;

  const tone =
    score >= 75
      ? "green"
      : score >= 62
        ? "yellow"
        : score >= 50
          ? "orange"
          : "red";

  const note =
    timeframe === "W"
      ? `Weekly descending triangle candidate: ${supportCluster.touches.length} support touches, ${fallingHighs.length} falling highs, ${distanceToSupportPct.toFixed(1)}% above support.`
      : `Daily descending triangle candidate: ${supportCluster.touches.length} support touches, ${fallingHighs.length} falling highs, ${distanceToSupportPct.toFixed(1)}% above support.`;

  return {
    pattern: "descendingTriangle",
    timeframe,
    score,
    tone,
    note,
    support: Number(supportCluster.support.toFixed(2)),
    latestClose: Number(latest.close.toFixed(2)),
    distanceToSupportPct: Number(distanceToSupportPct.toFixed(2)),
    supportTouches: supportCluster.touches.length,
    fallingHighTouches: fallingHighs.length,
    patternBars,
    supportZonePct: Number(supportCluster.zonePct.toFixed(2)),
    highSlopePct: Number(highSlopePct.toFixed(2)),

    resistanceStartDate: firstHigh.date,
    resistanceStartPrice: Number(firstHigh.price.toFixed(2)),
    resistanceEndDate: lastHigh.date,
    resistanceEndPrice: Number(lastHigh.price.toFixed(2)),

    startDate: points[patternStartIdx].date,
    endDate: latest.date,
  };
}
