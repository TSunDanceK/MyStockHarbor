// lib/ta/ascendingTriangle.ts

export type PatternPoint = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type AscendingTriangleTimeframe = "D" | "W";

export type AscendingTriangleResult = {
  pattern: "ascendingTriangle";
  timeframe: AscendingTriangleTimeframe;
  score: number;
  tone: "green" | "yellow" | "orange" | "red";
  note: string;

  resistance: number;
  latestClose: number;
  distanceToResistancePct: number;

  resistanceTouches: number;
  risingLowTouches: number;
  patternBars: number;

  resistanceZonePct: number;
  lowSlopePct: number;

  supportStartDate: string;
  supportStartPrice: number;
  supportEndDate: string;
  supportEndPrice: number;

  startDate: string;
  endDate: string;
};

type Pivot = {
  idx: number;
  date: string;
  price: number;
};

type DetectOptions = {
  timeframe?: AscendingTriangleTimeframe;
  lookbackBars?: number;
  pivotLeftRight?: number;
  maxResistanceZonePct?: number;
  maxDistanceBelowResistancePct?: number;
  minResistanceTouches?: number;
  minRisingLowTouches?: number;
  minPatternBars?: number;
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

function visualSupportAngleDeg(args: {
  points: ReturnType<typeof normalisePoints>;
  resistance: number;
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
    args.resistance,
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

function findPivotHighs(points: ReturnType<typeof normalisePoints>, leftRight: number) {
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

function findPivotLows(points: ReturnType<typeof normalisePoints>, leftRight: number) {
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

function findBestResistanceCluster(
  pivotHighs: Pivot[],
  maxResistanceZonePct: number,
  minTouches: number
) {
  let best: Pivot[] = [];

  for (let i = 0; i < pivotHighs.length; i++) {
    const anchor = pivotHighs[i].price;

    const cluster = pivotHighs.filter((pivot) => {
      const distancePct = Math.abs(pctDiff(anchor, pivot.price));
      return distancePct <= maxResistanceZonePct;
    });

    if (cluster.length > best.length) {
      best = cluster;
    }
  }

  if (best.length < minTouches) return null;

  const resistance = avg(best.map((pivot) => pivot.price));
  const highest = Math.max(...best.map((pivot) => pivot.price));
  const lowest = Math.min(...best.map((pivot) => pivot.price));
  const zonePct = Math.abs(pctDiff(lowest, highest));

  return {
    touches: best.sort((a, b) => a.idx - b.idx),
    resistance,
    zonePct,
  };
}

function getRisingLows(pivotLows: Pivot[]) {
  if (pivotLows.length < 2) return [];

  const rising: Pivot[] = [pivotLows[0]];

  for (let i = 1; i < pivotLows.length; i++) {
    const previous = rising[rising.length - 1];

    if (pivotLows[i].price > previous.price) {
      rising.push(pivotLows[i]);
    }
  }

  return rising;
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

export function detectAscendingTriangle(
  rawPoints: PatternPoint[],
  options: DetectOptions = {}
): AscendingTriangleResult | null {
  const timeframe = options.timeframe ?? "D";

  const lookbackBars =
    options.lookbackBars ?? (timeframe === "W" ? 80 : 120);

  const pivotLeftRight =
    options.pivotLeftRight ?? (timeframe === "W" ? 1 : 2);

  const maxResistanceZonePct =
    options.maxResistanceZonePct ?? (timeframe === "W" ? 5 : 4);

  const maxDistanceBelowResistancePct =
    options.maxDistanceBelowResistancePct ?? 8;

  const minResistanceTouches =
    options.minResistanceTouches ?? 2;

  const minRisingLowTouches =
    options.minRisingLowTouches ?? 2;

  const minPatternBars =
    options.minPatternBars ?? (timeframe === "W" ? 8 : 20);

  const points = normalisePoints(rawPoints).slice(-lookbackBars);

  if (points.length < minPatternBars + pivotLeftRight * 2 + 5) {
    return null;
  }

  const latest = points[points.length - 1];
  const pivotHighs = findPivotHighs(points, pivotLeftRight);
  const pivotLows = findPivotLows(points, pivotLeftRight);

  if (pivotHighs.length < minResistanceTouches || pivotLows.length < minRisingLowTouches) {
    return null;
  }

  const resistanceCluster = findBestResistanceCluster(
    pivotHighs,
    maxResistanceZonePct,
    minResistanceTouches
  );

  if (!resistanceCluster) return null;

  const firstResistanceTouch = resistanceCluster.touches[0];
  const lastResistanceTouch = resistanceCluster.touches[resistanceCluster.touches.length - 1];

  const relevantLows = pivotLows.filter(
    (pivot) =>
      pivot.idx >= Math.max(0, firstResistanceTouch.idx - 8) &&
      pivot.idx <= points.length - 1 &&
      pivot.price < resistanceCluster.resistance
  );

  const risingLows = getRisingLows(relevantLows);

  if (risingLows.length < minRisingLowTouches) {
    return null;
  }

  const firstLow = risingLows[0];
  const lastLow = risingLows[risingLows.length - 1];

  const patternStartIdx = Math.min(firstResistanceTouch.idx, firstLow.idx);
  const patternBars = points.length - 1 - patternStartIdx;

  if (patternBars < minPatternBars) {
    return null;
  }

  const distanceToResistancePct = pctDiff(latest.close, resistanceCluster.resistance);

  if (distanceToResistancePct < -1.5 || distanceToResistancePct > maxDistanceBelowResistancePct) {
    return null;
  }

  const lowSlopePct = pctDiff(firstLow.price, lastLow.price);

  if (lowSlopePct <= 0) {
    return null;
  }

  const supportAngleDeg = visualSupportAngleDeg({
    points,
    resistance: resistanceCluster.resistance,
    latestClose: latest.close,
    startIdx: firstLow.idx,
    endIdx: lastLow.idx,
    startPrice: firstLow.price,
    endPrice: lastLow.price,
  });

  if (supportAngleDeg < 10) {
    return null;
  }

    const visualSupportStartIdx = Math.max(0, Math.floor(points.length * 0.12));
  const visualSupportEndIdx = points.length - 1;

  const visualSupportStartLow = Math.min(
    ...points
      .slice(0, Math.max(4, Math.floor(points.length * 0.35)))
      .map((point) => point.low)
      .filter((value) => Number.isFinite(value))
  );

  const visualSupportEndPrice = latest.close;
  const supportBreakTolerancePct = timeframe === "W" ? 4 : 3;
  const recentLookbackBars = timeframe === "W" ? 12 : 20;

  let recentSupportBreakCount = 0;

  for (
    let i = Math.max(0, points.length - recentLookbackBars);
    i < points.length;
    i++
  ) {
    const t =
      visualSupportEndIdx === visualSupportStartIdx
        ? 1
        : (i - visualSupportStartIdx) /
          (visualSupportEndIdx - visualSupportStartIdx);

    const expectedSupport =
      visualSupportStartLow +
      t * (visualSupportEndPrice - visualSupportStartLow);

    const breakPct = pctDiff(expectedSupport, points[i].close);

    if (breakPct < -supportBreakTolerancePct) {
      recentSupportBreakCount++;
    }
  }

  if (recentSupportBreakCount >= 2) {
    return null;
  }

  const resistanceQualityScore = clamp(
    25 - resistanceCluster.zonePct * 4,
    0,
    25
  );

  const risingLowsScore = clamp(
    10 + lowSlopePct * 1.2 + risingLows.length * 3,
    0,
    25
  );

  const priceLocationScore = clamp(
    15 - distanceToResistancePct * 1.5,
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
    resistanceCluster.touches.length * 3 + risingLows.length * 2,
    0,
    10
  );

  const volumeScore = volumeCompressionScore(points);

  const timeframeBonus = timeframe === "W" ? 5 : 0;

  const score = Math.round(
    clamp(
      resistanceQualityScore +
        risingLowsScore +
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
    score >= 75 ? "green" : score >= 62 ? "yellow" : score >= 50 ? "orange" : "red";

  const note =
    timeframe === "W"
      ? `Weekly ascending triangle candidate: ${resistanceCluster.touches.length} resistance touches, ${risingLows.length} rising lows, ${distanceToResistancePct.toFixed(1)}% below resistance.`
      : `Daily ascending triangle candidate: ${resistanceCluster.touches.length} resistance touches, ${risingLows.length} rising lows, ${distanceToResistancePct.toFixed(1)}% below resistance.`;

  return {
    pattern: "ascendingTriangle",
    timeframe,
    score,
    tone,
    note,
    resistance: Number(resistanceCluster.resistance.toFixed(2)),
    latestClose: Number(latest.close.toFixed(2)),
    distanceToResistancePct: Number(distanceToResistancePct.toFixed(2)),
    resistanceTouches: resistanceCluster.touches.length,
    risingLowTouches: risingLows.length,
    patternBars,
    resistanceZonePct: Number(resistanceCluster.zonePct.toFixed(2)),
    lowSlopePct: Number(lowSlopePct.toFixed(2)),

    supportStartDate: firstLow.date,
    supportStartPrice: Number(firstLow.price.toFixed(2)),
    supportEndDate: lastLow.date,
    supportEndPrice: Number(lastLow.price.toFixed(2)),

    startDate: points[patternStartIdx].date,
    endDate: latest.date,
  };
}
