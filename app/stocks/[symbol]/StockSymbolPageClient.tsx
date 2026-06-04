"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import type { AiStockAnalysis } from "@/lib/ai-stock-analysis";
import StockPriceChart from "../../stock/[symbol]/StockPriceChart";
import StockTickerJump from "../../stock/[symbol]/StockTickerJump";

type Quote = {
  symbol: string;
  price: number | null;
  date: string | null;
  time: string | null;
  source: string;
};

type StockValuationData = {
  peRatio: number | null;
  priceToSalesRatio: number | null;
  priceToBookRatio: number | null;
  evToEbitda: number | null;
  sourceNote: string;
};

type ScoreTone = "green" | "yellow" | "red";

type EarningsPeriodSummary = {
  label: string;
  date: string | null;
  tone: ScoreTone;
  toneLabel: "Good" | "Neutral" | "Weak";
  actualEps: number | null;
  estimatedEps: number | null;
  epsSurprisePercent: number | null;
  revenueSurprisePercent: number | null;
};

type EarningsYearSummary = {
  year: string;
  tone: ScoreTone;
  toneLabel: "Good" | "Neutral" | "Weak";
  goodCount: number;
  neutralCount: number;
  weakCount: number;
};

type StockEarningsData = {
  hasStructuredData: boolean;
  tone: ScoreTone;
  toneLabel: "Good" | "Neutral" | "Weak" | "Unavailable";
  score?: number | null;
  reportDate: string | null;
  actualEps: number | null;
  estimatedEps: number | null;
  epsSurprise: number | null;
  epsSurprisePercent: number | null;
  revenue: number | null;
  revenueEstimate: number | null;
  revenueSurprise: number | null;
  revenueSurprisePercent: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netIncome: number | null;
  nextEarningsDate: string | null;
  recentReports: EarningsPeriodSummary[];
  yearlySummaries: EarningsYearSummary[];
  sourceNote: string;
};

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type SymbolResult = {
  symbol: string;
  name: string;
  exchange: string;
};

type StockSymbolPageClientProps = {
  symbol: string;
  aiAnalysis: AiStockAnalysis | null;
};

function movingAverage(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }

  return out;
}

function lastNum(arr: (number | null)[]) {
  return arr.length ? arr[arr.length - 1] : null;
}

function rsiWilder(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss += -diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  out[period] = 100 - 100 / (1 + rs0);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }

  return out;
}

function buildTrendScore(args: {
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
}) {
  const { lastClose, ma50, ma200 } = args;

  const checks = [
    typeof lastClose === "number" && typeof ma200 === "number" ? lastClose > ma200 : null,
    typeof lastClose === "number" && typeof ma50 === "number" ? lastClose > ma50 : null,
    typeof ma50 === "number" && typeof ma200 === "number" ? ma50 > ma200 : null,
  ];

  const passed = checks.reduce((acc, v) => acc + (v === true ? 1 : 0), 0);
  return { passed, total: 3 };
}

function trendLabel(args: {
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
}) {
  const { lastClose, ma50, ma200 } = args;

  if (
    typeof lastClose === "number" &&
    typeof ma50 === "number" &&
    typeof ma200 === "number"
  ) {
    if (lastClose > ma50 && ma50 > ma200) return "Uptrend";
    if (lastClose < ma50 && ma50 < ma200) return "Downtrend";
  }

  return "Range / Mixed";
}

function formatValuationMultiple(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value < 0) return "N/A";
  if (value >= 100) return `${Math.round(value)}×`;
  if (value >= 10) return `${value.toFixed(1)}×`;
  return `${value.toFixed(2)}×`;
}

function valuationTone(value: number | null | undefined): "green" | "yellow" | "red" {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "yellow";
  if (value >= 80) return "red";
  if (value >= 30) return "yellow";
  return "green";
}


function toneColor(tone: "green" | "yellow" | "red") {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#eab308";
  return "#ef4444";
}


function toneSoftBackground(tone: "green" | "yellow" | "red") {
  if (tone === "green") return "linear-gradient(135deg, rgba(34,197,94,0.14), rgba(255,255,255,0.035))";
  if (tone === "yellow") return "linear-gradient(135deg, rgba(250,204,21,0.13), rgba(255,255,255,0.035))";
  return "linear-gradient(135deg, rgba(239,68,68,0.13), rgba(255,255,255,0.035))";
}

function toneBorder(tone: "green" | "yellow" | "red") {
  if (tone === "green") return "1px solid rgba(34,197,94,0.26)";
  if (tone === "yellow") return "1px solid rgba(250,204,21,0.26)";
  return "1px solid rgba(239,68,68,0.26)";
}

function metricToneFromPct(value: number | null): "green" | "yellow" | "red" {
  if (typeof value !== "number") return "yellow";
  if (value >= 0) return "green";
  return "red";
}

function rsiTone(value: number | null): "green" | "yellow" | "red" {
  if (typeof value !== "number") return "yellow";
  if (value >= 70 || value <= 30) return "red";
  if (value >= 55) return "green";
  return "yellow";
}

function pctFromBase(last: number | null, base: number | null) {
  if (
    typeof last !== "number" ||
    typeof base !== "number" ||
    !Number.isFinite(last) ||
    !Number.isFinite(base) ||
    base === 0
  ) {
    return null;
  }

  return ((last - base) / base) * 100;
}


type MacroSupportResult = {
  lower: number;
  upper: number;
  level: number;
  distancePct: number;
  touches: number;
  volumeRatio: number | null;
};

type MacdResult = {
  macd: number;
  signal: number;
  histogram: number;
  label: "Bullish" | "Bearish" | "Mixed";
  tone: "green" | "yellow" | "red";
  meta: string;
};

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function aggregateWeekly(points: Point[]): Point[] {
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

    if (!existing) {
      buckets.set(key, {
        date: key,
        close: point.close,
        high,
        low,
        volume,
      });
    } else {
      buckets.set(key, {
        date: key,
        close: point.close,
        high: Math.max(existing.high ?? existing.close, high),
        low: Math.min(existing.low ?? existing.close, low),
        volume: (existing.volume ?? 0) + volume,
      });
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function computeMacroSupport(points: Point[], lastClose: number | null): MacroSupportResult | null {
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
      if (low > leftLow || low > rightLow) {
        isSwingLow = false;
        break;
      }
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
    const lower = Math.min(...prices);
    const upper = Math.max(...prices);
    const level = avg(prices);
    const zoneWidthPct = level > 0 ? ((upper - lower) / level) * 100 : 999;
    if (zoneWidthPct > maxZonePct) continue;

    const firstIdx = Math.min(...members.map((member) => member.idx));
    const lastIdx = Math.max(...members.map((member) => member.idx));
    const spanWeeks = lastIdx - firstIdx;
    if (spanWeeks < 8) continue;

    const distancePct = lastClose >= upper ? ((lastClose - upper) / lastClose) * 100 : 0;
    if (lastClose < lower * 0.97) continue;
    if (distancePct > 35) continue;

    const normalVolume = avg(
      weekly
        .slice(-52)
        .map((week) => week.volume ?? 0)
        .filter((volume) => volume > 0)
    );

    const zoneVolumes = weekly
      .filter((week) => {
        const low = week.low ?? week.close;
        const high = week.high ?? week.close;
        return high >= lower && low <= upper;
      })
      .map((week) => week.volume ?? 0)
      .filter((volume) => volume > 0);

    const volumeRatio = normalVolume > 0 && zoneVolumes.length ? avg(zoneVolumes) / normalVolume : null;

    const touchScore = Math.min(members.length / 5, 1) * 36;
    const proximityScore = Math.max(0, 1 - distancePct / 35) * 28;
    const spanScore = Math.min(spanWeeks / 80, 1) * 16;
    const tightnessScore = Math.max(0, 1 - zoneWidthPct / maxZonePct) * 12;
    const volumeScore = typeof volumeRatio === "number" ? Math.min(volumeRatio / 1.6, 1) * 8 : 2;

    candidates.push({
      lower,
      upper,
      level,
      distancePct,
      touches: members.length,
      volumeRatio,
      score: touchScore + proximityScore + spanScore + tightnessScore + volumeScore,
    });
  }

  return candidates.sort((a, b) => b.score - a.score || a.distancePct - b.distancePct)[0] ?? null;
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period) return out;

  const multiplier = 2 / (period + 1);
  let current = avg(values.slice(0, period));
  out[period - 1] = current;

  for (let i = period; i < values.length; i++) {
    current = (values[i] - current) * multiplier + current;
    out[i] = current;
  }

  return out;
}

function buildMacd(values: number[]): MacdResult | null {
  if (values.length < 35) return null;

  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const macdLine = values.map((_, index) => {
    const fast = ema12[index];
    const slow = ema26[index];
    return typeof fast === "number" && typeof slow === "number" ? fast - slow : null;
  });

  const firstMacdIndex = macdLine.findIndex((value) => typeof value === "number");
  if (firstMacdIndex < 0) return null;

  const macdValues = macdLine.slice(firstMacdIndex).filter((value): value is number => typeof value === "number");
  const signalValues = ema(macdValues, 9);
  const lastSignal = lastNum(signalValues);
  const lastMacd = macdValues.length ? macdValues[macdValues.length - 1] : null;

  if (typeof lastMacd !== "number" || typeof lastSignal !== "number") return null;

  const histogram = lastMacd - lastSignal;
  const absHistogram = Math.abs(histogram);
  const quietThreshold = Math.max(values[values.length - 1] * 0.001, 0.03);

  if (absHistogram <= quietThreshold) {
    return {
      macd: lastMacd,
      signal: lastSignal,
      histogram,
      label: "Mixed",
      tone: "yellow",
      meta: "MACD near signal line",
    };
  }

  if (histogram > 0) {
    return {
      macd: lastMacd,
      signal: lastSignal,
      histogram,
      label: "Bullish",
      tone: "green",
      meta: "Momentum above signal",
    };
  }

  return {
    macd: lastMacd,
    signal: lastSignal,
    histogram,
    label: "Bearish",
    tone: "red",
    meta: "Momentum below signal",
  };
}

