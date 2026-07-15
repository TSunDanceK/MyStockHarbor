"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { IndicatorSeed } from "@/lib/indicators";
import StockPriceChart from "./StockPriceChart";
import StockTickerJump from "./StockTickerJump";
import LatestEarningsCard, {
  type LatestEarningsData,
} from "@/app/components/LatestEarningsCard";

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
  latestEarnings: LatestEarningsData;
  seed?: IndicatorSeed | null;
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
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff; else loss += -diff;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    out[i] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  }
  return out;
}

function buildTrendScore(args: { lastClose: number | null; ma50: number | null; ma200: number | null }) {
  const { lastClose, ma50, ma200 } = args;
  const checks = [
    typeof lastClose === "number" && typeof ma200 === "number" ? lastClose > ma200 : null,
    typeof lastClose === "number" && typeof ma50 === "number" ? lastClose > ma50 : null,
    typeof ma50 === "number" && typeof ma200 === "number" ? ma50 > ma200 : null,
  ];
  const passed = checks.reduce((acc, v) => acc + (v === true ? 1 : 0), 0);
  return { passed, total: 3 };
}

function trendLabel(args: { lastClose: number | null; ma50: number | null; ma200: number | null }) {
  const { lastClose, ma50, ma200 } = args;
  if (typeof lastClose === "number" && typeof ma50 === "number" && typeof ma200 === "number") {
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

function toneColor(tone: "green" | "yellow" | "red") {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#eab308";
  return "#ef4444";
}

function toneSoftBackground(tone: "green" | "yellow" | "red") {
  if (tone === "green") return "rgba(34,197,94,0.06)";
  if (tone === "yellow") return "rgba(250,204,21,0.06)";
  return "rgba(239,68,68,0.06)";
}

function toneBorder(tone: "green" | "yellow" | "red") {
  if (tone === "green") return "1px solid rgba(34,197,94,0.20)";
  if (tone === "yellow") return "1px solid rgba(250,204,21,0.20)";
  return "1px solid rgba(239,68,68,0.20)";
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
  if (typeof last !== "number" || typeof base !== "number" || !Number.isFinite(last) || !Number.isFinite(base) || base === 0) return null;
  return ((last - base) / base) * 100;
}

type MacroSupportResult = {
  lower: number; upper: number; level: number; distancePct: number; touches: number; volumeRatio: number | null;
};

type MacdResult = {
  macd: number; signal: number; histogram: number; label: "Bullish" | "Bearish" | "Mixed"; tone: "green" | "yellow" | "red"; meta: string;
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
    if (!existing) { buckets.set(key, { date: key, close: point.close, high, low, volume }); }
    else { buckets.set(key, { date: key, close: point.close, high: Math.max(existing.high ?? existing.close, high), low: Math.min(existing.low ?? existing.close, low), volume: (existing.volume ?? 0) + volume }); }
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

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period) return out;
  const multiplier = 2 / (period + 1);
  let current = avg(values.slice(0, period));
  out[period - 1] = current;
  for (let i = period; i < values.length; i++) { current = (values[i] - current) * multiplier + current; out[i] = current; }
  return out;
}

function buildMacd(values: number[]): MacdResult | null {
  if (values.length < 35) return null;
  const ema12 = ema(values, 12), ema26 = ema(values, 26);
  const macdLine = values.map((_, index) => { const fast = ema12[index]; const slow = ema26[index]; return typeof fast === "number" && typeof slow === "number" ? fast - slow : null; });
  const firstMacdIndex = macdLine.findIndex((value) => typeof value === "number");
  if (firstMacdIndex < 0) return null;
  const macdValues = macdLine.slice(firstMacdIndex).filter((value): value is number => typeof value === "number");
  const signalValues = ema(macdValues, 9);
  const lastSignal = lastNum(signalValues), lastMacd = macdValues.length ? macdValues[macdValues.length - 1] : null;
  if (typeof lastMacd !== "number" || typeof lastSignal !== "number") return null;
  const histogram = lastMacd - lastSignal;
  const quietThreshold = Math.max(values[values.length - 1] * 0.001, 0.03);
  if (Math.abs(histogram) <= quietThreshold) return { macd: lastMacd, signal: lastSignal, histogram, label: "Mixed", tone: "yellow", meta: "MACD near signal line" };
  if (histogram > 0) return { macd: lastMacd, signal: lastSignal, histogram, label: "Bullish", tone: "green", meta: "Momentum above signal" };
  return { macd: lastMacd, signal: lastSignal, histogram, label: "Bearish", tone: "red", meta: "Momentum below signal" };
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
  return dt.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

function buildLongSummary(args: { symbol: string; companyName: string; quote: Quote | null; lastClose: number | null; ma50: number | null; ma200: number | null; trend: string; trendScore: { passed: number; total: number }; rsi: number | null }) {
  const { symbol, companyName, quote, lastClose, ma50, ma200, trend, trendScore, rsi } = args;
  const companyLead = companyName ? `${companyName} (${symbol})` : symbol;
  const priceText = typeof quote?.price === "number" ? `$${quote.price.toFixed(2)}` : "an unavailable latest price";
  const ma50Pct = pctFromBase(lastClose, ma50), ma200Pct = pctFromBase(lastClose, ma200);
  let trendLead = `${companyLead} currently looks mixed rather than cleanly directional.`;
  if (trend === "Uptrend") {
    if (trendScore.passed === trendScore.total) trendLead = `${companyLead} is still trading in a constructive trend overall.`;
    else if (trendScore.passed >= 2) trendLead = `${companyLead} still shows some constructive trend features, even if the setup is not perfect.`;
    else trendLead = `${companyLead} is holding some bullish traits, but the chart no longer looks especially clean.`;
  } else if (trend === "Downtrend") {
    if (trendScore.passed <= 1) trendLead = `${companyLead} currently looks weaker on the chart and is not showing much trend strength.`;
    else trendLead = `${companyLead} is leaning weaker overall, although not every signal is fully bearish.`;
  } else {
    if (trendScore.passed >= 2) trendLead = `${companyLead} looks more range-bound than strongly trending, but there are still a few supportive signs on the chart.`;
    else trendLead = `${companyLead} currently looks more uncertain than directional, with a fairly mixed technical picture.`;
  }
  let movingAverageText = "";
  if (typeof ma50Pct === "number" && typeof ma200Pct === "number") {
    movingAverageText = ` Price is ${ma50Pct >= 0 ? "trading above" : "trading below"} the 50-day moving average by ${Math.abs(ma50Pct).toFixed(1)}% and ${ma200Pct >= 0 ? "above" : "below"} the 200-day moving average by ${Math.abs(ma200Pct).toFixed(1)}%.`;
  } else if (typeof ma50Pct === "number") {
    movingAverageText = ` Price is ${ma50Pct >= 0 ? "trading above" : "trading below"} the 50-day moving average by ${Math.abs(ma50Pct).toFixed(1)}%.`;
  } else if (typeof ma200Pct === "number") {
    movingAverageText = ` Price is ${ma200Pct >= 0 ? "trading above" : "trading below"} the 200-day moving average by ${Math.abs(ma200Pct).toFixed(1)}%.`;
  }
  const trendParagraph = `${trendLead} The latest available price is ${priceText}, and ${trendScore.passed} of ${trendScore.total} core trend checks are currently passing.` + movingAverageText;
  let momentumParagraph = `${symbol} currently looks fairly balanced from a momentum perspective.`;
  if (typeof rsi === "number") {
    if (rsi >= 75) momentumParagraph = `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which points to very strong short-term momentum but also a fairly extended setup. Stocks can stay strong for longer than expected, but this kind of reading often tells beginners not to confuse strength with low-risk entry timing.`;
    else if (rsi >= 70) momentumParagraph = `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which suggests stronger momentum and a more stretched short-term backdrop. Trend traders may still find that attractive, while more patient traders may prefer to wait and see whether the stock cools off first.`;
    else if (rsi <= 25) momentumParagraph = `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which places it in a deeply oversold zone. That can sometimes lead to bounce-watch setups, but it can also reflect genuine weakness, so the chart still needs proper confirmation rather than hope alone.`;
    else if (rsi <= 30) momentumParagraph = `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which suggests weaker momentum and a more oversold condition. Some traders may review this kind of setup for a rebound or buy-the-dip idea, but oversold readings by themselves do not guarantee a reversal.`;
    else if (rsi >= 55) momentumParagraph = `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which leans mildly positive without looking too stretched. In other words, momentum is supportive, but not yet extreme enough to dominate the entire chart read.`;
    else if (rsi <= 45) momentumParagraph = `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which leans a little softer than neutral. That does not automatically make the chart bearish, but it does suggest momentum is not especially strong right now.`;
    else momentumParagraph = `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which sits in a neutral range. That usually means momentum is not especially stretched in either direction, so traders may need to rely more on chart structure than on oscillator extremes alone.`;
  }
  let structureParagraph = `This page is designed to help you quickly understand what the ${symbol} chart looks like before opening the full dashboard. The aim is not to tell you what to buy or sell, but to make it easier to judge whether the stock is trending cleanly, becoming stretched, or simply moving in a more awkward range.`;
  if (trend === "Uptrend") structureParagraph = `For traders reviewing ${symbol} next, the key question is whether the trend still looks healthy or whether price has started to outrun itself. A strong uptrend can stay strong, but entries often become more difficult when price is already extended, so many traders will watch for pullbacks, support reactions, or fresh bases rather than chasing strength blindly.`;
  else if (trend === "Downtrend") structureParagraph = `For traders reviewing ${symbol} next, the main question is whether weakness is starting to stabilise or whether the chart still looks vulnerable to further downside. Some traders may watch for bounce attempts, but others will want to see stronger proof that the trend is improving before treating the stock as a cleaner setup.`;
  else if (typeof rsi === "number" && rsi <= 30) structureParagraph = `Because ${symbol} is showing a more oversold-style momentum reading inside a mixed structure, the next step is usually to watch how price behaves rather than assuming a rebound is guaranteed. Traders often want to see a stabilisation phase, a stronger reclaim, or some sign that selling pressure is starting to fade.`;
  else if (typeof rsi === "number" && rsi >= 70) structureParagraph = `Because ${symbol} is showing stronger momentum inside a more extended backdrop, the next step is often about timing rather than direction. A stock can keep pushing higher, but many traders will still watch for whether the move stays orderly or starts to look too stretched to offer a comfortable entry.`;
  return { trendParagraph, momentumParagraph, structureParagraph };
}

type ContextTone = "green" | "yellow" | "red" | "blue";
type TradeContextResult = { alignment: "Strong" | "Constructive" | "Early" | "Mixed" | "Conflict" | "Weak"; tone: ContextTone; businessContext: string; technicalContext: string; riskContext: string; read: string; watch: string; };

function buildTradeContext(args: { aiAnalysis: { fundamentalsScore: number | null; futurePotentialScore: number | null } | null; lastClose: number | null; ma50: number | null; ma200: number | null; rsi: number | null; trendScore: { passed: number; total: number } }): TradeContextResult {
  const { aiAnalysis, lastClose, ma50, ma200, rsi, trendScore } = args;
  const fundamentalsScore = aiAnalysis?.fundamentalsScore ?? null, futurePotentialScore = aiAnalysis?.futurePotentialScore ?? null;
  const hasBusinessScores = typeof fundamentalsScore === "number" && typeof futurePotentialScore === "number";
  const businessBlend = hasBusinessScores ? (fundamentalsScore + futurePotentialScore) / 2 : null;
  let businessContext = "Business context unavailable", businessState: "supportive" | "mixed" | "weak" | "unknown" = "unknown";
  if (typeof businessBlend === "number") {
    if (businessBlend >= 70 && futurePotentialScore !== null && futurePotentialScore >= 65) { businessState = "supportive"; businessContext = "Supportive business backdrop"; }
    else if (businessBlend <= 45 || (fundamentalsScore !== null && fundamentalsScore <= 40)) { businessState = "weak"; businessContext = "Weak business backdrop"; }
    else { businessState = "mixed"; businessContext = "Mixed business backdrop"; }
  }
  const priceAbove50 = typeof lastClose === "number" && typeof ma50 === "number" ? lastClose > ma50 : false;
  const priceAbove200 = typeof lastClose === "number" && typeof ma200 === "number" ? lastClose > ma200 : false;
  const ma50Above200 = typeof ma50 === "number" && typeof ma200 === "number" ? ma50 > ma200 : false;
  const nearMa200 = typeof lastClose === "number" && typeof ma200 === "number" && ma200 > 0 ? Math.abs(((lastClose - ma200) / ma200) * 100) <= 7 : false;
  const oversold = typeof rsi === "number" && rsi <= 35, extended = typeof rsi === "number" && rsi >= 70;
  let technicalContext = "Technical context unavailable", technicalState: "supportive" | "early" | "mixed" | "weak" | "extended" = "mixed";
  if (priceAbove50 && priceAbove200 && ma50Above200) { technicalState = extended ? "extended" : "supportive"; technicalContext = extended ? "Strong trend, short-term extended" : "Above key trend levels"; }
  else if (priceAbove200 && (nearMa200 || !priceAbove50)) { technicalState = "early"; technicalContext = "Near long-term trend support"; }
  else if (!priceAbove200 && oversold) { technicalState = "early"; technicalContext = "Oversold recovery watch"; }
  else if (!priceAbove200 && trendScore.passed <= 1) { technicalState = "weak"; technicalContext = "Below key trend levels"; }
  else { technicalState = "mixed"; technicalContext = "Mixed technical structure"; }
  let riskContext = "No single edge is strong enough to dominate the read.";
  if (extended) riskContext = "Momentum may be stretched, so timing risk is higher.";
  else if (oversold) riskContext = "Oversold can bounce, but it still needs confirmation.";
  else if (businessState === "weak") riskContext = "The business read may limit confidence in technical bounces.";
  else if (businessState === "supportive" && technicalState === "weak") riskContext = "The story is better than the current chart structure.";
  let alignment: TradeContextResult["alignment"] = "Mixed", tone: ContextTone = "yellow";
  let read = "The business read and chart structure are not giving a clean confirmation layer yet.";
  let watch = "Look for a clearer agreement between story, trend and momentum before drawing stronger conclusions.";
  if (businessState === "supportive" && technicalState === "supportive") { alignment = "Strong"; tone = "green"; read = "The broader story and the chart structure are broadly aligned."; watch = "Watch whether price can hold above the main moving averages without becoming too stretched."; }
  else if (businessState === "supportive" && technicalState === "extended") { alignment = "Constructive"; tone = "green"; read = "The story is supportive, but the chart may already be pricing in some strength."; watch = "Watch for controlled pullbacks, bases or continued volume support rather than chasing every move."; }
  else if (businessState === "supportive" && technicalState === "early") { alignment = "Early"; tone = "blue"; read = "The story is improving, but the chart still needs more technical confirmation."; watch = "Watch for a clean reclaim, support reaction, or improving momentum before treating it as stronger alignment."; }
  else if (businessState === "weak" && technicalState === "weak") { alignment = "Weak"; tone = "red"; read = "The business read and chart structure are both leaning cautious."; watch = "Watch for signs of stabilisation before trusting rebounds."; }
  else if ((businessState === "supportive" && technicalState === "weak") || (businessState === "weak" && (technicalState === "supportive" || technicalState === "extended"))) { alignment = "Conflict"; tone = "yellow"; read = "The story and chart are sending different messages."; watch = "Check which side resolves first: improving price structure or a stronger business/news catalyst."; }
  return { alignment, tone, businessContext, technicalContext, riskContext, read, watch };
}

function formatMoneyCompact(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value); const sign = value < 0 ? "-" : "";
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
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function earningsReadScore(earnings: StockEarningsData | null, loading: boolean) {
  if (loading || !earnings?.hasStructuredData) return null;
  if (typeof earnings.score === "number" && Number.isFinite(earnings.score)) return earnings.score;
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
  const eps = formatSignedPercent(earnings.epsSurprisePercent), revenue = formatSignedPercent(earnings.revenueSurprisePercent);
  return `EPS ${eps} · Revenue ${revenue}`;
}

function EarningsReadScale({ earnings, loading }: { earnings: StockEarningsData | null; loading: boolean }) {
  const score = earningsReadScore(earnings, loading), tone = earningsScoreTone(score), markerLeft = `${typeof score === "number" ? score : 50}%`;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden="true">⚖️</span>
        <span style={{ fontSize: 20, lineHeight: 1, fontWeight: 800, color: toneColor(tone) }}>{typeof score === "number" ? `${score}/100` : "—"}</span>
      </div>
      <div aria-hidden="true" style={{ position: "relative", marginTop: 8, height: 8, borderRadius: 999, background: "linear-gradient(90deg, rgba(239,68,68,0.90), rgba(250,204,21,0.90), rgba(34,197,94,0.90))" }}>
        <span style={{ position: "absolute", top: "50%", left: markerLeft, width: 14, height: 14, borderRadius: 999, background: "#f8fafc", border: `2px solid ${toneColor(tone)}`, transform: "translate(-50%, -50%)" }} />
      </div>
      <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "rgba(226,232,240,0.50)" }}>
        <span>Weak</span><span>Mixed</span><span>Strong</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 11, opacity: 0.60, lineHeight: 1.4 }}>{earningsScaleSummary(earnings, loading)}</div>
    </div>
  );
}

