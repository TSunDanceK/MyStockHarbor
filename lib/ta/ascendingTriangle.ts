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

    if (pivot.price > previous.price) {
      spaced[spaced.length - 1] = pivot;
    }
  }

  return spaced;
}

function findBestResistanceCluster(
  pivotHighs: Pivot[],
  maxResistanceZonePct: number,
  minTouches: number,
  minTouchSeparationBars: number
) {
  let best: Pivot[] = [];

  for (let i = 0; i < pivotHighs.length; i++) {
    const anchor = pivotHighs[i].price;

    const cluster = pivotHighs.filter((pivot) => {
      const distancePct = Math.abs(pctDiff(anchor, pivot.price));
      return distancePct <= maxResistanceZonePct;
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

type TrendlineFit = {
  anchorStart: Pivot;
  anchorEnd: Pivot;
  slopePerBar: number;
  touchCount: number;
  projectedAtLatest: number;
};

/**
 * Fits the rising-lows line as a true lower envelope:
 * a straight line through two pivot lows such that NO candle low between the
 * line start and the latest bar dips below it (beyond a small tolerance).
 * This is what makes the drawn line sit underneath the candles instead of
 * cutting through them.
 *
 * Among all valid envelope lines, prefers the one the price has respected
 * most often (most spaced touches), then the longest one.
 */
function fitRisingLowsEnvelope(args: {
  points: ReturnType<typeof normalisePoints>;
  candidates: Pivot[];
  lastIdx: number;
  envelopeTolPct: number;
  touchTolPct: number;
  minTouches: number;
  minAnchorSeparationBars: number;
  minTouchSeparationBars: number;
}): TrendlineFit | null {
  const {
    points,
    candidates,
    lastIdx,
    envelopeTolPct,
    touchTolPct,
    minTouches,
    minAnchorSeparationBars,
    minTouchSeparationBars,
  } = args;

  const sorted = [...candidates].sort((a, b) => a.idx - b.idx);

  let best: TrendlineFit | null = null;
  let bestSpan = 0;

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];

      if (b.idx - a.idx < minAnchorSeparationBars) continue;
      if (b.price <= a.price) continue;

      const slopePerBar = (b.price - a.price) / (b.idx - a.idx);

      const lineValueAt = (idx: number) =>
        a.price + slopePerBar * (idx - a.idx);

      // Envelope check: every bar from the line start to the latest bar
      // must keep its low at or above the line (small tolerance).
      let isEnvelope = true;

      for (let k = a.idx; k <= lastIdx; k++) {
        const lineValue = lineValueAt(k);

        if (lineValue <= 0) {
          isEnvelope = false;
          break;
        }

        if (points[k].low < lineValue * (1 - envelopeTolPct / 100)) {
          isEnvelope = false;
          break;
        }
      }

      if (!isEnvelope) continue;

      // Count how many spaced pivot lows actually come down and touch the line.
      let touchCount = 0;
      let lastTouchIdx = -Infinity;

      for (const pivot of sorted) {
        if (pivot.idx < a.idx || pivot.idx > lastIdx) continue;

        const lineValue = lineValueAt(pivot.idx);

        if (pivot.price <= lineValue * (1 + touchTolPct / 100)) {
          if (pivot.idx - lastTouchIdx >= minTouchSeparationBars) {
            touchCount++;
            lastTouchIdx = pivot.idx;
          }
        }
      }

      if (touchCount < minTouches) continue;

      const span = b.idx - a.idx;

      if (
        !best ||
        touchCount > best.touchCount ||
        (touchCount === best.touchCount && span > bestSpan)
      ) {
        best = {
          anchorStart: a,
          anchorEnd: b,
          slopePerBar,
          touchCount,
          projectedAtLatest: lineValueAt(lastIdx),
        };
        bestSpan = span;
      }
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

export function detectAscendingTriangle(
  rawPoints: PatternPoint[],
  options: DetectOptions = {}
): AscendingTriangleResult | null {
  const timeframe = options.timeframe ?? "D";

  const lookbackBars = options.lookbackBars ?? (timeframe === "W" ? 80 : 120);

  const pivotLeftRight = options.pivotLeftRight ?? (timeframe === "W" ? 1 : 2);

  const maxResistanceZonePct =
    options.maxResistanceZonePct ?? (timeframe === "W" ? 5 : 4);

  const maxDistanceBelowResistancePct =
    options.maxDistanceBelowResistancePct ?? 8;

  // Quality floor: an ascending triangle needs at least 3 touches on both
  // boundaries to be worth showing, regardless of what the caller asks for.
  const minResistanceTouches = Math.max(3, options.minResistanceTouches ?? 3);

  const minRisingLowTouches = Math.max(3, options.minRisingLowTouches ?? 3);

  const minPatternBars = options.minPatternBars ?? (timeframe === "W" ? 8 : 20);

  const minTouchSeparationBars =
    options.minTouchSeparationBars ?? (timeframe === "W" ? 2 : 5);

  const envelopeTolPct = timeframe === "W" ? 1 : 0.5;
  const touchTolPct = timeframe === "W" ? 2.25 : 1.5;

  const minAnchorSeparationBars = Math.max(minTouchSeparationBars * 2, 5);

  const points = normalisePoints(rawPoints).slice(-lookbackBars);

  if (points.length < minPatternBars + pivotLeftRight * 2 + 5) {
    return null;
  }

  const latest = points[points.length - 1];
  const lastIdx = points.length - 1;
  const pivotHighs = findPivotHighs(points, pivotLeftRight);
  const pivotLows = findPivotLows(points, pivotLeftRight);

  if (
    pivotHighs.length < minResistanceTouches ||
    pivotLows.length < minRisingLowTouches
  ) {
    return null;
  }

  const resistanceCluster = findBestResistanceCluster(
    pivotHighs,
    maxResistanceZonePct,
    minResistanceTouches,
    minTouchSeparationBars
  );

  if (!resistanceCluster) return null;

  const firstResistanceTouch = resistanceCluster.touches[0];
  const lastResistanceTouch =
    resistanceCluster.touches[resistanceCluster.touches.length - 1];

  const resistanceSpanBars =
    lastResistanceTouch.idx - firstResistanceTouch.idx;

  if (resistanceSpanBars <= 0) {
    return null;
  }

  const resistanceSlopePct = pctDiff(
    firstResistanceTouch.price,
    lastResistanceTouch.price
  );

  const maxDescendingResistanceSlopePct = timeframe === "W" ? -5.5 : -2.75;

  if (resistanceSlopePct < maxDescendingResistanceSlopePct) {
    return null;
  }

  const resistanceTouchPrices = resistanceCluster.touches.map(
    (touch) => touch.price
  );

  const earlyResistanceTouches = resistanceTouchPrices.slice(
    0,
    Math.max(1, Math.floor(resistanceTouchPrices.length / 2))
  );

  const lateResistanceTouches = resistanceTouchPrices.slice(
    Math.max(1, Math.floor(resistanceTouchPrices.length / 2))
  );

  const earlyResistanceAvg = avg(earlyResistanceTouches);
  const lateResistanceAvg = avg(lateResistanceTouches);

  const resistanceDriftPct = pctDiff(earlyResistanceAvg, lateResistanceAvg);

  const maxDescendingResistanceDriftPct = timeframe === "W" ? -5 : -2.25;

  if (resistanceDriftPct < maxDescendingResistanceDriftPct) {
    return null;
  }

  const lowLookbackBeforeFirstResistance = timeframe === "W" ? 40 : 12;

  const relevantLows = pivotLows.filter(
    (pivot) =>
      pivot.idx >=
        Math.max(
          0,
          firstResistanceTouch.idx - lowLookbackBeforeFirstResistance
        ) &&
      pivot.idx <= lastIdx &&
      pivot.price < resistanceCluster.resistance
  );

  const envelopeFit = fitRisingLowsEnvelope({
    points,
    candidates: relevantLows,
    lastIdx,
    envelopeTolPct,
    touchTolPct,
    minTouches: minRisingLowTouches,
    minAnchorSeparationBars,
    minTouchSeparationBars,
  });

  if (!envelopeFit) {
    return null;
  }

  const firstLow = envelopeFit.anchorStart;
  const projectedSupportAtLatest = envelopeFit.projectedAtLatest;

  const patternStartIdx = Math.min(firstResistanceTouch.idx, firstLow.idx);
  const patternBars = lastIdx - patternStartIdx;

  if (patternBars < minPatternBars) {
    return null;
  }

  const distanceToResistancePct = pctDiff(
    latest.close,
    resistanceCluster.resistance
  );

  if (distanceToResistancePct < -1.5) {
    return null;
  }

  // Price must genuinely be near the breakout level for this to count as a
  // play (previously this cap was multiplied by 4, which let through setups
  // sitting 20%+ below resistance).
  if (distanceToResistancePct > maxDistanceBelowResistancePct) {
    return null;
  }

  const closeBreakTolerancePct = timeframe === "W" ? 1.5 : 1;
  const maxCloseBreakBars = timeframe === "W" ? 2 : 2;

  let closeBreakBars = 0;

  for (let i = patternStartIdx; i < points.length; i++) {
    const closeAboveResistancePct = pctDiff(
      resistanceCluster.resistance,
      points[i].close
    );

    if (closeAboveResistancePct > closeBreakTolerancePct) {
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
  let highestHighAboveResistancePct = 0;

  for (let i = patternStartIdx; i < points.length; i++) {
    const highAboveResistancePct = pctDiff(
      resistanceCluster.resistance,
      points[i].high
    );

    highestHighAboveResistancePct = Math.max(
      highestHighAboveResistancePct,
      highAboveResistancePct
    );

    if (highAboveResistancePct > hardWickBreakPct) {
      return null;
    }

    if (highAboveResistancePct > wickBreakTolerancePct) {
      wickBreakBars++;
    }

    if (wickBreakBars > maxWickBreakBars) {
      return null;
    }
  }

  const failedBreakoutHighPct = timeframe === "W" ? 3.25 : 2.5;
  const failedBreakoutPullbackPct = timeframe === "W" ? 4 : 3.25;

  if (
    highestHighAboveResistancePct > failedBreakoutHighPct &&
    distanceToResistancePct > failedBreakoutPullbackPct
  ) {
    return null;
  }

  // The triangle must still be open: if the projected support line has
  // already converged into (or above) resistance, the pattern is spent.
  if (projectedSupportAtLatest > resistanceCluster.resistance * 0.99) {
    return null;
  }

  const lowSlopePct = pctDiff(firstLow.price, projectedSupportAtLatest);

  if (lowSlopePct <= 0) {
    return null;
  }

  const supportAngleDeg = visualSupportAngleDeg({
    points,
    resistance: resistanceCluster.resistance,
    latestClose: latest.close,
    startIdx: firstLow.idx,
    endIdx: lastIdx,
    startPrice: firstLow.price,
    endPrice: projectedSupportAtLatest,
  });

  const minSupportAngleDeg = timeframe === "W" ? 4.5 : 7;

  if (supportAngleDeg < minSupportAngleDeg) {
    return null;
  }

  const resistanceQualityScore = clamp(
    22 - resistanceCluster.zonePct * 5,
    0,
    22
  );

  const trendlineScore = clamp(
    envelopeFit.touchCount * 4 + lowSlopePct * 0.4,
    0,
    22
  );

  const priceLocationScore = clamp(
    14 - Math.max(0, distanceToResistancePct) * 1.6,
    0,
    14
  );

  const durationScore = clamp(
    4 + (patternBars / (timeframe === "W" ? 14 : 40)) * 8,
    4,
    12
  );

  const touchScore = clamp(
    (resistanceCluster.touches.length - 3) * 3 +
      (envelopeFit.touchCount - 3) * 3,
    0,
    12
  );

  const volumeScore = volumeCompressionScore(points);

  const timeframeBonus = timeframe === "W" ? 3 : 0;

  const score = Math.round(
    clamp(
      resistanceQualityScore +
        trendlineScore +
        priceLocationScore +
        durationScore +
        touchScore +
        volumeScore +
        timeframeBonus,
      0,
      100
    )
  );

  if (score < 50) return null;

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
      ? `Weekly ascending triangle candidate: ${resistanceCluster.touches.length} resistance touches, ${envelopeFit.touchCount} rising lows, ${distanceToResistancePct.toFixed(1)}% below resistance.`
      : `Daily ascending triangle candidate: ${resistanceCluster.touches.length} resistance touches, ${envelopeFit.touchCount} rising lows, ${distanceToResistancePct.toFixed(1)}% below resistance.`;

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
    risingLowTouches: envelopeFit.touchCount,
    patternBars,
    resistanceZonePct: Number(resistanceCluster.zonePct.toFixed(2)),
    lowSlopePct: Number(lowSlopePct.toFixed(2)),

    // The line is anchored on the first envelope pivot and projected to the
    // latest bar, so the client can draw these two points verbatim and the
    // line is guaranteed to sit underneath every candle in between.
    supportStartDate: firstLow.date,
    supportStartPrice: Number(firstLow.price.toFixed(2)),
    supportEndDate: latest.date,
    supportEndPrice: Number(projectedSupportAtLatest.toFixed(2)),

    startDate: points[patternStartIdx].date,
    endDate: latest.date,
  };
}