function supportTone(distancePct: number | null): "green" | "yellow" | "red" {
  if (typeof distancePct !== "number") return "yellow";
  if (distancePct <= 8) return "green";
  if (distancePct <= 18) return "yellow";
  return "red";
}

function supportQualityTone(support: MacroSupportResult | null): "green" | "yellow" | "red" {
  if (!support) return "yellow";
  const volumeRatio = support.volumeRatio ?? 1;
  if (support.touches >= 4 && volumeRatio >= 1.1) return "green";
  if (support.touches >= 2) return "yellow";
  return "red";
}

function scoreBandLabel(score: number) {
  if (score >= 80) return "Strong";
  if (score >= 65) return "Good";
  if (score >= 50) return "Mixed";
  if (score >= 35) return "Weak";
  return "High risk";
}

function scoreExplainText(type: "fundamentals" | "future", score: number) {
  if (type === "fundamentals") {
    if (score >= 65) return "This score reflects a stronger current business-quality read, including resilience, profitability potential, demand quality and business durability.";
    if (score >= 50) return "This score reflects a mixed current business-quality read. The company may have strengths, but there are still financial, execution or resilience questions.";
    return "This score reflects a weaker current business-quality read, often linked to profitability pressure, cash burn, weak demand, balance-sheet risk or inconsistent execution.";
  }

  if (score >= 65) return "This score reflects stronger medium-to-long-term potential, usually linked to growth opportunity, product relevance, adoption, strategic positioning or a clear future narrative.";
  if (score >= 50) return "This score reflects mixed future potential. There may be upside drivers, but execution risk, competition or unclear adoption still matter.";
  return "This score reflects weaker future potential, usually because the growth path, demand picture, differentiation or long-term narrative is unclear.";
}

function scoreTone(score: number): "green" | "yellow" | "red" {
  if (score >= 65) return "green";
  if (score >= 50) return "yellow";
  return "red";
}