function earningsPanelTone(earnings: StockEarningsData | null): "green" | "yellow" | "red" {
  if (!earnings?.hasStructuredData) return "yellow";
  return earnings.tone;
}

function StockEarningsPanel({ symbol, earnings, loading }: { symbol: string; earnings: StockEarningsData | null; loading: boolean }) {
  const tone = earningsPanelTone(earnings);
  return (
    <section style={{ marginTop: 24, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div style={sectionLabelStyle}>Latest Earnings</div>
          <h2 style={sectionHeadingStyle}>{symbol} earnings snapshot</h2>
          <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.6, opacity: 0.68, maxWidth: 680 }}>
            {loading ? "Loading latest structured earnings data from Financial Modeling Prep." : earnings?.hasStructuredData ? `Latest completed report: ${formatShortDate(earnings.reportDate)}. Next expected: ${formatShortDate(earnings.nextEarningsDate)}.` : "Structured earnings data is not available for this symbol right now."}
          </p>
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 7, border: toneBorder(tone), background: toneSoftBackground(tone), color: toneColor(tone) }}>
          {loading ? "Loading" : earnings?.toneLabel ?? "Unavailable"}
        </span>
      </div>
      <div className="earningsMetricGrid">
        {[
          { label: "Actual EPS", value: loading ? "—" : formatEps(earnings?.actualEps ?? null), sub: `Estimate: ${loading ? "—" : formatEps(earnings?.estimatedEps ?? null)}`, tone: metricToneFromPct(earnings?.epsSurprisePercent ?? null) },
          { label: "EPS Surprise", value: loading ? "—" : formatSignedPercent(earnings?.epsSurprisePercent ?? null), sub: loading ? "—" : formatEps(earnings?.epsSurprise ?? null), tone: metricToneFromPct(earnings?.epsSurprisePercent ?? null) },
          { label: "Revenue", value: loading ? "—" : formatMoneyCompact(earnings?.revenue ?? null), sub: `Estimate: ${loading ? "—" : formatMoneyCompact(earnings?.revenueEstimate ?? null)}`, tone: metricToneFromPct(earnings?.revenueSurprisePercent ?? null) },
          { label: "Revenue Surprise", value: loading ? "—" : formatSignedPercent(earnings?.revenueSurprisePercent ?? null), sub: loading ? "—" : formatSignedMoney(earnings?.revenueSurprise ?? null), tone: metricToneFromPct(earnings?.revenueSurprisePercent ?? null) },
          { label: "Gross Margin", value: loading ? "—" : formatSignedPercent(earnings?.grossMargin ?? null), sub: "If available", tone: metricToneFromPct(earnings?.grossMargin ?? null) },
          { label: "Operating Margin", value: loading ? "—" : formatSignedPercent(earnings?.operatingMargin ?? null), sub: "If available", tone: metricToneFromPct(earnings?.operatingMargin ?? null) },
        ].map((m) => (
          <div key={m.label} style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: toneColor(m.tone), flex: "0 0 auto", boxShadow: `0 0 6px ${toneColor(m.tone)}66` }} />
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.60 }}>{m.label}</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>{m.value}</div>
            <div style={{ marginTop: 2, fontSize: 12, opacity: 0.55 }}>{m.sub}</div>
          </div>
        ))}
      </div>
      {earnings?.recentReports?.length ? (
        <div style={{ marginTop: 16 }}>
          <div style={miniLabelStyle}>Recent earnings trend</div>
          <div className="earningsDotGrid" style={{ marginTop: 10 }}>
            {earnings.recentReports.map((item) => (
              <div key={`${item.label}-${item.date ?? ""}`} style={{ display: "grid", justifyItems: "center", gap: 6 }}>
                <span title={`${item.label}: ${item.toneLabel}`} style={{ width: 16, height: 16, borderRadius: 999, background: toneColor(item.tone), boxShadow: `0 0 0 4px ${item.tone === "green" ? "rgba(34,197,94,0.12)" : item.tone === "red" ? "rgba(239,68,68,0.12)" : "rgba(250,204,21,0.12)"}` }} />
                <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.80 }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {earnings?.yearlySummaries?.length ? (
        <div style={{ marginTop: 16 }}>
          <div style={miniLabelStyle}>Yearly earnings read</div>
          <div className="yearlyEarningsGrid" style={{ marginTop: 10 }}>
            {earnings.yearlySummaries.map((item) => (
              <div key={item.year} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", borderRadius: 9, border: toneBorder(item.tone), background: toneSoftBackground(item.tone), fontSize: 13, fontWeight: 700 }}>
                <strong>{item.year}</strong><span style={{ color: toneColor(item.tone) }}>{item.toneLabel}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6, opacity: 0.45 }}>{earnings?.sourceNote ?? "Structured earnings data is provided by Financial Modeling Prep when available."}</div>
    </section>
  );
}

const sectionLabelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(147,197,253,0.82)", marginBottom: 6 };
const sectionHeadingStyle: React.CSSProperties = { margin: 0, fontSize: 22, lineHeight: 1.15, letterSpacing: "-0.025em", fontWeight: 700 };
const miniLabelStyle: React.CSSProperties = { fontSize: 11, opacity: 0.60, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" };
const miniMetricSubStyle: React.CSSProperties = { marginTop: 6, fontSize: 13, lineHeight: 1.5, opacity: 0.65 };
const articleTextStyle: React.CSSProperties = { margin: "10px 0 0 0", fontSize: 15, lineHeight: 1.8, opacity: 0.85 };

function sideCardStyle(): React.CSSProperties {
  return { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, overflow: "hidden", background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" };
}
function sideCardHeaderStyle(): React.CSSProperties {
  return { padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" };
}
function sideCardBodyStyle(): React.CSSProperties {
  return { padding: "14px 14px" };
}

export default function StockSymbolPageClient({ symbol, latestEarnings, seed }: StockSymbolPageClientProps) {
  const [quote, setQuote] = useState<Quote | null>(
    seed?.price != null ? { symbol, price: seed.price, date: seed.priceDate, time: null, source: "ssr" } : null
  );
  const [history, setHistory] = useState<Point[]>([]);
  const [companyName, setCompanyName] = useState(seed?.companyName ?? "");
  const [priceLoading, setPriceLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [valuation, setValuation] = useState<StockValuationData | null>(null);
  const [valuationLoading, setValuationLoading] = useState(true);
  const [openScoreHelp, setOpenScoreHelp] = useState<"fundamentals" | "future" | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPriceLoading(true); setErr(null);
      try {
        const [quoteRes, historyRes, symbolsRes] = await Promise.all([
          fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }),
          fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&days=900`, { cache: "no-store" }),
          fetch(`/api/symbols?q=${encodeURIComponent(symbol)}`, { cache: "no-store" }),
        ]);
        if (!quoteRes.ok) throw new Error("Quote fetch failed");
        if (!historyRes.ok) throw new Error("History fetch failed");
        const quoteData = (await quoteRes.json()) as Quote;
        const historyData = (await historyRes.json()) as { symbol: string; points: any[] };
        let name = "";
        if (symbolsRes.ok) { const symbolsData = (await symbolsRes.json()) as { results?: SymbolResult[] }; const exact = (symbolsData.results ?? []).find((r) => (r.symbol ?? "").toUpperCase() === symbol.toUpperCase()); name = exact?.name ?? ""; }
        if (cancelled) return;
        const ptsRaw = Array.isArray(historyData.points) ? historyData.points : [];
        const pts: Point[] = ptsRaw.map((p: any) => ({ date: String(p?.date ?? ""), close: Number(p?.close), high: p?.high == null ? undefined : Number(p.high), low: p?.low == null ? undefined : Number(p.low), volume: p?.volume == null ? undefined : Number(p.volume) })).filter((p) => p.date && Number.isFinite(p.close));
        setQuote(quoteData); setHistory(pts); setCompanyName(name);
      } catch { if (cancelled) return; setErr("Failed to load stock page."); setQuote(null); setHistory([]); setCompanyName(""); }
      finally { if (!cancelled) setPriceLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    async function loadValuation() {
      setValuationLoading(true);
      try { const res = await fetch(`/api/stock-valuation/${encodeURIComponent(symbol)}?t=${Date.now()}`, { cache: "no-store" }); if (!res.ok) throw new Error("Valuation fetch failed"); const data = (await res.json()) as StockValuationData; if (!cancelled) setValuation(data); }
      catch { if (!cancelled) setValuation(null); }
      finally { if (!cancelled) setValuationLoading(false); }
    }
    loadValuation();
    return () => { cancelled = true; };
  }, [symbol]);

  const closes = useMemo(() => history.map((p) => p.close), [history]);
  const ma50 = useMemo(() => movingAverage(closes, 50), [closes]);
  const ma200 = useMemo(() => movingAverage(closes, 200), [closes]);
  const rsi14 = useMemo(() => rsiWilder(closes, 14), [closes]);
  const lastClose = history.length ? history[history.length - 1].close : null;
  const lastMA50 = lastNum(ma50), lastMA200 = lastNum(ma200), lastRsi = lastNum(rsi14);
  const trendScore = useMemo(() => buildTrendScore({ lastClose, ma50: typeof lastMA50 === "number" ? lastMA50 : null, ma200: typeof lastMA200 === "number" ? lastMA200 : null }), [lastClose, lastMA50, lastMA200]);
  const trend = useMemo(() => trendLabel({ lastClose, ma50: typeof lastMA50 === "number" ? lastMA50 : null, ma200: typeof lastMA200 === "number" ? lastMA200 : null }), [lastClose, lastMA50, lastMA200]);
  const trendTone: "green" | "yellow" | "red" = trendScore.passed >= 3 ? "green" : trendScore.passed === 2 ? "yellow" : "red";
  const longSummary = useMemo(() => buildLongSummary({ symbol, companyName, quote, lastClose, ma50: typeof lastMA50 === "number" ? lastMA50 : null, ma200: typeof lastMA200 === "number" ? lastMA200 : null, trend, trendScore, rsi: typeof lastRsi === "number" ? lastRsi : null }), [symbol, companyName, quote, lastClose, lastMA50, lastMA200, trend, trendScore, lastRsi]);
  const ma50Pct = pctFromBase(lastClose, typeof lastMA50 === "number" ? lastMA50 : null);
  const ma200Pct = pctFromBase(lastClose, typeof lastMA200 === "number" ? lastMA200 : null);
  const macroSupport = useMemo(() => computeMacroSupport(history, lastClose), [history, lastClose]);
  const macdSignal = useMemo(() => buildMacd(closes), [closes]);

  return (
    <main onClick={() => setOpenScoreHelp(null)} style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
      <div className="stock-wrap">

        {/* ── Page header ──────────────────────────────────────────── */}
        <header style={{ paddingTop: 24, paddingBottom: 20, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(148,163,184,0.55)" }}>Stock Analysis</span>
            <span style={{ fontSize: 11, color: "rgba(148,163,184,0.30)" }}>·</span>
            <Link href="/pickers" style={{ fontSize: 11, fontWeight: 600, color: "rgba(148,163,184,0.55)", textDecoration: "none" }}>← Pickers</Link>
          </div>
          <div style={{ marginTop: 10 }}>
            <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.1, fontWeight: 800, letterSpacing: "-0.04em" }}>{symbol}</h1>
            {companyName ? <p style={{ margin: "3px 0 0", fontSize: 15, opacity: 0.60, fontWeight: 400 }}>{companyName}</p> : null}
          </div>
          {!priceLoading && !err ? (
            <div className="stock-header-stats" style={{ marginTop: 16 }}>
              <div className="stock-stat-cell">
                <div className="stock-stat-label">Price</div>
                <div className="stock-stat-value">{typeof quote?.price === "number" ? `$${quote.price.toFixed(2)}` : "—"}</div>
                <div className="stock-stat-sub">{quote?.date ?? "—"}</div>
              </div>
              <div className="stock-stat-cell">
                <div className="stock-stat-label">Trend score</div>
                <div className="stock-stat-value" style={{ color: toneColor(trendTone) }}>{trendScore.passed}/{trendScore.total}</div>
                <div className="stock-stat-sub">{trend}</div>
              </div>
              <div className="stock-stat-cell">
                <div className="stock-stat-label">RSI (14)</div>
                <div className="stock-stat-value" style={{ color: toneColor(rsiTone(typeof lastRsi === "number" ? lastRsi : null)) }}>{typeof lastRsi === "number" ? lastRsi.toFixed(1) : "—"}</div>
                <div className="stock-stat-sub">{typeof lastRsi === "number" ? (lastRsi >= 70 ? "Overbought" : lastRsi <= 30 ? "Oversold" : "Neutral") : "—"}</div>
              </div>
              {!valuationLoading && valuation ? (
                <div className="stock-stat-cell">
                  <div className="stock-stat-label">P/E</div>
                  <div className="stock-stat-value">{formatValuationMultiple(valuation.peRatio)}</div>
                  <div className="stock-stat-sub">P/S {formatValuationMultiple(valuation.priceToSalesRatio)}</div>
                </div>
              ) : null}
            </div>
          ) : null}
          {!priceLoading && !err ? (
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              {[
                { label: "Price above MA50", pass: lastClose !== null && lastMA50 !== null && lastClose > lastMA50 },
                { label: "Price above MA200", pass: lastClose !== null && lastMA200 !== null && lastClose > lastMA200 },
                { label: "MA50 above MA200", pass: lastMA50 !== null && lastMA200 !== null && lastMA50 > lastMA200 },
              ].map((check) => (
                <span key={check.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: check.pass ? "#86efac" : "rgba(248,113,113,0.80)" }}>
                  <span style={{ fontWeight: 900 }}>{check.pass ? "✓" : "✕"}</span>
                  {check.label}
                </span>
              ))}
            </div>
          ) : null}
        </header>

        {priceLoading ? (
          <div style={{ paddingTop: 40, opacity: 0.60, fontSize: 14 }}>Loading chart and price data…</div>
        ) : err ? (
          <div style={{ paddingTop: 40, opacity: 0.70, fontSize: 14 }}>{err}</div>
        ) : (
          <div className="stock-page-layout" style={{ paddingTop: 24 }}>

            {/* ════ LEFT SIDEBAR ═══════════════════════════════════ */}
            <aside className="stock-page-sidebar">

              {/* Change stock — desktop only (hidden on mobile via CSS) */}
              <div className="sidebar-change-stock" style={sideCardStyle()}>
                <div style={sideCardHeaderStyle()}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(148,163,184,0.55)" }}>Change stock</div>
                  <div style={{ marginTop: 3, fontSize: 12, opacity: 0.50, lineHeight: 1.4 }}>Search another ticker to view its stock analysis page.</div>
                </div>
                <div style={sideCardBodyStyle()}>
                  <StockTickerJump currentSymbol={symbol} />
                </div>
              </div>

            </aside>

            {/* ════ MAIN COLUMN ════════════════════════════════════ */}
            <div className="stock-page-main">

              {/* ── Change stock — mobile only, above chart ────────── */}
              <div className="mobile-change-stock" style={sideCardStyle()}>
                <div style={sideCardHeaderStyle()}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(148,163,184,0.55)" }}>Change stock</div>
                  <div style={{ marginTop: 3, fontSize: 12, opacity: 0.50, lineHeight: 1.4 }}>Search another ticker to view its stock analysis page.</div>
                </div>
                <div style={sideCardBodyStyle()}>
                  <StockTickerJump currentSymbol={symbol} />
                </div>
              </div>

              {/* ── Chart section ─────────────────────────────────── */}
              <section style={{ marginTop: 20 }}>
                <div style={sectionLabelStyle}>Chart View</div>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                  <h2 style={sectionHeadingStyle}>{symbol} with MA50 and MA200</h2>
                  <div style={{ display: "flex", gap: 6, flexWrap: "nowrap", alignItems: "center", maxWidth: "100%" }}>
                    <Link href={`/?symbol=${encodeURIComponent(symbol)}`} style={chartLinkStyle("blue")}>Dashboard</Link>
                    <Link href={`/stock/${encodeURIComponent(symbol)}/news`} style={chartLinkStyle("red")}>News</Link>
                    <a href={`/api/go/tradingview?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noopener noreferrer sponsored nofollow" style={chartLinkStyle("green")}>TradingView</a>
                  </div>
                </div>
                <StockPriceChart symbol={symbol} data={history.slice(-240)} ma50={ma50.slice(-240)} ma200={ma200.slice(-240)} height={360} />
              </section>

              {/* ── Technical indicators ──────────────────────────── */}
              <section style={{ marginTop: 32, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 24 }}>
                <div style={sectionLabelStyle}>Technical Indicators</div>
                <h2 style={{ ...sectionHeadingStyle, marginBottom: 16 }}>Key levels &amp; signals</h2>
                <div className="indicator-rows">
                  {[
                    { label: "MA50", value: typeof lastMA50 === "number" ? `$${lastMA50.toFixed(2)}` : "—", sub: typeof ma50Pct === "number" ? `${ma50Pct >= 0 ? "+" : ""}${ma50Pct.toFixed(2)}% vs price` : "Distance unavailable", tone: metricToneFromPct(ma50Pct) },
                    { label: "MA200", value: typeof lastMA200 === "number" ? `$${lastMA200.toFixed(2)}` : "—", sub: typeof ma200Pct === "number" ? `${ma200Pct >= 0 ? "+" : ""}${ma200Pct.toFixed(2)}% vs price` : "Distance unavailable", tone: metricToneFromPct(ma200Pct) },
                    { label: "RSI (14)", value: typeof lastRsi === "number" ? lastRsi.toFixed(1) : "—", sub: typeof lastRsi === "number" ? (lastRsi >= 70 ? "Overbought zone" : lastRsi <= 30 ? "Oversold zone" : "Neutral zone") : "Momentum unavailable", tone: rsiTone(typeof lastRsi === "number" ? lastRsi : null) },
                    { label: "MACD Signal", value: macdSignal?.label ?? "—", sub: macdSignal?.meta ?? "Momentum unavailable", tone: macdSignal?.tone ?? "yellow" as "green" | "yellow" | "red" },
                    { label: "Macro Support", value: macroSupport ? `$${macroSupport.lower.toFixed(2)}–$${macroSupport.upper.toFixed(2)}` : "Not identified", sub: macroSupport ? `${macroSupport.distancePct.toFixed(1)}% below price · ${macroSupport.touches} touches` : "No repeated weekly support zone found", tone: supportTone(macroSupport?.distancePct ?? null) },
                    { label: "Support Quality", value: macroSupport ? `${macroSupport.touches} touches` : "—", sub: macroSupport?.volumeRatio != null ? `${macroSupport.volumeRatio.toFixed(1)}× zone volume` : "Volume data unavailable", tone: supportQualityTone(macroSupport) },
                  ].map((row) => (
                    <div key={row.label} className="indicator-row">
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 110, flex: "0 0 auto" }}>
                        <span style={{ width: 7, height: 7, borderRadius: 999, background: toneColor(row.tone), boxShadow: `0 0 5px ${toneColor(row.tone)}66`, flex: "0 0 auto" }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(226,232,240,0.75)" }}>{row.label}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: toneColor(row.tone) }}>{row.value}</span>
                        <span style={{ fontSize: 12, opacity: 0.50, marginLeft: 8 }}>{row.sub}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* ── Chart summaries ───────────────────────────────── */}
              <section style={{ marginTop: 32, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 24 }}>
                <div style={sectionLabelStyle}>Chart Summary</div>
                <div>
                  {[
                    { heading: `Trend summary for ${symbol}`, text: longSummary.trendParagraph, dot: trendTone },
                    { heading: "Momentum and stretch context", text: longSummary.momentumParagraph, dot: rsiTone(typeof lastRsi === "number" ? lastRsi : null) },
                    { heading: "What traders may watch next", text: longSummary.structureParagraph, dot: "yellow" as const },
                  ].map((item, i) => (
                    <div key={i} style={{ padding: "18px 0", borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.07)" : "none", display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: toneColor(item.dot), marginTop: 6, flex: "0 0 auto", boxShadow: `0 0 5px ${toneColor(item.dot)}66` }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 5 }}>{item.heading}</div>
                        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.75, opacity: 0.75 }}>{item.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section style={{ marginTop: 32, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 24 }}>
                <LatestEarningsCard earnings={latestEarnings} symbol={symbol} />
              </section>

              {/* ── Learn more ────────────────────────────────────── */}
              <section style={{ marginTop: 32, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 24 }}>
                <div style={sectionLabelStyle}>Learn More</div>
                <h2 style={{ ...sectionHeadingStyle, marginBottom: 14 }}>Learn the indicators behind this page</h2>
                <div className="learn-grid">
                  <Link href="/learn/moving-averages" style={learnRowStyle}><span style={learnDotStyle("blue")} /><div><div style={{ fontWeight: 700, fontSize: 14 }}>Moving Averages</div><div style={{ fontSize: 13, opacity: 0.55, marginTop: 2 }}>How traders use MA50 and MA200 to judge medium and long-term structure.</div></div></Link>
                  <Link href="/learn/rsi" style={learnRowStyle}><span style={learnDotStyle("green")} /><div><div style={{ fontWeight: 700, fontSize: 14 }}>RSI Guide</div><div style={{ fontSize: 13, opacity: 0.55, marginTop: 2 }}>How RSI highlights momentum, overbought and oversold conditions.</div></div></Link>
                  <Link href="/learn/macd" style={learnRowStyle}><span style={learnDotStyle("red")} /><div><div style={{ fontWeight: 700, fontSize: 14 }}>MACD Guide</div><div style={{ fontSize: 13, opacity: 0.55, marginTop: 2 }}>How MACD helps read momentum strength and weakening trend behaviour.</div></div></Link>
                </div>
              </section>

              {/* ── Explore more ──────────────────────────────────── */}
              <section style={{ marginTop: 32, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 24 }}>
                <div style={sectionLabelStyle}>Explore More</div>
                <h2 style={{ ...sectionHeadingStyle, marginBottom: 14 }}>More stock opportunities</h2>
                <div className="explore-grid">
                  {[
                    { href: "/oversold-stocks-today", label: "Oversold Stocks", sub: "Potential rebound setups", dot: "#22c55e" },
                    { href: "/overbought-stocks-today", label: "Overbought Stocks", sub: "Pullback watch", dot: "#ef4444" },
                    { href: "/stocks-ready-to-break-out", label: "Breakout Stocks", sub: "Momentum expansion setups", dot: "#60a5fa" },
                    { href: "/stocks-near-200-day-moving-average", label: "Near 200-Day MA", sub: "Long-term level tests", dot: "#eab308" },
                  ].map((item) => (
                    <Link key={item.href} href={item.href} style={exploreCardStyle}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: item.dot, flex: "0 0 auto" }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{item.label}</div>
                        <div style={{ fontSize: 12, opacity: 0.50, marginTop: 2 }}>{item.sub}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>

              {/* ── FAQ ───────────────────────────────────────────── */}
              <section style={{ marginTop: 32, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 24, paddingBottom: 40 }}>
                <div style={sectionLabelStyle}>FAQ</div>
                <h2 style={{ ...sectionHeadingStyle, marginBottom: 18 }}>Common questions about {symbol}</h2>
                <div style={{ display: "grid", gap: 16 }}>
                  {[
                    { q: "Is this page a buy or sell recommendation?", a: "No. This page is designed to help you review chart structure, momentum and technical context more quickly, but it is not personal financial advice." },
                    { q: "Why can a stock look bullish and overbought at the same time?", a: "Strong trending stocks can still become stretched in the short term. That is why trend traders and dip buyers can read the same chart differently." },
                    { q: "What should I do next after reading this page?", a: "Open the full dashboard, review the chart in more detail, compare indicators, and decide whether the setup still makes sense within your own process." },
                  ].map((item) => (
                    <div key={item.q}>
                      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{item.q}</h3>
                      <p style={{ margin: "5px 0 0", fontSize: 13, lineHeight: 1.7, opacity: 0.65 }}>{item.a}</p>
                    </div>
                  ))}
                </div>
              </section>

            </div>{/* end main col */}
          </div>
        )}
      </div>

      <style>{`
        .stock-wrap { max-width: 1240px; margin: 0 auto; padding: 0 20px; box-sizing: border-box; }

        .stock-page-layout {
          display: grid;
          grid-template-columns: 300px 1fr;
          gap: 28px;
          align-items: start;
        }
        .stock-page-main { min-width: 0; }
        .stock-page-sidebar {
          display: flex;
          flex-direction: column;
          gap: 16px;
          position: sticky;
          top: 20px;
        }

        /* Desktop: show sidebar change stock, hide inline one */
        .mobile-change-stock { display: none; }
        .sidebar-change-stock { display: block; }

        @media (max-width: 900px) {
          .stock-page-layout { grid-template-columns: 1fr !important; }
          .stock-page-sidebar { position: static !important; order: 2; }
          .stock-page-main { order: 1; }
          /* Mobile: show inline change stock above chart, hide sidebar one */
          .mobile-change-stock { display: block; }
          .sidebar-change-stock { display: none !important; }
        }

        .stock-header-stats {
          display: flex;
          align-items: stretch;
          gap: 0;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          overflow: hidden;
        }
        .stock-stat-cell {
          flex: 0.7 1 0;
          padding: 12px 14px;
          border-right: 1px solid rgba(255,255,255,0.07);
          min-width: 0;
        }
        .stock-stat-cell:last-child { border-right: none; }
        .stock-stat-label { font-size: 10px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; opacity: 0.55; }
        .stock-stat-value { font-size: 22px; font-weight: 800; letter-spacing: -0.03em; margin-top: 4px; line-height: 1; }
        .stock-stat-sub { font-size: 11px; opacity: 0.48; margin-top: 3px; }
        .stock-earnings-cell { flex: 2.2 1 0 !important; min-width: 180px; }

        @media (max-width: 640px) {
          .stock-header-stats {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            border-radius: 10px;
          }
          .stock-stat-cell {
            flex: unset !important;
            border-right: none !important;
            border-bottom: 1px solid rgba(255,255,255,0.07);
          }
          .stock-stat-cell:nth-last-child(-n+2) { border-bottom: none; }
          .stock-stat-value { font-size: 18px !important; }
          .stock-earnings-cell { grid-column: 1 / -1; border-bottom: none !important; }
        }

        .indicator-rows {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0 32px;
        }
        .indicator-row {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 11px 0;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .indicator-row:last-child { border-bottom: none; }
        .indicator-row:nth-child(3) { border-bottom: none; }

        @media (max-width: 640px) {
          .indicator-rows { grid-template-columns: 1fr !important; }
          .indicator-row:nth-child(3) { border-bottom: 1px solid rgba(255,255,255,0.06); }
          .indicator-row:last-child { border-bottom: none; }
          .indicator-row { flex-direction: column; align-items: flex-start; gap: 3px; }
        }

        .factor-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
        .earningsMetricGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; }
        .earningsDotGrid { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
        .yearlyEarningsGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
        .learn-grid { display: grid; gap: 0; }
        .explore-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }

        a:hover { filter: brightness(1.06); transform: translateY(-1px); }

        @media (max-width: 900px) {
          .stock-wrap { padding: 0 16px; }
          .factor-grid { grid-template-columns: 1fr !important; }
          .explore-grid { grid-template-columns: 1fr !important; }
          .earningsMetricGrid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }

        @media (max-width: 640px) {
          .stock-wrap { padding: 0 14px; }
          .earningsMetricGrid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .explore-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </main>
  );
}

function chartLinkStyle(tone: "blue" | "red" | "green"): React.CSSProperties {
  const map = { blue: { border: "rgba(59,130,246,0.28)", bg: "rgba(59,130,246,0.07)", color: "#bfdbfe" }, red: { border: "rgba(239,68,68,0.28)", bg: "rgba(239,68,68,0.07)", color: "#fecaca" }, green: { border: "rgba(34,197,94,0.28)", bg: "rgba(34,197,94,0.07)", color: "#bbf7d0" } };
  const s = map[tone];
  return { display: "inline-flex", alignItems: "center", padding: "7px 10px", borderRadius: 9, border: `1px solid ${s.border}`, background: s.bg, color: s.color, textDecoration: "none", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" };
}

function scoreChipStyle(tone: "green" | "yellow" | "red"): React.CSSProperties {
  return { display: "flex", flexDirection: "column", gap: 2, padding: "10px 12px", borderRadius: 10, border: `1px solid ${tone === "green" ? "rgba(34,197,94,0.18)" : tone === "red" ? "rgba(239,68,68,0.18)" : "rgba(250,204,21,0.18)"}`, background: tone === "green" ? "rgba(34,197,94,0.04)" : tone === "red" ? "rgba(239,68,68,0.04)" : "rgba(250,204,21,0.04)", position: "relative", minWidth: 110 };
}

const scoreHelpButtonStyle: React.CSSProperties = { position: "absolute", top: 8, right: 8, width: 15, height: 15, borderRadius: 999, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(15,23,42,0.90)", color: "#e2e8f0", fontSize: 10, fontWeight: 900, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 };

const scoreHelpInlineBoxStyle: React.CSSProperties = { position: "absolute", top: "100%", right: 0, zIndex: 20, marginTop: 8, padding: 12, borderRadius: 10, border: "1px solid rgba(148,163,184,0.25)", background: "#020617", color: "#f8fafc", fontSize: 12, lineHeight: 1.6, fontWeight: 500, boxShadow: "0 16px 40px rgba(0,0,0,0.65)", width: 240, maxWidth: "min(240px, 80vw)" };

function learnDotStyle(tone: "blue" | "green" | "red"): React.CSSProperties {
  const c = tone === "blue" ? "#60a5fa" : tone === "green" ? "#22c55e" : "#ef4444";
  return { width: 7, height: 7, borderRadius: 999, background: c, flex: "0 0 auto", marginTop: 5 };
}

const learnRowStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 0", borderBottom: "1px solid rgba(255,255,255,0.07)", textDecoration: "none", color: "#f1f5f9" };

const exploreCardStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)", textDecoration: "none", color: "#f1f5f9" };

export type { EarningsPeriodSummary, EarningsYearSummary };