function formatAiUpdatedLabel(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "Unknown";

  return dt.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildLongSummary(args: {
  symbol: string;
  companyName: string;
  quote: Quote | null;
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
  trend: string;
  trendScore: { passed: number; total: number };
  rsi: number | null;
}) {
  const { symbol, companyName, quote, lastClose, ma50, ma200, trend, trendScore, rsi } = args;

  const companyLead = companyName ? `${companyName} (${symbol})` : symbol;
  const priceText =
    typeof quote?.price === "number" ? `$${quote.price.toFixed(2)}` : "an unavailable latest price";

  const ma50Pct = pctFromBase(lastClose, ma50);
  const ma200Pct = pctFromBase(lastClose, ma200);

  let trendLead = `${companyLead} currently looks mixed rather than cleanly directional.`;
  if (trend === "Uptrend") {
    if (trendScore.passed === trendScore.total) {
      trendLead = `${companyLead} is still trading in a constructive trend overall.`;
    } else if (trendScore.passed >= 2) {
      trendLead = `${companyLead} still shows some constructive trend features, even if the setup is not perfect.`;
    } else {
      trendLead = `${companyLead} is holding some bullish traits, but the chart no longer looks especially clean.`;
    }
  } else if (trend === "Downtrend") {
    if (trendScore.passed <= 1) {
      trendLead = `${companyLead} currently looks weaker on the chart and is not showing much trend strength.`;
    } else {
      trendLead = `${companyLead} is leaning weaker overall, although not every signal is fully bearish.`;
    }
  } else {
    if (trendScore.passed >= 2) {
      trendLead = `${companyLead} looks more range-bound than strongly trending, but there are still a few supportive signs on the chart.`;
    } else {
      trendLead = `${companyLead} currently looks more uncertain than directional, with a fairly mixed technical picture.`;
    }
  }

  let movingAverageText = "";
  if (typeof ma50Pct === "number" && typeof ma200Pct === "number") {
    movingAverageText =
      ` Price is ${ma50Pct >= 0 ? "trading above" : "trading below"} the 50-day moving average by ${Math.abs(ma50Pct).toFixed(1)}% ` +
      `and ${ma200Pct >= 0 ? "above" : "below"} the 200-day moving average by ${Math.abs(ma200Pct).toFixed(1)}%.`;
  } else if (typeof ma50Pct === "number") {
    movingAverageText =
      ` Price is ${ma50Pct >= 0 ? "trading above" : "trading below"} the 50-day moving average by ${Math.abs(ma50Pct).toFixed(1)}%.`;
  } else if (typeof ma200Pct === "number") {
    movingAverageText =
      ` Price is ${ma200Pct >= 0 ? "trading above" : "trading below"} the 200-day moving average by ${Math.abs(ma200Pct).toFixed(1)}%.`;
  }

  const trendParagraph =
    `${trendLead} The latest available price is ${priceText}, and ${trendScore.passed} of ${trendScore.total} core trend checks are currently passing.` +
    movingAverageText;

  let momentumParagraph = `${symbol} currently looks fairly balanced from a momentum perspective.`;

  if (typeof rsi === "number") {
    if (rsi >= 75) {
      momentumParagraph =
        `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which points to very strong short-term momentum but also a fairly extended setup. Stocks can stay strong for longer than expected, but this kind of reading often tells beginners not to confuse strength with low-risk entry timing.`;
    } else if (rsi >= 70) {
      momentumParagraph =
        `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which suggests stronger momentum and a more stretched short-term backdrop. Trend traders may still find that attractive, while more patient traders may prefer to wait and see whether the stock cools off first.`;
    } else if (rsi <= 25) {
      momentumParagraph =
        `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which places it in a deeply oversold zone. That can sometimes lead to bounce-watch setups, but it can also reflect genuine weakness, so the chart still needs proper confirmation rather than hope alone.`;
    } else if (rsi <= 30) {
      momentumParagraph =
        `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which suggests weaker momentum and a more oversold condition. Some traders may review this kind of setup for a rebound or buy-the-dip idea, but oversold readings by themselves do not guarantee a reversal.`;
    } else if (rsi >= 55) {
      momentumParagraph =
        `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which leans mildly positive without looking too stretched. In other words, momentum is supportive, but not yet extreme enough to dominate the entire chart read.`;
    } else if (rsi <= 45) {
      momentumParagraph =
        `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which leans a little softer than neutral. That does not automatically make the chart bearish, but it does suggest momentum is not especially strong right now.`;
    } else {
      momentumParagraph =
        `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which sits in a neutral range. That usually means momentum is not especially stretched in either direction, so traders may need to rely more on chart structure than on oscillator extremes alone.`;
    }
  }

  let structureParagraph =
    `This page is designed to help you quickly understand what the ${symbol} chart looks like before opening the full dashboard. The aim is not to tell you what to buy or sell, but to make it easier to judge whether the stock is trending cleanly, becoming stretched, or simply moving in a more awkward range.`;

  if (trend === "Uptrend") {
    structureParagraph =
      `For traders reviewing ${symbol} next, the key question is whether the trend still looks healthy or whether price has started to outrun itself. A strong uptrend can stay strong, but entries often become more difficult when price is already extended, so many traders will watch for pullbacks, support reactions, or fresh bases rather than chasing strength blindly.`;
  } else if (trend === "Downtrend") {
    structureParagraph =
      `For traders reviewing ${symbol} next, the main question is whether weakness is starting to stabilise or whether the chart still looks vulnerable to further downside. Some traders may watch for bounce attempts, but others will want to see stronger proof that the trend is improving before treating the stock as a cleaner setup.`;
  } else if (typeof rsi === "number" && rsi <= 30) {
    structureParagraph =
      `Because ${symbol} is showing a more oversold-style momentum reading inside a mixed structure, the next step is usually to watch how price behaves rather than assuming a rebound is guaranteed. Traders often want to see a stabilisation phase, a stronger reclaim, or some sign that selling pressure is starting to fade.`;
  } else if (typeof rsi === "number" && rsi >= 70) {
    structureParagraph =
      `Because ${symbol} is showing stronger momentum inside a more extended backdrop, the next step is often about timing rather than direction. A stock can keep pushing higher, but many traders will still watch for whether the move stays orderly or starts to look too stretched to offer a comfortable entry.`;
  }

  return {
    trendParagraph,
    momentumParagraph,
    structureParagraph,
  };
}



type ContextTone = "green" | "yellow" | "red" | "blue";

type TradeContextResult = {
  alignment: "Strong" | "Constructive" | "Early" | "Mixed" | "Conflict" | "Weak";
  tone: ContextTone;
  businessContext: string;
  technicalContext: string;
  riskContext: string;
  read: string;
  watch: string;
};

function buildTradeContext(args: {
  aiAnalysis: AiStockAnalysis | null;
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
  rsi: number | null;
  trendScore: { passed: number; total: number };
}): TradeContextResult {
  const { aiAnalysis, lastClose, ma50, ma200, rsi, trendScore } = args;

  const fundamentalsScore = aiAnalysis?.fundamentalsScore ?? null;
  const futurePotentialScore = aiAnalysis?.futurePotentialScore ?? null;
  const hasBusinessScores =
    typeof fundamentalsScore === "number" && typeof futurePotentialScore === "number";
  const businessBlend = hasBusinessScores
    ? (fundamentalsScore + futurePotentialScore) / 2
    : null;

  let businessContext = "Business context unavailable";
  let businessState: "supportive" | "mixed" | "weak" | "unknown" = "unknown";

  if (typeof businessBlend === "number") {
    if (businessBlend >= 70 && futurePotentialScore !== null && futurePotentialScore >= 65) {
      businessState = "supportive";
      businessContext = "Supportive business backdrop";
    } else if (businessBlend <= 45 || (fundamentalsScore !== null && fundamentalsScore <= 40)) {
      businessState = "weak";
      businessContext = "Weak business backdrop";
    } else {
      businessState = "mixed";
      businessContext = "Mixed business backdrop";
    }
  }

  const priceAbove50 =
    typeof lastClose === "number" && typeof ma50 === "number" ? lastClose > ma50 : false;
  const priceAbove200 =
    typeof lastClose === "number" && typeof ma200 === "number" ? lastClose > ma200 : false;
  const ma50Above200 = typeof ma50 === "number" && typeof ma200 === "number" ? ma50 > ma200 : false;
  const nearMa200 =
    typeof lastClose === "number" && typeof ma200 === "number" && ma200 > 0
      ? Math.abs(((lastClose - ma200) / ma200) * 100) <= 7
      : false;
  const oversold = typeof rsi === "number" && rsi <= 35;
  const extended = typeof rsi === "number" && rsi >= 70;

  let technicalContext = "Technical context unavailable";
  let technicalState: "supportive" | "early" | "mixed" | "weak" | "extended" = "mixed";

  if (priceAbove50 && priceAbove200 && ma50Above200) {
    technicalState = extended ? "extended" : "supportive";
    technicalContext = extended ? "Strong trend, short-term extended" : "Above key trend levels";
  } else if (priceAbove200 && (nearMa200 || !priceAbove50)) {
    technicalState = "early";
    technicalContext = "Near long-term trend support";
  } else if (!priceAbove200 && oversold) {
    technicalState = "early";
    technicalContext = "Oversold recovery watch";
  } else if (!priceAbove200 && trendScore.passed <= 1) {
    technicalState = "weak";
    technicalContext = "Below key trend levels";
  } else {
    technicalState = "mixed";
    technicalContext = "Mixed technical structure";
  }

  let riskContext = "No single edge is strong enough to dominate the read.";
  if (extended) riskContext = "Momentum may be stretched, so timing risk is higher.";
  else if (oversold) riskContext = "Oversold can bounce, but it still needs confirmation.";
  else if (businessState === "weak") riskContext = "The business read may limit confidence in technical bounces.";
  else if (businessState === "supportive" && technicalState === "weak") riskContext = "The story is better than the current chart structure.";

  let alignment: TradeContextResult["alignment"] = "Mixed";
  let tone: ContextTone = "yellow";
  let read = "The business read and chart structure are not giving a clean confirmation layer yet.";
  let watch = "Look for a clearer agreement between story, trend and momentum before drawing stronger conclusions.";

  if (businessState === "supportive" && technicalState === "supportive") {
    alignment = "Strong";
    tone = "green";
    read = "The broader story and the chart structure are broadly aligned.";
    watch = "Watch whether price can hold above the main moving averages without becoming too stretched.";
  } else if (businessState === "supportive" && technicalState === "extended") {
    alignment = "Constructive";
    tone = "green";
    read = "The story is supportive, but the chart may already be pricing in some strength.";
    watch = "Watch for controlled pullbacks, bases or continued volume support rather than chasing every move.";
  } else if (businessState === "supportive" && technicalState === "early") {
    alignment = "Early";
    tone = "blue";
    read = "The story is improving, but the chart still needs more technical confirmation.";
    watch = "Watch for a clean reclaim, support reaction, or improving momentum before treating it as stronger alignment.";
  } else if (businessState === "weak" && technicalState === "weak") {
    alignment = "Weak";
    tone = "red";
    read = "The business read and chart structure are both leaning cautious.";
    watch = "Watch for signs of stabilisation before trusting rebounds.";
  } else if (
    (businessState === "supportive" && technicalState === "weak") ||
    (businessState === "weak" && (technicalState === "supportive" || technicalState === "extended"))
  ) {
    alignment = "Conflict";
    tone = "yellow";
    read = "The story and chart are sending different messages.";
    watch = "Check which side resolves first: improving price structure or a stronger business/news catalyst.";
  }

  return {
    alignment,
    tone,
    businessContext,
    technicalContext,
    riskContext,
    read,
    watch,
  };
}

function formatMoneyCompact(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatEps(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
}

function formatSignedPercent(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatSignedMoney(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "-"}${formatMoneyCompact(Math.abs(value))}`;
}

function formatShortDate(value: string | null) {
  if (!value) return "—";
  const dt = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function earningsToneText(earnings: StockEarningsData | null, loading: boolean) {
  if (loading) return "Loading";
  if (!earnings?.hasStructuredData) return "Unavailable";
  return earnings.toneLabel;
}

function earningsMiniText(earnings: StockEarningsData | null, loading: boolean) {
  if (loading) return "Checking FMP earnings";
  if (!earnings?.hasStructuredData) return "Structured earnings unavailable";
  return earnings.reportDate ? `Latest report ${formatShortDate(earnings.reportDate)}` : "Latest report loaded";
}


function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function capContribution(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function earningsReadScore(earnings: StockEarningsData | null, loading: boolean) {
  if (loading || !earnings?.hasStructuredData) return null;

  if (typeof earnings.score === "number" && Number.isFinite(earnings.score)) {
    return earnings.score;
  }

  return null;
}

function earningsScoreTone(score: number | null): "green" | "yellow" | "red" {
  if (typeof score !== "number") return "yellow";
  if (score >= 65) return "green";
  if (score >= 45) return "yellow";
  return "red";
}

function earningsScaleSummary(earnings: StockEarningsData | null, loading: boolean) {
  if (loading) return "Checking latest earnings";
  if (!earnings?.hasStructuredData) return "Earnings data unavailable";

  const eps = formatSignedPercent(earnings.epsSurprisePercent);
  const revenue = formatSignedPercent(earnings.revenueSurprisePercent);

  return `EPS ${eps} · Revenue ${revenue}`;
}

function EarningsReadScale({
  earnings,
  loading,
}: {
  earnings: StockEarningsData | null;
  loading: boolean;
}) {
  const score = earningsReadScore(earnings, loading);
  const tone = earningsScoreTone(score);
  const markerLeft = `${typeof score === "number" ? score : 50}%`;

  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">
          ⚖️
        </div>
        <div
          style={{
            fontSize: 26,
            lineHeight: 1,
            fontWeight: 950,
            letterSpacing: "-0.06em",
            color: toneColor(tone),
            whiteSpace: "nowrap",
          }}
        >
          {typeof score === "number" ? `${score}/100` : "—"}
        </div>
      </div>

      <div
        aria-hidden="true"
        style={{
          position: "relative",
          marginTop: 12,
          height: 10,
          borderRadius: 999,
          background:
            "linear-gradient(90deg, rgba(239,68,68,0.95), rgba(250,204,21,0.95), rgba(34,197,94,0.95))",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.14)",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "50%",
            left: markerLeft,
            width: 18,
            height: 18,
            borderRadius: 999,
            background: "#f8fafc",
            border: `3px solid ${toneColor(tone)}`,
            transform: "translate(-50%, -50%)",
            boxShadow: "0 8px 18px rgba(0,0,0,0.32)",
          }}
        />
      </div>

      <div
        style={{
          marginTop: 9,
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 10,
          fontWeight: 900,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "rgba(226,232,240,0.58)",
        }}
      >
        <span>Weak</span>
        <span>Mixed</span>
        <span>Strong</span>
      </div>

      <div style={{ marginTop: 8, ...miniMetricSubStyle }}>
        {earningsScaleSummary(earnings, loading)}
      </div>
    </div>
  );
}

function earningsPanelTone(earnings: StockEarningsData | null): "green" | "yellow" | "red" {
  if (!earnings?.hasStructuredData) return "yellow";
  return earnings.tone;
}

function earningsMetricStyle(tone: "green" | "yellow" | "red" = "yellow"): React.CSSProperties {
  return {
    border: toneBorder(tone),
    borderRadius: 16,
    padding: 14,
    background: toneSoftBackground(tone),
    minWidth: 0,
  };
}

function yearlyEarningsBadgeStyle(tone: ScoreTone): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    border: toneBorder(tone),
    borderRadius: 12,
    padding: "10px 12px",
    background: toneSoftBackground(tone),
    fontSize: 13,
    fontWeight: 900,
  };
}

function StockEarningsPanel({
  symbol,
  earnings,
  loading,
}: {
  symbol: string;
  earnings: StockEarningsData | null;
  loading: boolean;
}) {
  const tone = earningsPanelTone(earnings);

  return (
    <section
      style={{
        marginTop: 18,
        border: toneBorder(tone),
        borderRadius: 18,
        padding: 18,
        background: toneSoftBackground(tone),
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 30px rgba(0,0,0,0.20)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 12px",
              borderRadius: 999,
              background: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
              border: "1px solid rgba(59,130,246,0.32)",
              color: "#dbeafe",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            <span aria-hidden="true" style={{ marginRight: 8 }}>🧾</span> LATEST EARNINGS
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 26,
              lineHeight: 1.12,
              letterSpacing: "-0.03em",
            }}
          >
            {symbol} earnings snapshot
          </h2>

          <p
            style={{
              margin: "10px 0 0 0",
              fontSize: 15,
              lineHeight: 1.75,
              opacity: 0.84,
              maxWidth: 760,
            }}
          >
            {loading
              ? "Loading the latest structured earnings data from Financial Modeling Prep."
              : earnings?.hasStructuredData
                ? `Latest completed report: ${formatShortDate(earnings.reportDate)}. Next expected earnings date: ${formatShortDate(earnings.nextEarningsDate)}.`
                : "Structured earnings data is not available for this symbol right now."}
          </p>
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            border: toneBorder(tone),
            borderRadius: 999,
            padding: "9px 12px",
            background: toneSoftBackground(tone),
            color: toneColor(tone),
            fontSize: 13,
            fontWeight: 950,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {loading ? "Loading" : earnings?.toneLabel ?? "Unavailable"}
        </div>
      </div>

      <div className="earningsMetricGrid" style={{ marginTop: 16 }}>
        <div style={earningsMetricStyle(metricToneFromPct(earnings?.epsSurprisePercent ?? null))}>
          <div style={miniLabelStyle}>Actual EPS</div>
          <div style={statValueStyle}>{loading ? "—" : formatEps(earnings?.actualEps ?? null)}</div>
          <div style={statMetaStyle}>Estimate: {loading ? "—" : formatEps(earnings?.estimatedEps ?? null)}</div>
        </div>

        <div style={earningsMetricStyle(metricToneFromPct(earnings?.epsSurprisePercent ?? null))}>
          <div style={miniLabelStyle}>EPS surprise</div>
          <div style={statValueStyle}>{loading ? "—" : formatEps(earnings?.epsSurprise ?? null)}</div>
          <div style={statMetaStyle}>{loading ? "—" : formatSignedPercent(earnings?.epsSurprisePercent ?? null)}</div>
        </div>

        <div style={earningsMetricStyle(metricToneFromPct(earnings?.revenueSurprisePercent ?? null))}>
          <div style={miniLabelStyle}>Revenue</div>
          <div style={statValueStyle}>{loading ? "—" : formatMoneyCompact(earnings?.revenue ?? null)}</div>
          <div style={statMetaStyle}>Estimate: {loading ? "—" : formatMoneyCompact(earnings?.revenueEstimate ?? null)}</div>
        </div>

        <div style={earningsMetricStyle(metricToneFromPct(earnings?.revenueSurprisePercent ?? null))}>
          <div style={miniLabelStyle}>Revenue surprise</div>
          <div style={statValueStyle}>{loading ? "—" : formatSignedMoney(earnings?.revenueSurprise ?? null)}</div>
          <div style={statMetaStyle}>{loading ? "—" : formatSignedPercent(earnings?.revenueSurprisePercent ?? null)}</div>
        </div>

        <div style={earningsMetricStyle(metricToneFromPct(earnings?.grossMargin ?? null))}>
          <div style={miniLabelStyle}>Gross margin</div>
          <div style={statValueStyle}>{loading ? "—" : formatSignedPercent(earnings?.grossMargin ?? null)}</div>
          <div style={statMetaStyle}>If available from FMP</div>
        </div>

        <div style={earningsMetricStyle(metricToneFromPct(earnings?.operatingMargin ?? null))}>
          <div style={miniLabelStyle}>Operating margin</div>
          <div style={statValueStyle}>{loading ? "—" : formatSignedPercent(earnings?.operatingMargin ?? null)}</div>
          <div style={statMetaStyle}>If available from FMP</div>
        </div>
      </div>

      {earnings?.recentReports?.length ? (
        <div style={{ marginTop: 16, ...statCardStyle }}>
          <div style={miniLabelStyle}>Recent earnings trend</div>
          <div className="earningsDotGrid" style={{ marginTop: 12 }}>
            {earnings.recentReports.map((item) => (
              <div key={`${item.label}-${item.date ?? ""}`} style={{ display: "grid", justifyItems: "center", gap: 7 }}>
                <span
                  title={`${item.label}: ${item.toneLabel}`}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    background: toneColor(item.tone),
                    boxShadow: `0 0 0 5px ${item.tone === "green" ? "rgba(34,197,94,0.12)" : item.tone === "red" ? "rgba(239,68,68,0.12)" : "rgba(250,204,21,0.12)"}`,
                  }}
                />
                <span style={{ fontSize: 11, fontWeight: 900, opacity: 0.86 }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {earnings?.yearlySummaries?.length ? (
        <div style={{ marginTop: 16, ...statCardStyle }}>
          <div style={miniLabelStyle}>Yearly earnings read</div>
          <div className="yearlyEarningsGrid" style={{ marginTop: 12 }}>
            {earnings.yearlySummaries.map((item) => (
              <div key={item.year} style={yearlyEarningsBadgeStyle(item.tone)}>
                <strong>{item.year}</strong>
                <span>{item.toneLabel}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6, opacity: 0.6 }}>
        {earnings?.sourceNote ?? "Structured earnings data is provided by Financial Modeling Prep when available."}
      </div>
    </section>
  );
}

function trendCheckIconStyle(pass: boolean): React.CSSProperties {
  return {
    color: pass ? "#4ade80" : "#f87171",
    fontWeight: 950,
    marginRight: 7,
  };
}

export default function StockSymbolPageClient({
  symbol,
  aiAnalysis,
}: StockSymbolPageClientProps) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [companyName, setCompanyName] = useState("");
const [priceLoading, setPriceLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<StockEarningsData | null>(null);
  const [earningsLoading, setEarningsLoading] = useState(true);
  const [valuation, setValuation] = useState<StockValuationData | null>(null);
  const [valuationLoading, setValuationLoading] = useState(true);
  const [openScoreHelp, setOpenScoreHelp] = useState<"fundamentals" | "future" | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
setPriceLoading(true);
      setErr(null);

      try {
        const [quoteRes, historyRes, symbolsRes] = await Promise.all([
          fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }),
          fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&days=900`, {
            cache: "no-store",
          }),
          fetch(`/api/symbols?q=${encodeURIComponent(symbol)}`, { cache: "no-store" }),
        ]);

        if (!quoteRes.ok) throw new Error("Quote fetch failed");
        if (!historyRes.ok) throw new Error("History fetch failed");

        const quoteData = (await quoteRes.json()) as Quote;
        const historyData = (await historyRes.json()) as { symbol: string; points: any[] };

        let name = "";
        if (symbolsRes.ok) {
          const symbolsData = (await symbolsRes.json()) as { results?: SymbolResult[] };
          const exact = (symbolsData.results ?? []).find(
            (r) => (r.symbol ?? "").toUpperCase() === symbol.toUpperCase()
          );
          name = exact?.name ?? "";
        }

        if (cancelled) return;

        const ptsRaw = Array.isArray(historyData.points) ? historyData.points : [];
        const pts: Point[] = ptsRaw
          .map((p: any) => ({
            date: String(p?.date ?? ""),
            close: Number(p?.close),
            high: p?.high == null ? undefined : Number(p.high),
            low: p?.low == null ? undefined : Number(p.low),
            volume: p?.volume == null ? undefined : Number(p.volume),
          }))
          .filter((p) => p.date && Number.isFinite(p.close));

        setQuote(quoteData);
        setHistory(pts);
        setCompanyName(name);
      } catch {
        if (cancelled) return;
        setErr("Failed to load stock page.");
        setQuote(null);
        setHistory([]);
        setCompanyName("");
      } finally {
if (!cancelled) setPriceLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;

    async function loadEarnings() {
      setEarningsLoading(true);

      try {
        const res = await fetch(`/api/stock-earnings/${encodeURIComponent(symbol)}?t=${Date.now()}`, {
          cache: "no-store",
        });

        if (!res.ok) throw new Error("Earnings fetch failed");

        const data = (await res.json()) as StockEarningsData;
        if (!cancelled) setEarnings(data);
      } catch {
        if (!cancelled) setEarnings(null);
      } finally {
        if (!cancelled) setEarningsLoading(false);
      }
    }

    loadEarnings();

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;

    async function loadValuation() {
      setValuationLoading(true);

      try {
        const res = await fetch(`/api/stock-valuation/${encodeURIComponent(symbol)}?t=${Date.now()}`, {
          cache: "no-store",
        });

        if (!res.ok) throw new Error("Valuation fetch failed");

        const data = (await res.json()) as StockValuationData;
        if (!cancelled) setValuation(data);
      } catch {
        if (!cancelled) setValuation(null);
      } finally {
        if (!cancelled) setValuationLoading(false);
      }
    }

    loadValuation();

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const closes = useMemo(() => history.map((p) => p.close), [history]);
  const ma50 = useMemo(() => movingAverage(closes, 50), [closes]);
  const ma200 = useMemo(() => movingAverage(closes, 200), [closes]);
  const rsi14 = useMemo(() => rsiWilder(closes, 14), [closes]);

  const lastClose = history.length ? history[history.length - 1].close : null;
  const lastMA50 = lastNum(ma50);
  const lastMA200 = lastNum(ma200);
  const lastRsi = lastNum(rsi14);

  const trendScore = useMemo(
    () =>
      buildTrendScore({
        lastClose,
        ma50: typeof lastMA50 === "number" ? lastMA50 : null,
        ma200: typeof lastMA200 === "number" ? lastMA200 : null,
      }),
    [lastClose, lastMA50, lastMA200]
  );

  const trend = useMemo(
    () =>
      trendLabel({
        lastClose,
        ma50: typeof lastMA50 === "number" ? lastMA50 : null,
        ma200: typeof lastMA200 === "number" ? lastMA200 : null,
      }),
    [lastClose, lastMA50, lastMA200]
  );

  const trendTone: "green" | "yellow" | "red" =
    trendScore.passed >= 3 ? "green" : trendScore.passed === 2 ? "yellow" : "red";

  const longSummary = useMemo(
    () =>
      buildLongSummary({
        symbol,
        companyName,
        quote,
        lastClose,
        ma50: typeof lastMA50 === "number" ? lastMA50 : null,
        ma200: typeof lastMA200 === "number" ? lastMA200 : null,
        trend,
        trendScore,
        rsi: typeof lastRsi === "number" ? lastRsi : null,
      }),
    [symbol, companyName, quote, lastClose, lastMA50, lastMA200, trend, trendScore, lastRsi]
  );

  const ma50Pct = pctFromBase(lastClose, typeof lastMA50 === "number" ? lastMA50 : null);
  const ma200Pct = pctFromBase(lastClose, typeof lastMA200 === "number" ? lastMA200 : null);

  const macroSupport = useMemo(() => computeMacroSupport(history, lastClose), [history, lastClose]);
  const macdSignal = useMemo(() => buildMacd(closes), [closes]);

  const tradeContext = useMemo(
    () =>
      buildTradeContext({
        aiAnalysis,
        lastClose,
        ma50: typeof lastMA50 === "number" ? lastMA50 : null,
        ma200: typeof lastMA200 === "number" ? lastMA200 : null,
        rsi: typeof lastRsi === "number" ? lastRsi : null,
        trendScore,
      }),
    [aiAnalysis, lastClose, lastMA50, lastMA200, lastRsi, trendScore]
  );

  return (
<main
  onClick={() => setOpenScoreHelp(null)}
  style={{
    minHeight: "100vh",
    background:
      trendScore.passed >= 3
        ? "radial-gradient(circle at top left, rgba(37,99,235,0.18), transparent 22%), radial-gradient(circle at top right, rgba(34,197,94,0.16), transparent 24%), #06080d"
        : trendScore.passed === 2
        ? "radial-gradient(circle at top left, rgba(37,99,235,0.16), transparent 22%), radial-gradient(circle at top right, rgba(250,204,21,0.14), transparent 24%), #06080d"
        : "radial-gradient(circle at top left, rgba(37,99,235,0.14), transparent 22%), radial-gradient(circle at top right, rgba(239,68,68,0.16), transparent 24%), #06080d",
    color: "#f1f5f9",
    fontFamily: "system-ui, Arial",
  }}
>
      <div className="wrap">
        <div className="analysisTopUtilityRow" style={topUtilityRowStyle}>
  <div className="analysisTopUtilityInner" style={topUtilityInnerStyle}>
    <Link
      href={`/?symbol=${encodeURIComponent(symbol)}`}
      className="analysisTopBtn"
      style={topUtilityBtnStyle("gold")}
    >
      📈 Dashboard
    </Link>

    <Link
      href="/platforms"
      className="analysisTopBtn"
      style={topUtilityBtnStyle("green")}
    >
      🏦 Platforms
    </Link>

    <Link
      href="/pickers"
      className="analysisTopBtn"
      style={topUtilityBtnStyle("red")}
    >
      📊 Stock Pickers
    </Link>

    <Link
      href="/learn"
      className="analysisTopBtn"
      style={topUtilityBtnStyle("blue")}
    >
      📘 Learn
    </Link>
  </div>
</div>

        <section
          style={{
            border: "1px solid rgba(59,130,246,0.24)",
            borderRadius: 22,
            padding: 20,
            background:
              "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(7,11,22,0.98))",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 34px rgba(0,0,0,0.30)",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 999,
              border: "1px solid rgba(59,130,246,0.32)",
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08))",
              fontSize: 12,
              fontWeight: 950,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#dbeafe",
            }}
          >
            <span aria-hidden="true">📈</span> STOCK ANALYSIS PAGE
          </div>

          <div className="stockAnalysisHeroGrid">
            <div className="stockAnalysisHeroCopy">
              <h1
                style={{
                  margin: "14px 0 0 0",
                  fontSize: 34,
                  lineHeight: 1.16,
                  fontWeight: 800,
                  letterSpacing: "-0.04em",
                }}
              >
                {symbol} Stock Analysis, Chart Overview & Technical Summary
              </h1>

              <p
                style={{
                  marginTop: 12,
                  fontSize: 16,
                  lineHeight: 1.7,
                  opacity: 0.84,
                  maxWidth: 760,
                }}
              >
                {companyName || `${symbol} technical overview`} {companyName ? `(${symbol})` : ""}.
                Review price trend, moving averages, momentum and earnings balance in one cleaner stock read.
              </p>

              <div style={{ marginTop: 18, maxWidth: 520 }}>
                <StockTickerJump currentSymbol={symbol} />
              </div>

              <div
                style={{
                  marginTop: 16,
                  borderRadius: 16,
                  border: "1px solid rgba(34,197,94,0.28)",
                  background:
                    "linear-gradient(135deg, rgba(34,197,94,0.11), rgba(8,18,30,0.86))",
                  padding: "14px 16px",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  maxWidth: 780,
                }}
              >
                <div style={circleIconStyle("green")}>💡</div>
                <div style={{ fontSize: 14, lineHeight: 1.65, opacity: 0.9 }}>
                  <strong style={{ color: "#86efac" }}>Simple view:</strong> this page combines price action, trend checks and a compact earnings balance so you can judge whether {symbol} looks constructive, weak, mixed, or simply waiting for confirmation.
                </div>
              </div>
            </div>

            {!priceLoading && !err ? (
              <div className="stockAnalysisSidePanel">
                <div className="stockMetricMatrix">
                  <div style={alignedMetricCardStyle(trendTone)}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <div style={miniLabelStyle}>Trend score</div>
                      <div style={circleIconStyle(trendTone)}>{trendTone === "green" ? "↗" : trendTone === "red" ? "↘" : "↔"}</div>
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 32,
                        lineHeight: 1,
                        fontWeight: 950,
                        letterSpacing: "-0.06em",
                        color: toneColor(trendTone),
                      }}
                    >
                      {trendScore.passed}/{trendScore.total}
                    </div>
                    <div style={miniMetricSubStyle}>Core trend checks passing</div>
                  </div>

                  <div style={alignedMetricCardStyle("blue")}>
                    <div style={miniLabelStyle}>Last price</div>
                    <div style={miniMetricValueStyle}>
                      {typeof quote?.price === "number" ? `$${quote.price.toFixed(2)}` : "—"}
                    </div>
                    <div style={miniMetricSubStyle}>
                      {quote?.date && quote?.time ? `${quote.date} ${quote.time}` : "Timestamp unavailable"}
                    </div>
                  </div>

                  <div style={alignedMetricCardStyle(valuationTone(valuation?.peRatio))}>
                    <div style={miniLabelStyle}>Valuation</div>
                    <div style={miniMetricValueStyle}>
                      {valuationLoading ? "Loading…" : `P/E ${formatValuationMultiple(valuation?.peRatio)}`}
                    </div>
                    <div style={miniMetricSubStyle}>
                      P/S {formatValuationMultiple(valuation?.priceToSalesRatio)} · P/B {formatValuationMultiple(valuation?.priceToBookRatio)}
                    </div>
                  </div>

                  <Link
                    href={`/stock/${encodeURIComponent(symbol)}/earnings`}
                    className="earningsReadHeroCard"
                    style={{
                      ...alignedMetricCardStyle(earningsScoreTone(earningsReadScore(earnings, earningsLoading))),
                      display: "block",
                      textDecoration: "none",
                      color: "inherit",
                      cursor: "pointer",
                      transition:
                        "transform 140ms ease, filter 140ms ease, border-color 140ms ease, box-shadow 140ms ease",
                    }}
                    aria-label={`Open ${symbol} earnings page`}
                    title={`Open ${symbol} earnings page`}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <div style={miniLabelStyle}>Earnings read</div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 950,
                          color: "rgba(219,234,254,0.86)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Open →
                      </span>
                    </div>
                    <EarningsReadScale earnings={earnings} loading={earningsLoading} />
                  </Link>
                </div>

                <div className="trendContextRow">
                  <div className="trendChecksStrip">
                    <div style={miniLabelStyle}>Trend checks</div>
                    <div className="trendChecksGrid">
                      <div style={{ opacity: 0.9 }}>
                        <span
                          style={trendCheckIconStyle(
                            lastClose !== null && lastMA50 !== null && lastClose > lastMA50
                          )}
                        >
                          {lastClose !== null && lastMA50 !== null && lastClose > lastMA50 ? "✓" : "✕"}
                        </span>
                        Price above MA50
                      </div>

                      <div style={{ opacity: 0.9 }}>
                        <span
                          style={trendCheckIconStyle(
                            lastClose !== null && lastMA200 !== null && lastClose > lastMA200
                          )}
                        >
                          {lastClose !== null && lastMA200 !== null && lastClose > lastMA200 ? "✓" : "✕"}
                        </span>
                        Price above MA200
                      </div>

                      <div style={{ opacity: 0.9 }}>
                        <span
                          style={trendCheckIconStyle(
                            lastMA50 !== null && lastMA200 !== null && lastMA50 > lastMA200
                          )}
                        >
                          {lastMA50 !== null && lastMA200 !== null && lastMA50 > lastMA200 ? "✓" : "✕"}
                        </span>
                        MA50 above MA200
                      </div>
                    </div>
                  </div>

                  <div style={alignedMetricCardStyle(trendTone)}>
                    <div style={miniLabelStyle}>Regime</div>
                    <div style={miniMetricValueStyle}>{trend}</div>
                    <div style={miniMetricSubStyle}>Overall chart structure</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
{priceLoading ? (
  <div style={{ marginTop: 18, opacity: 0.8 }}>Loading chart and price data…</div>
) : err ? (
            <div style={{ marginTop: 18, opacity: 0.8 }}>{err}</div>
          ) : (
            <>

{aiAnalysis ? (
                <section
                  style={{
                    marginTop: 18,
                    border: "1px solid rgba(59,130,246,0.22)",
                    borderRadius: 18,
                    padding: 18,
                    background:
                      "linear-gradient(180deg, rgba(8,14,28,0.98), rgba(6,10,18,0.98))",
                  }}
                >
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "7px 12px",
                      borderRadius: 999,
                      background:
                        "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
                      border: "1px solid rgba(59,130,246,0.32)",
                      color: "#dbeafe",
                      fontWeight: 950,
                      letterSpacing: "0.08em",
                      fontSize: 12,
                    }}
                  >
                    COMPANY OUTLOOK
                  </div>

                  <h2
                    style={{
                      margin: "14px 0 0 0",
                      fontSize: 26,
                      lineHeight: 1.12,
                      letterSpacing: "-0.03em",
                    }}
                  >
                    Company snapshot, outlook scores and future potential for {symbol}
                  </h2>

                  <p
                    style={{
                      margin: "10px 0 0 0",
                      lineHeight: 1.7,
                      opacity: 0.82,
                      maxWidth: 860,
                      fontSize: 15,
                    }}
                  >
                    Review a broader business snapshot, outlook summary, and key points investors may want to watch alongside the live chart view.
                  </p>

                  <div
                    style={{
                      marginTop: 16,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 14,
                    }}
                  >
                    <div style={{ ...scoreOverviewCardStyle(scoreTone(aiAnalysis.fundamentalsScore)), overflow: "visible" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
<div style={miniLabelStyle}>
  Fundamentals score{" "}
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      setOpenScoreHelp(openScoreHelp === "fundamentals" ? null : "fundamentals");
    }}
    style={scoreHelpButtonStyle}
  >
    ?
  </button>
</div>
                        <div style={circleIconStyle(scoreTone(aiAnalysis.fundamentalsScore))}>🧱</div>
                      </div>
                      {openScoreHelp === "fundamentals" ? (
                        <div onClick={(e) => e.stopPropagation()} style={scoreHelpInlineBoxStyle}>
                          {scoreExplainText("fundamentals", aiAnalysis.fundamentalsScore)}
                        </div>
                      ) : null}
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 34,
                          fontWeight: 950,
                          color: toneColor(scoreTone(aiAnalysis.fundamentalsScore)),
                        }}
                      >
                        {aiAnalysis.fundamentalsScore}/100
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.76 }}>
                        {scoreBandLabel(aiAnalysis.fundamentalsScore)}
                      </div>
                    </div>

                   <div style={{ ...scoreOverviewCardStyle(scoreTone(aiAnalysis.futurePotentialScore)), overflow: "visible" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
<div style={miniLabelStyle}>
  Future potential score{" "}
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      setOpenScoreHelp(openScoreHelp === "future" ? null : "future");
    }}
    style={scoreHelpButtonStyle}
  >
    ?
  </button>
</div>
                        <div style={circleIconStyle(scoreTone(aiAnalysis.futurePotentialScore))}>🚀</div>
                      </div>
                      {openScoreHelp === "future" ? (
                        <div onClick={(e) => e.stopPropagation()} style={scoreHelpInlineBoxStyle}>
                          {scoreExplainText("future", aiAnalysis.futurePotentialScore)}
                        </div>
                      ) : null}
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 34,
                          fontWeight: 950,
                          color: toneColor(scoreTone(aiAnalysis.futurePotentialScore)),
                        }}
                      >
                        {aiAnalysis.futurePotentialScore}/100
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.76 }}>
                        {scoreBandLabel(aiAnalysis.futurePotentialScore)}
                      </div>
                    </div>

                    <div style={scoreOverviewCardStyle("blue")}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <div style={miniLabelStyle}>Summary updated</div>
                        <div style={circleIconStyle("blue")}>⏱</div>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 950 }}>
                        {formatAiUpdatedLabel(aiAnalysis.generatedAt)}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.76 }}>
                        Refreshed separately from live price and chart data.
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 18,
                      display: "grid",
                      gap: 18,
                    }}
                  >
                    <article style={articleStyle}>
                      <h3 style={articleHeadingStyle}><span style={articleIconStyle("blue")}>🏢</span> What this company broadly does</h3>
                      <p style={articleTextStyle}>{aiAnalysis.businessSummary}</p>
                    </article>

                    <article style={articleStyle}>
                      <h3 style={articleHeadingStyle}><span style={articleIconStyle("green")}>🧱</span> Fundamentals-style read</h3>
                      <p style={articleTextStyle}>{aiAnalysis.fundamentalsSummary}</p>
                    </article>

                    <article style={articleStyle}>
                      <h3 style={articleHeadingStyle}><span style={articleIconStyle("yellow")}>🚀</span> Future potential analysis</h3>
                      <p style={articleTextStyle}>{aiAnalysis.futurePotentialSummary}</p>
                    </article>
                  </div>

                  <div
                    style={{
                      marginTop: 18,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 14,
                    }}
                  >
                    <div style={factorCardStyle("green")}>
                      <div style={factorHeaderStyle}>
                        <div style={circleIconStyle("green")}>↗</div>
                        <div style={pillStyle("green")}>Bullish factors</div>
                      </div>
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        {aiAnalysis.bullishFactors.map((item) => (
                          <div key={item} style={articleTextStyle}>
                            • {item}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={factorCardStyle("red")}>
                      <div style={factorHeaderStyle}>
                        <div style={circleIconStyle("red")}>🛡</div>
                        <div style={pillStyle("red")}>Risk factors</div>
                      </div>
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        {aiAnalysis.bearishFactors.map((item) => (
                          <div key={item} style={articleTextStyle}>
                            • {item}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={factorCardStyle("yellow")}>
                      <div style={factorHeaderStyle}>
                        <div style={circleIconStyle("yellow")}>👁</div>
                        <div style={pillStyle("yellow")}>WHAT TO WATCH</div>
                      </div>
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        {aiAnalysis.watchPoints.map((item) => (
                          <div key={item} style={articleTextStyle}>
                            • {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              <section
                style={{
                  marginTop: 18,
                  border: "1px solid rgba(59,130,246,0.22)",
                  borderRadius: 18,
                  padding: 18,
                  background:
                    "linear-gradient(180deg, rgba(8,14,28,0.98), rgba(6,10,18,0.98))",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "7px 12px",
                    borderRadius: 999,
                    background:
                      "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
                    border: "1px solid rgba(59,130,246,0.32)",
                    color: "#dbeafe",
                    fontWeight: 950,
                    letterSpacing: "0.08em",
                    fontSize: 12,
                  }}
                >
                  <span aria-hidden="true" style={{ marginRight: 8 }}>📊</span> CHART VIEW
                </div>

                <h2
                  style={{
                    margin: "14px 0 0 0",
                    fontSize: 26,
                    lineHeight: 1.12,
                    letterSpacing: "-0.03em",
                  }}
                >
                  {symbol} chart with MA50 and MA200
                </h2>

                <p
                  style={{
                    margin: "10px 0 0 0",
                    lineHeight: 1.7,
                    opacity: 0.82,
                    maxWidth: 820,
                    fontSize: 15,
                  }}
                >
                  Use this chart to quickly review recent price action, moving averages and overall trend structure before opening the full dashboard.
                </p>
                
                <div style={{ marginTop: 16 }}>
                  <StockPriceChart
                    symbol={symbol}
                    data={history.slice(-240)}
                    ma50={ma50.slice(-240)}
                    ma200={ma200.slice(-240)}
                    height={360}
                  />
                </div>

                <div
                  style={{
                    marginTop: 16,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ fontSize: 13, opacity: 0.74 }}>
                    Prefer the full tool layout? Open the live dashboard view for {symbol}, view the latest headlines, or open it on TradingView.
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <Link
                      href={`/?symbol=${encodeURIComponent(symbol)}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "12px 16px",
                        borderRadius: 14,
                        border: "1px solid rgba(59,130,246,0.45)",
                        background:
                          "linear-gradient(135deg, rgba(59,130,246,0.22), rgba(37,99,235,0.12))",
                        color: "#eff6ff",
                        textDecoration: "none",
                        fontWeight: 900,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Open {symbol} in Dashboard →
                    </Link>

                    <Link
                      href={`/stock/${encodeURIComponent(symbol)}/news`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "12px 16px",
                        borderRadius: 14,
                        border: "1px solid rgba(248,113,113,0.34)",
                        background:
                        "linear-gradient(135deg, rgba(248,113,113,0.18), rgba(185,28,28,0.10))",
                        color: "#fee2e2",
                        textDecoration: "none",
                        fontWeight: 900,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Latest News on {symbol} →
                    </Link>

                    <a
                      href={`/api/go/tradingview?symbol=${encodeURIComponent(symbol)}`}
                      target="_blank"
                      rel="noopener noreferrer sponsored nofollow"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "12px 16px",
                        borderRadius: 14,
                        border: "1px solid rgba(34,197,94,0.40)",
                        background:
                          "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.10))",
                        color: "#ecfdf5",
                        textDecoration: "none",
                        fontWeight: 900,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Open in TradingView ↗
                    </a>
                  </div>
                </div>
              </section>

              <section
                style={{
                  marginTop: 18,
                  display: "grid",
                  gap: 18,
                }}
              >
                <article style={summaryArticleStyle("blue")}>
                  <h2 style={articleHeadingStyle}><span style={articleIconStyle("blue")}>🧭</span> Trend summary for {symbol}</h2>
                  <p style={articleTextStyle}>{longSummary.trendParagraph}</p>
                </article>

                <article style={summaryArticleStyle("yellow")}>
                  <h2 style={articleHeadingStyle}><span style={articleIconStyle("yellow")}>⚡</span> Momentum and stretch context</h2>
                  <p style={articleTextStyle}>{longSummary.momentumParagraph}</p>
                </article>

                <article style={summaryArticleStyle("green")}>
                  <h2 style={articleHeadingStyle}><span style={articleIconStyle("green")}>👁</span> What traders may watch next</h2>
                  <p style={articleTextStyle}>{longSummary.structureParagraph}</p>
                </article>
              </section>

              <section
                style={{
                  marginTop: 18,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 14,
                }}
              >
                <div style={technicalMetricCardStyle(metricToneFromPct(ma50Pct))}>
                  <div style={metricHeaderStyle}>
                    <div style={statLabelStyle}>MA50</div>
                    <div style={circleIconStyle(metricToneFromPct(ma50Pct))}>50</div>
                  </div>
                  <div style={statValueStyle}>
                    {typeof lastMA50 === "number" ? `$${lastMA50.toFixed(2)}` : "—"}
                  </div>
                  <div style={statMetaStyle}>
                    {typeof ma50Pct === "number"
                      ? `${ma50Pct >= 0 ? "+" : ""}${ma50Pct.toFixed(2)}% vs price`
                      : "Distance unavailable"}
                  </div>
                </div>

                <div style={technicalMetricCardStyle(metricToneFromPct(ma200Pct))}>
                  <div style={metricHeaderStyle}>
                    <div style={statLabelStyle}>MA200</div>
                    <div style={circleIconStyle(metricToneFromPct(ma200Pct))}>200</div>
                  </div>
                  <div style={statValueStyle}>
                    {typeof lastMA200 === "number" ? `$${lastMA200.toFixed(2)}` : "—"}
                  </div>
                  <div style={statMetaStyle}>
                    {typeof ma200Pct === "number"
                      ? `${ma200Pct >= 0 ? "+" : ""}${ma200Pct.toFixed(2)}% vs price`
                      : "Distance unavailable"}
                  </div>
                </div>

                <div style={technicalMetricCardStyle(rsiTone(typeof lastRsi === "number" ? lastRsi : null))}>
                  <div style={metricHeaderStyle}>
                    <div style={statLabelStyle}>RSI(14)</div>
                    <div style={circleIconStyle(rsiTone(typeof lastRsi === "number" ? lastRsi : null))}>⚡</div>
                  </div>
                  <div style={statValueStyle}>
                    {typeof lastRsi === "number" ? lastRsi.toFixed(1) : "—"}
                  </div>
                  <div style={statMetaStyle}>
                    {typeof lastRsi === "number"
                      ? lastRsi >= 70
                        ? "Overbought zone"
                        : lastRsi <= 30
                        ? "Oversold zone"
                        : "Neutral zone"
                      : "Momentum unavailable"}
                  </div>
                </div>
              </section>


              <section
                aria-label={`${symbol} macro support and MACD technical levels`}
                style={{
                  marginTop: 14,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 14,
                }}
              >
                <div style={technicalMetricCardStyle(supportTone(macroSupport?.distancePct ?? null))}>
                  <div style={metricHeaderStyle}>
                    <div style={statLabelStyle}>Macro Support</div>
                    <div style={circleIconStyle(supportTone(macroSupport?.distancePct ?? null))}>↧</div>
                  </div>
                  <div style={statValueStyle}>
                    {macroSupport
                      ? `$${macroSupport.lower.toFixed(2)}–$${macroSupport.upper.toFixed(2)}`
                      : "Not clear"}
                  </div>
                  <div style={statMetaStyle}>
                    {macroSupport
                      ? `${macroSupport.distancePct.toFixed(1)}% below price`
                      : "No repeated weekly support zone found"}
                  </div>
                </div>

                <div style={technicalMetricCardStyle(supportQualityTone(macroSupport))}>
                  <div style={metricHeaderStyle}>
                    <div style={statLabelStyle}>Support Quality</div>
                    <div style={circleIconStyle(supportQualityTone(macroSupport))}>✓</div>
                  </div>
                  <div style={statValueStyle}>{macroSupport ? `${macroSupport.touches}` : "—"}</div>
                  <div style={statMetaStyle}>
                    {macroSupport
                      ? `${macroSupport.touches === 1 ? "touch" : "touches"} • ${macroSupport.volumeRatio === null ? "volume n/a" : `${macroSupport.volumeRatio.toFixed(1)}x zone volume`}`
                      : "Support quality unavailable"}
                  </div>
                </div>

                <div style={technicalMetricCardStyle(macdSignal?.tone ?? "yellow")}>
                  <div style={metricHeaderStyle}>
                    <div style={statLabelStyle}>MACD Signal</div>
                    <div style={circleIconStyle(macdSignal?.tone ?? "yellow")}>〽️</div>
                  </div>
                  <div style={statValueStyle}>{macdSignal?.label ?? "—"}</div>
                  <div style={statMetaStyle}>{macdSignal?.meta ?? "Momentum unavailable"}</div>
                </div>
              </section>

              <section
                style={{
                  marginTop: 22,
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 20,
                  padding: 20,
                  background:
                    "linear-gradient(180deg, rgba(9,13,20,0.92), rgba(7,10,16,0.96))",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "7px 12px",
                    borderRadius: 999,
                    background:
                      "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(16,185,129,0.08))",
                    border: "1px solid rgba(34,197,94,0.26)",
                    color: "#dcfce7",
                    fontWeight: 950,
                    letterSpacing: "0.08em",
                    fontSize: 12,
                  }}
                >
                  LEARN MORE
                </div>

                <h2
                  style={{
                    margin: "14px 0 0 0",
                    fontSize: 24,
                    lineHeight: 1.15,
                    letterSpacing: "-0.03em",
                  }}
                >
                  Learn the indicators behind this stock page
                </h2>

                <div className="learnGrid" style={{ marginTop: 16 }}>
                  <Link href="/learn/moving-averages" style={learnCardStyle("blue")}>
                    <div style={{ fontSize: 17, fontWeight: 950 }}>📏 Moving Averages</div>
                    <div style={learnTextStyle}>
                      Learn how traders use MA50 and MA200 to judge medium and long-term structure.
                    </div>
                  </Link>

                  <Link href="/learn/rsi" style={learnCardStyle("green")}>
                    <div style={{ fontSize: 17, fontWeight: 950 }}>⚡ RSI Guide</div>
                    <div style={learnTextStyle}>
                      Understand how RSI highlights momentum, overbought conditions and oversold conditions.
                    </div>
                  </Link>

                  <Link href="/learn/macd" style={learnCardStyle("red")}>
                    <div style={{ fontSize: 17, fontWeight: 950 }}>〽️ MACD Guide</div>
                    <div style={learnTextStyle}>
                      Explore how MACD helps traders read momentum strength and weakening trend behaviour.
                    </div>
                  </Link>
                </div>
              </section>

              <section
  style={{
    marginTop: 22,
    border: "1px solid rgba(59,130,246,0.22)",
    borderRadius: 20,
    padding: 20,
    background:
      "linear-gradient(180deg, rgba(8,14,28,0.98), rgba(6,10,18,0.98))",
  }}
>
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "7px 12px",
      borderRadius: 999,
      background:
        "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
      border: "1px solid rgba(59,130,246,0.32)",
      color: "#dbeafe",
      fontWeight: 950,
      letterSpacing: "0.08em",
      fontSize: 12,
    }}
  >
    EXPLORE MORE
  </div>

  <h2
    style={{
      margin: "14px 0 0 0",
      fontSize: 24,
      lineHeight: 1.15,
      letterSpacing: "-0.03em",
    }}
  >
    Explore more stock opportunities
  </h2>

  <div
    style={{
      marginTop: 16,
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 12,
    }}
  >
    <Link href="/oversold-stocks-today" style={learnCardStyle("green")}>
      🟢 Oversold Stocks (Potential Rebounds)
    </Link>

    <Link href="/overbought-stocks-today" style={learnCardStyle("red")}>
      🔴 Overbought Stocks (Pullback Watch)
    </Link>

    <Link href="/stocks-ready-to-break-out" style={learnCardStyle("blue")}>
      🔵 Breakout Stocks
    </Link>

<Link href="/stocks-near-200-day-moving-average" style={learnCardStyle("yellow")}>
  🟡 Stocks Near 200-Day Moving Average
</Link>
  </div>
</section>

              <section
                style={{
                  marginTop: 22,
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 20,
                  padding: 20,
                  background:
                    "linear-gradient(180deg, rgba(9,13,20,0.92), rgba(7,10,16,0.96))",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "7px 12px",
                    borderRadius: 999,
                    background:
                      "linear-gradient(135deg, rgba(250,204,21,0.16), rgba(202,138,4,0.08))",
                    border: "1px solid rgba(250,204,21,0.26)",
                    color: "#fef3c7",
                    fontWeight: 950,
                    letterSpacing: "0.08em",
                    fontSize: 12,
                  }}
                >
                  <span aria-hidden="true" style={{ marginRight: 8 }}>❓</span> FAQ
                </div>

                <h2
                  style={{
                    margin: "14px 0 0 0",
                    fontSize: 24,
                    lineHeight: 1.15,
                    letterSpacing: "-0.03em",
                  }}
                >
                  Common questions about {symbol}
                </h2>

                <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 17 }}>
                      Is this page a buy or sell recommendation?
                    </h3>
                    <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.76 }}>
                      No. This page is designed to help you review chart structure, momentum and
                      technical context more quickly, but it is not personal financial advice.
                    </p>
                  </div>

                  <div>
                    <h3 style={{ margin: 0, fontSize: 17 }}>
                      Why can a stock look bullish and overbought at the same time?
                    </h3>
                    <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.76 }}>
                      Strong trending stocks can still become stretched in the short term. That is
                      why trend traders and dip buyers can read the same chart differently.
                    </p>
                  </div>

                  <div>
                    <h3 style={{ margin: 0, fontSize: 17 }}>
                      What should I do next after reading this page?
                    </h3>
                    <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.76 }}>
                      Open the full dashboard, review the chart in more detail, compare indicators,
                      and decide whether the setup still makes sense within your own process.
                    </p>
                  </div>
                </div>
              </section>
            </>
          )}
        </section>
      </div>

<style>{`
  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    padding: 28px 20px 40px;
  }

  .stockAnalysisHeroGrid {
    margin-top: 14px;
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
    gap: 18px;
    align-items: start;
  }

  .stockAnalysisSidePanel {
    display: grid;
    gap: 14px;
  }

  .stockMetricMatrix {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    align-items: stretch;
  }

  .trendContextRow {
    display: grid;
    grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
    gap: 12px;
    align-items: stretch;
  }

  .trendChecksStrip {
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 16px;
    padding: 12px;
    background: rgba(255,255,255,0.035);
  }

  .trendChecksGrid {
    margin-top: 9px;
    display: grid;
    gap: 7px;
    font-size: 13px;
  }

  .earningsReadHeroCard:hover {
    transform: translateY(-1px);
    filter: brightness(1.06);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 28px rgba(0,0,0,0.20);
  }

  .earningsReadHeroCard:focus-visible {
    outline: 2px solid rgba(147,197,253,0.9);
    outline-offset: 3px;
  }

  .earningsMetricGrid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .earningsDotGrid {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
  }

  .yearlyEarningsGrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 10px;
  }


  .stockAnalysisMiniGrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .tradeContextGrid {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(240px, 0.75fr);
    gap: 14px;
    align-items: stretch;
  }

  .heroGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .learnGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        a:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
        }

        @media (max-width: 900px) {
          .wrap {
            padding: 18px 16px 34px !important;
          }
.stockAnalysisHeroGrid,
.tradeContextGrid,
.trendContextRow {
  grid-template-columns: 1fr !important;
}
          .heroGrid,
          .learnGrid {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 820px) {
          .analysisTopUtilityRow {
            justify-content: stretch !important;
          }

          .analysisTopUtilityInner {
            width: 100%;
            justify-content: stretch !important;
            gap: 10px !important;
          }

          .analysisTopBtn {
            flex: 1 1 calc(50% - 5px);
            justify-content: center !important;
            min-height: 44px !important;
            padding: 11px 12px !important;
            font-size: 13px !important;
          }
        }

        @media (max-width: 560px) {
          .analysisTopUtilityInner {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            width: 100%;
          }

          .stockAnalysisMiniGrid,
          .stockMetricMatrix,
          .earningsMetricGrid {
  grid-template-columns: 1fr !important;
}

          .analysisTopBtn {
            width: 100%;
            min-width: 0;
          }
        }
      `}</style>
    </main>
  );
}



function circleIconStyle(tone: "green" | "yellow" | "red" | "blue"): React.CSSProperties {
  const color =
    tone === "green" ? "#4ade80" : tone === "red" ? "#f87171" : tone === "yellow" ? "#facc15" : "#60a5fa";
  const bg =
    tone === "green" ? "rgba(34,197,94,0.16)" : tone === "red" ? "rgba(239,68,68,0.16)" : tone === "yellow" ? "rgba(250,204,21,0.16)" : "rgba(59,130,246,0.16)";
  const border =
    tone === "green" ? "1px solid rgba(34,197,94,0.32)" : tone === "red" ? "1px solid rgba(239,68,68,0.32)" : tone === "yellow" ? "1px solid rgba(250,204,21,0.32)" : "1px solid rgba(59,130,246,0.32)";

  return {
    width: 38,
    height: 38,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    fontSize: 17,
    fontWeight: 950,
    lineHeight: 1,
    color,
    background: bg,
    border,
    boxShadow: `0 0 18px ${bg}`,
  };
}

function scoreOverviewCardStyle(tone: "green" | "yellow" | "red" | "blue"): React.CSSProperties {
  if (tone === "blue") {
    return {
      border: "1px solid rgba(59,130,246,0.24)",
      borderRadius: 18,
      padding: 18,
      background: "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(255,255,255,0.035))",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    };
  }

  return {
    border: toneBorder(tone),
    borderRadius: 18,
    padding: 18,
    background: toneSoftBackground(tone),
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
}

function factorCardStyle(tone: "green" | "yellow" | "red"): React.CSSProperties {
  return {
    border: toneBorder(tone),
    borderRadius: 18,
    padding: 18,
    background: toneSoftBackground(tone),
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
}

const factorHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

function articleIconStyle(tone: "green" | "yellow" | "red" | "blue"): React.CSSProperties {
  return {
    ...circleIconStyle(tone),
    width: 34,
    height: 34,
    fontSize: 15,
    marginRight: 10,
    verticalAlign: "middle",
  };
}

function summaryArticleStyle(tone: "green" | "yellow" | "red" | "blue"): React.CSSProperties {
  if (tone === "blue") {
    return {
      ...articleStyle,
      border: "1px solid rgba(59,130,246,0.22)",
      background: "linear-gradient(135deg, rgba(59,130,246,0.09), rgba(255,255,255,0.03))",
    };
  }

  return {
    ...articleStyle,
    border: tone === "green" ? "1px solid rgba(34,197,94,0.22)" : tone === "red" ? "1px solid rgba(239,68,68,0.22)" : "1px solid rgba(250,204,21,0.22)",
    background: tone === "green" ? "linear-gradient(135deg, rgba(34,197,94,0.09), rgba(255,255,255,0.03))" : tone === "red" ? "linear-gradient(135deg, rgba(239,68,68,0.09), rgba(255,255,255,0.03))" : "linear-gradient(135deg, rgba(250,204,21,0.10), rgba(255,255,255,0.03))",
  };
}

function technicalMetricCardStyle(tone: "green" | "yellow" | "red"): React.CSSProperties {
  return {
    ...statCardStyle,
    border: toneBorder(tone),
    background: toneSoftBackground(tone),
  };
}

const metricHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const topUtilityRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  marginBottom: 18,
};

function featuredMetricCardStyle(tone: "green" | "yellow" | "red"): React.CSSProperties {
  return {
    border:
      tone === "green"
        ? "1px solid rgba(34,197,94,0.26)"
        : tone === "red"
        ? "1px solid rgba(248,113,113,0.24)"
        : "1px solid rgba(250,204,21,0.24)",
    borderRadius: 20,
    padding: 18,
    background:
      tone === "green"
        ? "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(7,16,12,0.96))"
        : tone === "red"
        ? "linear-gradient(135deg, rgba(248,113,113,0.16), rgba(18,10,10,0.96))"
        : "linear-gradient(135deg, rgba(250,204,21,0.14), rgba(18,16,8,0.96))",
  };
}

function alignedMetricCardStyle(tone: "green" | "yellow" | "red" | "blue"): React.CSSProperties {
  if (tone === "blue") {
    return {
      border: "1px solid rgba(59,130,246,0.20)",
      borderRadius: 16,
      padding: 14,
      background: "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(255,255,255,0.035))",
      minHeight: 128,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    };
  }

  return {
    border: toneBorder(tone),
    borderRadius: 16,
    padding: 14,
    background: toneSoftBackground(tone),
    minHeight: 128,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
}

const miniMetricCardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 16,
  padding: 14,
  background: "rgba(255,255,255,0.04)",
};

const miniMetricValueStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 24,
  lineHeight: 1.08,
  fontWeight: 950,
  letterSpacing: "-0.04em",
};

const miniMetricSubStyle: React.CSSProperties = {
  marginTop: 7,
  fontSize: 13,
  lineHeight: 1.5,
  opacity: 0.72,
};

const topUtilityInnerStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

function pillStyle(tone: "green" | "red" | "yellow"): React.CSSProperties {
  if (tone === "green") {
    return {
      display: "inline-flex",
      alignItems: "center",
      width: "fit-content",
      padding: "7px 12px",
      borderRadius: 999,
      border: "1px solid rgba(34,197,94,0.30)",
      background: "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(21,128,61,0.08))",
      color: "#dcfce7",
      fontSize: 12,
      fontWeight: 950,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
    };
  }

  if (tone === "red") {
    return {
      display: "inline-flex",
      alignItems: "center",
      width: "fit-content",
      padding: "7px 12px",
      borderRadius: 999,
      border: "1px solid rgba(248,113,113,0.30)",
      background: "linear-gradient(135deg, rgba(248,113,113,0.16), rgba(185,28,28,0.08))",
      color: "#fee2e2",
      fontSize: 12,
      fontWeight: 950,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
    };
  }

  return {
    display: "inline-flex",
    alignItems: "center",
    width: "fit-content",
    padding: "7px 12px",
    borderRadius: 999,
    border: "1px solid rgba(250,204,21,0.30)",
    background: "linear-gradient(135deg, rgba(250,204,21,0.16), rgba(202,138,4,0.08))",
    color: "#fef3c7",
    fontSize: 12,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  };
}

function topUtilityBtnStyle(
  type: "gold" | "green" | "red" | "blue"
): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 40,
    padding: "9px 14px",
    borderRadius: 14,
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1,
    whiteSpace: "nowrap",
    boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
  };

  if (type === "gold") {
    return {
      ...base,
      border: "1px solid rgba(250,204,21,0.34)",
      background:
        "linear-gradient(135deg, rgba(250,204,21,0.18), rgba(202,138,4,0.08))",
      color: "#fef3c7",
    };
  }

  if (type === "green") {
    return {
      ...base,
      border: "1px solid rgba(34,197,94,0.30)",
      background:
        "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(21,128,61,0.08))",
      color: "#dcfce7",
    };
  }

  if (type === "red") {
    return {
      ...base,
      border: "1px solid rgba(248,113,113,0.28)",
      background:
        "linear-gradient(135deg, rgba(248,113,113,0.16), rgba(185,28,28,0.08))",
      color: "#fee2e2",
    };
  }

  return {
    ...base,
    border: "1px solid rgba(59,130,246,0.30)",
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08))",
    color: "#dbeafe",
  };
}

const miniLabelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.72,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const scoreHelpButtonStyle: React.CSSProperties = {
  marginLeft: 6,
  width: 18,
  height: 18,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.28)",
  background: "rgba(15,23,42,0.98)",
  color: "#e2e8f0",
  fontSize: 12,
  fontWeight: 900,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

const scoreHelpInlineBoxStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.45)",
  background: "#020617",
  backgroundColor: "#020617",
  color: "#f8fafc",
  fontSize: 13,
  lineHeight: 1.6,
  textTransform: "none",
  letterSpacing: 0,
  fontWeight: 700,
  boxShadow: "0 16px 40px rgba(0,0,0,0.65)",
};

const articleStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 18,
  padding: 18,
  background: "rgba(255,255,255,0.03)",
};

const articleHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 21,
  fontWeight: 600,
  lineHeight: 1.3,
  letterSpacing: "-0.005em",
};

const articleTextStyle: React.CSSProperties = {
  margin: "12px 0 0 0",
  fontSize: 16,
  lineHeight: 1.8,
  opacity: 0.9,
};

const statCardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 16,
  padding: 16,
  background: "rgba(255,255,255,0.03)",
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.72,
  marginBottom: 8,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const statValueStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 900,
};

const statMetaStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  opacity: 0.72,
  lineHeight: 1.6,
};


function contextMiniCardStyle(tone: "green" | "yellow" | "red" | "blue"): React.CSSProperties {
  if (tone === "blue") {
    return {
      ...statCardStyle,
      border: "1px solid rgba(59,130,246,0.22)",
      background: "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(255,255,255,0.03))",
    };
  }

  return {
    ...statCardStyle,
    border: toneBorder(tone),
    background: toneSoftBackground(tone),
  };
}

function tradeContextCalloutStyle(tone: ContextTone): React.CSSProperties {
  if (tone === "blue") {
    return {
      border: "1px solid rgba(59,130,246,0.24)",
      borderRadius: 16,
      padding: 16,
      background: "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(255,255,255,0.035))",
    };
  }

  return {
    border: toneBorder(tone),
    borderRadius: 16,
    padding: 16,
    background: toneSoftBackground(tone),
  };
}

const contextMiniValueStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 18,
  lineHeight: 1.25,
  fontWeight: 900,
  letterSpacing: "-0.02em",
};

const contextMiniSubStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  lineHeight: 1.55,
  opacity: 0.74,
};

function learnCardStyle(
  tint: "blue" | "green" | "red" | "yellow"
): React.CSSProperties {
  if (tint === "green") {
    return {
      display: "block",
      textDecoration: "none",
      color: "#f1f5f9",
      borderRadius: 14,
      padding: 14,
      border: "1px solid rgba(34,197,94,0.20)",
      background:
        "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(16,185,129,0.04))",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
      transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
    };
  }

  if (tint === "red") {
    return {
      display: "block",
      textDecoration: "none",
      color: "#f1f5f9",
      borderRadius: 14,
      padding: 14,
      border: "1px solid rgba(239,68,68,0.20)",
      background:
        "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(127,29,29,0.04))",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
      transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
    };
  }
  
  if (tint === "yellow") {
  return {
    display: "block",
    textDecoration: "none",
    color: "#f1f5f9",
    borderRadius: 14,
    padding: 14,
    border: "1px solid rgba(250,204,21,0.20)",
    background:
      "linear-gradient(135deg, rgba(250,204,21,0.10), rgba(202,138,4,0.05))",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
    transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
  };
}

  return {
    display: "block",
    textDecoration: "none",
    color: "#f1f5f9",
    borderRadius: 14,
    padding: 14,
    border: "1px solid rgba(59,130,246,0.20)",
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(37,99,235,0.04))",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
    transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
  };
}

const learnTextStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  opacity: 0.72,
  lineHeight: 1.6,
};
