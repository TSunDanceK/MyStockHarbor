import type { CSSProperties } from "react";
import { Suspense } from "react";
import StockNewsTickerJump from "./StockNewsTickerJump";
import type { Metadata } from "next";
import Link from "next/link";
import {
  getStockNewsBaseData,
  getStockNewsAiData,
} from "@/lib/stock-news-data";
import { getDailyHistory } from "@/lib/server/historyCache";
import {
  computeIndicatorSeed,
  type Point,
} from "@/lib/indicators";
import PageShareBar from "@/app/components/PageShareBar";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ symbol: string }>;
};

type Quote = {
  symbol: string;
  price: number | null;
  date: string | null;
  time: string | null;
  source: string;
};

type NewsItem = {
  title: string;
  link: string;
  pubDate: string | null;
  source: string | null;
  description: string | null;
  // FMP stock-news items usually include a thumbnail image; the Google
  // News RSS fallback in lib/stock-news-data.ts does not, so this can be
  // null/undefined and rendering below must handle that gracefully.
  image?: string | null;
};

type ScoreTone = "green" | "yellow" | "red";

type NewsScoreResult = {
  score: number;
  tone: ScoreTone;
  label: string;
  reason: string;
  positives: string[];
  negatives: string[];
  confidence: "Low" | "Medium" | "High";
};

type EarningsScoreResult = {
  score: number;
  label: string;
  tone: ScoreTone;
  reason: string;
};

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

type LatestEarningsData = {
  hasStructuredData: boolean;
  tone: ScoreTone;
  toneLabel: "Good" | "Neutral" | "Weak" | "Unavailable";
  reportDate: string | null;
  fiscalDate: string | null;
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
  guidanceSummary: string | null;
  nextEarningsDate: string | null;
  recentReports: EarningsPeriodSummary[];
  yearlySummaries: EarningsYearSummary[];
  sourceNote: string;
};

type FmpEarningsSurprise = {
  date?: string;
  symbol?: string;
  actualEarningResult?: number | string | null;
  estimatedEarning?: number | string | null;
};

type FmpStableEarningsItem = {
  symbol?: string;
  date?: string;
  epsActual?: number | string | null;
  epsEstimated?: number | string | null;
  revenueActual?: number | string | null;
  revenueEstimated?: number | string | null;
  lastUpdated?: string;
};

type FmpIncomeStatement = {
  date?: string;
  calendarYear?: string;
  period?: string;
  revenue?: number | string | null;
  grossProfit?: number | string | null;
  operatingIncome?: number | string | null;
  netIncome?: number | string | null;
};

type FmpAnalystEstimate = {
  date?: string;
  estimatedRevenueAvg?: number | string | null;
  revenueAvg?: number | string | null;
  estimatedEpsAvg?: number | string | null;
  epsAvg?: number | string | null;
};

type FmpEarningsCalendarItem = {
  date?: string;
  symbol?: string;
  eps?: number | string | null;
  epsEstimated?: number | string | null;
  revenue?: number | string | null;
  revenueEstimated?: number | string | null;
};

async function fetchQuote(symbol: string): Promise<Quote | null> {
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/l/?s=${stooqSymbol}&f=sd2t2l&h&e=csv`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
    });

    if (!res.ok) return null;

    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return null;

    const row = lines[1].split(",");
    const price = Number(row[3] ?? "");

    return {
      symbol,
      price: Number.isFinite(price) ? price : null,
      date: row[1] ?? null,
      time: row[2] ?? null,
      source: "Stooq",
    };
  } catch {
    return null;
  }
}

async function fetchHistory(symbol: string): Promise<Point[]> {
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
    });

    if (!res.ok) return [];

    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 3) return [];

    const points: Point[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const date = String(cols[0] ?? "")
        .replace(/\r/g, "")
        .trim();
      const high = Number(String(cols[2] ?? "").replace(/\r/g, ""));
      const low = Number(String(cols[3] ?? "").replace(/\r/g, ""));
      const close = Number(String(cols[4] ?? "").replace(/\r/g, ""));
      const volume = Number(String(cols[5] ?? "").replace(/\r/g, ""));

      if (!date || !Number.isFinite(close)) continue;

      points.push({
        date,
        close,
        high: Number.isFinite(high) ? high : undefined,
        low: Number.isFinite(low) ? low : undefined,
        volume: Number.isFinite(volume) ? volume : undefined,
      });
    }

    return points.slice(-320);
  } catch {
    return [];
  }
}

async function fetchCompanyName(symbol: string): Promise<string> {
  try {
    const [nasdaqTxt, otherTxt] = await Promise.all([
      fetch("https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt", {
        next: { revalidate: 86400 },
      }).then((r) => r.text()),
      fetch("https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt", {
        next: { revalidate: 86400 },
      }).then((r) => r.text()),
    ]);

    const rows = `${nasdaqTxt}\n${otherTxt}`.split("\n");

    for (const row of rows) {
      const cols = row.split("|");
      if ((cols[0] ?? "").trim().toUpperCase() === symbol.toUpperCase()) {
        return (cols[1] ?? "").trim();
      }
    }

    return "";
  } catch {
    return "";
  }
}

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

function lastNum(arr: (number | null)[]) {
  return arr.length ? arr[arr.length - 1] : null;
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

function trendLabel(
  lastClose: number | null,
  ma50: number | null,
  ma200: number | null,
) {
  if (
    typeof lastClose === "number" &&
    typeof ma50 === "number" &&
    typeof ma200 === "number"
  ) {
    if (lastClose > ma50 && ma50 > ma200) return "Bullish trend";
    if (lastClose < ma50 && ma50 < ma200) return "Bearish trend";
    if (lastClose > ma200 && lastClose < ma50)
      return "Pullback in larger uptrend";
    if (lastClose < ma200 && lastClose > ma50) return "Counter-trend bounce";
  }

  return "Mixed / range";
}

function formatMoney(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toFixed(2)}`
    : "—";
}

function formatPercent(value: number | null, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatDate(value: string | null) {
  if (!value) return "Recent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatLargeMoney(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";

  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000_000_000)
    return `${sign}$${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000)
    return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatPlainDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function findClosestByDate<T extends { date?: string }>(
  items: T[],
  targetDate: string | null,
) {
  if (!items.length) return null;
  const target = dateTime(targetDate);
  if (target == null) return items[0] ?? null;

  return (
    [...items]
      .filter((item) => dateTime(item.date) != null)
      .sort(
        (a, b) =>
          Math.abs((dateTime(a.date) ?? 0) - target) -
          Math.abs((dateTime(b.date) ?? 0) - target),
      )[0] ?? null
  );
}

async function fetchFmpJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 21600 },
    });

    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function buildEarningsTone(args: {
  actualEps: number | null;
  estimatedEps: number | null;
  revenue: number | null;
  revenueEstimate: number | null;
  netIncome: number | null;
  fallbackTone: ScoreTone;
}): {
  tone: ScoreTone;
  toneLabel: "Good" | "Neutral" | "Weak" | "Unavailable";
} {
  const epsSurprisePercent =
    typeof args.actualEps === "number" &&
    typeof args.estimatedEps === "number" &&
    args.estimatedEps !== 0
      ? ((args.actualEps - args.estimatedEps) / Math.abs(args.estimatedEps)) *
        100
      : null;

  const revenueSurprisePercent =
    typeof args.revenue === "number" &&
    typeof args.revenueEstimate === "number" &&
    args.revenueEstimate !== 0
      ? ((args.revenue - args.revenueEstimate) /
          Math.abs(args.revenueEstimate)) *
        100
      : null;

  const hasStructuredComparison =
    typeof epsSurprisePercent === "number" ||
    typeof revenueSurprisePercent === "number";

  if (!hasStructuredComparison && typeof args.netIncome !== "number") {
    return { tone: args.fallbackTone, toneLabel: "Unavailable" };
  }

  let score = 0;

  if (typeof epsSurprisePercent === "number") {
    if (epsSurprisePercent >= 2) score += 1;
    if (epsSurprisePercent <= -2) score -= 1;
  }

  if (typeof revenueSurprisePercent === "number") {
    if (revenueSurprisePercent >= 1) score += 1;
    if (revenueSurprisePercent <= -1) score -= 1;
  }

  if (typeof args.netIncome === "number") {
    if (args.netIncome > 0) score += 0.5;
    if (args.netIncome < 0) score -= 0.5;
  }

  if (score >= 1.5) return { tone: "green", toneLabel: "Good" };
  if (score <= -1) return { tone: "red", toneLabel: "Weak" };
  return { tone: "yellow", toneLabel: "Neutral" };
}

function quarterLabel(dateValue: string | null | undefined) {
  if (!dateValue) return "Recent";
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateValue;
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `Q${quarter} ${String(date.getUTCFullYear()).slice(-2)}`;
}

function completedEarningsTone(item: FmpStableEarningsItem): EarningsPeriodSummary["tone"] {
  const actualEps = safeNumber(item.epsActual);
  const estimatedEps = safeNumber(item.epsEstimated);
  const revenue = safeNumber(item.revenueActual);
  const revenueEstimate = safeNumber(item.revenueEstimated);

  const epsSurprisePercent =
    typeof actualEps === "number" &&
    typeof estimatedEps === "number" &&
    estimatedEps !== 0
      ? ((actualEps - estimatedEps) / Math.abs(estimatedEps)) * 100
      : null;

  const revenueSurprisePercent =
    typeof revenue === "number" &&
    typeof revenueEstimate === "number" &&
    revenueEstimate !== 0
      ? ((revenue - revenueEstimate) / Math.abs(revenueEstimate)) * 100
      : null;

  let score = 0;

  if (typeof epsSurprisePercent === "number") {
    if (epsSurprisePercent >= 2) score += 1;
    if (epsSurprisePercent <= -2) score -= 1;
  }

  if (typeof revenueSurprisePercent === "number") {
    if (revenueSurprisePercent >= 1) score += 1;
    if (revenueSurprisePercent <= -1) score -= 1;
  }

  if (typeof actualEps === "number" && actualEps < 0) score -= 0.25;

  if (score >= 1) return "green";
  if (score <= -1) return "red";
  return "yellow";
}

function earningsToneLabel(tone: ScoreTone): "Good" | "Neutral" | "Weak" {
  if (tone === "green") return "Good";
  if (tone === "red") return "Weak";
  return "Neutral";
}

function buildRecentEarningsReports(items: FmpStableEarningsItem[]): EarningsPeriodSummary[] {
  return items.slice(0, 6).map((item) => {
    const tone = completedEarningsTone(item);
    const actualEps = safeNumber(item.epsActual);
    const estimatedEps = safeNumber(item.epsEstimated);
    const revenue = safeNumber(item.revenueActual);
    const revenueEstimate = safeNumber(item.revenueEstimated);
    const epsSurprisePercent =
      typeof actualEps === "number" &&
      typeof estimatedEps === "number" &&
      estimatedEps !== 0
        ? ((actualEps - estimatedEps) / Math.abs(estimatedEps)) * 100
        : null;
    const revenueSurprisePercent =
      typeof revenue === "number" &&
      typeof revenueEstimate === "number" &&
      revenueEstimate !== 0
        ? ((revenue - revenueEstimate) / Math.abs(revenueEstimate)) * 100
        : null;

    return {
      label: quarterLabel(item.date),
      date: item.date ?? null,
      tone,
      toneLabel: earningsToneLabel(tone),
      actualEps,
      estimatedEps,
      epsSurprisePercent,
      revenueSurprisePercent,
    };
  });
}

function buildYearlyEarningsSummaries(items: FmpStableEarningsItem[]): EarningsYearSummary[] {
  const byYear = new Map<string, EarningsPeriodSummary[]>();

  for (const item of items) {
    if (!item.date) continue;
    const year = item.date.slice(0, 4);
    if (!/^\d{4}$/.test(year)) continue;

    const tone = completedEarningsTone(item);
    const actualEps = safeNumber(item.epsActual);
    const estimatedEps = safeNumber(item.epsEstimated);
    const revenue = safeNumber(item.revenueActual);
    const revenueEstimate = safeNumber(item.revenueEstimated);
    const epsSurprisePercent =
      typeof actualEps === "number" &&
      typeof estimatedEps === "number" &&
      estimatedEps !== 0
        ? ((actualEps - estimatedEps) / Math.abs(estimatedEps)) * 100
        : null;
    const revenueSurprisePercent =
      typeof revenue === "number" &&
      typeof revenueEstimate === "number" &&
      revenueEstimate !== 0
        ? ((revenue - revenueEstimate) / Math.abs(revenueEstimate)) * 100
        : null;

    const entry: EarningsPeriodSummary = {
      label: quarterLabel(item.date),
      date: item.date,
      tone,
      toneLabel: earningsToneLabel(tone),
      actualEps,
      estimatedEps,
      epsSurprisePercent,
      revenueSurprisePercent,
    };

    const current = byYear.get(year) ?? [];
    current.push(entry);
    byYear.set(year, current);
  }

  return [...byYear.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .slice(0, 5)
    .map(([year, entries]) => {
      const goodCount = entries.filter((item) => item.tone === "green").length;
      const neutralCount = entries.filter((item) => item.tone === "yellow").length;
      const weakCount = entries.filter((item) => item.tone === "red").length;
      let tone: ScoreTone = "yellow";

      if (goodCount > weakCount && goodCount >= neutralCount) tone = "green";
      if (weakCount > goodCount && weakCount >= neutralCount) tone = "red";

      return {
        year,
        tone,
        toneLabel: earningsToneLabel(tone),
        goodCount,
        neutralCount,
        weakCount,
      };
    });
}

function earningsToneScore(earnings: LatestEarningsData) {
  if (!earnings.hasStructuredData) return 50;
  if (earnings.tone === "green") return 78;
  if (earnings.tone === "red") return 28;
  return 55;
}

async function getLatestEarningsData(
  symbol: string,
  fallbackEarningsScore: EarningsScoreResult,
): Promise<LatestEarningsData> {
  const apiKey = process.env.FMP_API_KEY;

  const empty: LatestEarningsData = {
    hasStructuredData: false,
    tone: fallbackEarningsScore.tone,
    toneLabel: "Unavailable",
    reportDate: null,
    fiscalDate: null,
    actualEps: null,
    estimatedEps: null,
    epsSurprise: null,
    epsSurprisePercent: null,
    revenue: null,
    revenueEstimate: null,
    revenueSurprise: null,
    revenueSurprisePercent: null,
    grossMargin: null,
    operatingMargin: null,
    netIncome: null,
    guidanceSummary: null,
    nextEarningsDate: null,
    recentReports: [],
    yearlySummaries: [],
    sourceNote: "Structured earnings data is unavailable right now.",
  };

  if (!apiKey) return empty;

  const encoded = encodeURIComponent(symbol);
  const key = encodeURIComponent(apiKey);

  const [stableEarnings, stableIncomeStatements, legacyIncomeStatements, analystEstimates, surprisesA, surprisesB] =
    await Promise.all([
      fetchFmpJson<FmpStableEarningsItem[]>(
        `https://financialmodelingprep.com/stable/earnings?symbol=${encoded}&apikey=${key}`,
      ),
      fetchFmpJson<FmpIncomeStatement[]>(
        `https://financialmodelingprep.com/stable/income-statement?symbol=${encoded}&period=quarter&limit=6&apikey=${key}`,
      ),
      fetchFmpJson<FmpIncomeStatement[]>(
        `https://financialmodelingprep.com/api/v3/income-statement/${encoded}?period=quarter&limit=6&apikey=${key}`,
      ),
      fetchFmpJson<FmpAnalystEstimate[]>(
        `https://financialmodelingprep.com/api/v3/analyst-estimates/${encoded}?period=quarter&limit=8&apikey=${key}`,
      ),
      fetchFmpJson<FmpEarningsSurprise[]>(
        `https://financialmodelingprep.com/api/v3/earnings-surprises/${encoded}?apikey=${key}`,
      ),
      fetchFmpJson<FmpEarningsSurprise[]>(
        `https://financialmodelingprep.com/api/v3/earning_surprises/${encoded}?apikey=${key}`,
      ),
    ]);

  const earningsRows = Array.isArray(stableEarnings) ? stableEarnings : [];

  const completedEarningsRows = [...earningsRows]
    .filter((item) => {
      const itemTime = dateTime(item.date);
      if (itemTime == null || itemTime > Date.now()) return false;

      return (
        typeof safeNumber(item.epsActual) === "number" ||
        typeof safeNumber(item.revenueActual) === "number"
      );
    })
    .sort((a, b) => (dateTime(b.date) ?? 0) - (dateTime(a.date) ?? 0));

  const latestCompletedEarnings = completedEarningsRows[0] ?? null;

  const nextEarningsRow = [...earningsRows]
    .filter((item) => {
      const itemTime = dateTime(item.date);
      if (itemTime == null || itemTime <= Date.now()) return false;

      return (
        safeNumber(item.epsActual) == null &&
        safeNumber(item.revenueActual) == null
      );
    })
    .sort((a, b) => (dateTime(a.date) ?? 0) - (dateTime(b.date) ?? 0))[0] ?? null;

  const surprises =
    Array.isArray(surprisesA) && surprisesA.length
      ? surprisesA
      : Array.isArray(surprisesB)
        ? surprisesB
        : [];

  const statements = Array.isArray(stableIncomeStatements) && stableIncomeStatements.length
    ? stableIncomeStatements
    : Array.isArray(legacyIncomeStatements)
      ? legacyIncomeStatements
      : [];

  const estimates = Array.isArray(analystEstimates) ? analystEstimates : [];
  const today = Date.now();

  const latestSurprise =
    [...surprises]
      .filter(
        (item) =>
          dateTime(item.date) != null && (dateTime(item.date) ?? 0) <= today,
      )
      .sort((a, b) => (dateTime(b.date) ?? 0) - (dateTime(a.date) ?? 0))[0] ??
    null;

  const reportDate = latestCompletedEarnings?.date ?? latestSurprise?.date ?? null;

  const latestStatement =
    findClosestByDate(statements, reportDate) ??
    [...statements]
      .filter((item) => dateTime(item.date) != null)
      .sort((a, b) => (dateTime(b.date) ?? 0) - (dateTime(a.date) ?? 0))[0] ??
    null;

  const matchedEstimate = findClosestByDate(estimates, reportDate);

  const actualEps =
    safeNumber(latestCompletedEarnings?.epsActual) ??
    safeNumber(latestSurprise?.actualEarningResult) ??
    null;

  const estimatedEps =
    safeNumber(latestCompletedEarnings?.epsEstimated) ??
    safeNumber(latestSurprise?.estimatedEarning) ??
    safeNumber(matchedEstimate?.estimatedEpsAvg) ??
    safeNumber(matchedEstimate?.epsAvg) ??
    null;

  const revenue =
    safeNumber(latestCompletedEarnings?.revenueActual) ??
    safeNumber(latestStatement?.revenue) ??
    null;

  const revenueEstimate =
    safeNumber(latestCompletedEarnings?.revenueEstimated) ??
    safeNumber(matchedEstimate?.estimatedRevenueAvg) ??
    safeNumber(matchedEstimate?.revenueAvg) ??
    null;

  const grossProfit = safeNumber(latestStatement?.grossProfit);
  const operatingIncome = safeNumber(latestStatement?.operatingIncome);
  const netIncome = safeNumber(latestStatement?.netIncome);

  const epsSurprise =
    typeof actualEps === "number" && typeof estimatedEps === "number"
      ? actualEps - estimatedEps
      : null;

  const epsSurprisePercent =
    typeof epsSurprise === "number" &&
    typeof estimatedEps === "number" &&
    estimatedEps !== 0
      ? (epsSurprise / Math.abs(estimatedEps)) * 100
      : null;

  const revenueSurprise =
    typeof revenue === "number" && typeof revenueEstimate === "number"
      ? revenue - revenueEstimate
      : null;

  const revenueSurprisePercent =
    typeof revenueSurprise === "number" &&
    typeof revenueEstimate === "number" &&
    revenueEstimate !== 0
      ? (revenueSurprise / Math.abs(revenueEstimate)) * 100
      : null;

  const grossMargin =
    typeof grossProfit === "number" &&
    typeof revenue === "number" &&
    revenue !== 0
      ? (grossProfit / revenue) * 100
      : null;

  const operatingMargin =
    typeof operatingIncome === "number" &&
    typeof revenue === "number" &&
    revenue !== 0
      ? (operatingIncome / revenue) * 100
      : null;

  const tone = buildEarningsTone({
    actualEps,
    estimatedEps,
    revenue,
    revenueEstimate,
    netIncome,
    fallbackTone: fallbackEarningsScore.tone,
  });

  const hasStructuredData = Boolean(
    reportDate ||
    typeof actualEps === "number" ||
    typeof estimatedEps === "number" ||
    typeof revenue === "number" ||
    typeof revenueEstimate === "number" ||
    typeof netIncome === "number",
  );

  const recentReports = buildRecentEarningsReports(completedEarningsRows);
  const yearlySummaries = buildYearlyEarningsSummaries(completedEarningsRows);

  return {
    hasStructuredData,
    tone: hasStructuredData ? tone.tone : fallbackEarningsScore.tone,
    toneLabel: hasStructuredData ? tone.toneLabel : "Unavailable",
    reportDate,
    fiscalDate: latestStatement?.date ?? reportDate,
    actualEps,
    estimatedEps,
    epsSurprise,
    epsSurprisePercent,
    revenue,
    revenueEstimate,
    revenueSurprise,
    revenueSurprisePercent,
    grossMargin,
    operatingMargin,
    netIncome,
    guidanceSummary: null,
    nextEarningsDate: nextEarningsRow?.date ?? null,
    recentReports,
    yearlySummaries,
    sourceNote: hasStructuredData
      ? "Structured earnings data from Financial Modeling Prep. Latest completed report is selected before upcoming report dates. Guidance is shown only when available from structured data."
      : "Structured earnings data is unavailable right now.",
  };
}

function compactSource(source: string | null) {
  if (!source) return "Publisher";
  return source.replace(/\s+News$/i, "").trim();
}

function keywordHits(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function scoreNews(news: NewsItem[]): NewsScoreResult {
  if (!news.length) {
    return {
      score: 50,
      tone: "yellow",
      label: "Neutral",
      reason:
        "There are not enough fresh headlines here to lean clearly bullish or bearish, so the score stays neutral.",
      positives: [],
      negatives: [],
      confidence: "Low",
    };
  }

  const ranked = [...news].sort((a, b) => {
    const scoreDiff = scoreNewsItem(b) - scoreNewsItem(a);
    if (scoreDiff !== 0) return scoreDiff;

    const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return bTime - aTime;
  });

  const highValue = ranked.filter((item) => !isLowValueNewsItem(item));
  const candidates = (highValue.length ? highValue : ranked).slice(0, 5);

  const positiveTitles: string[] = [];
  const negativeTitles: string[] = [];

  let weightedSum = 0;
  let totalWeight = 0;
  let signalCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    const title = item.title.toLowerCase();

    const positionWeight =
      i === 0 ? 1.35 : i === 1 ? 1.18 : i === 2 ? 1.02 : 0.9;
    let itemScore = 0;

    const strongPositive = [
      "beat","beats","strong","surge","record","upgrade","buy rating","top pick",
      "price target raised","raises guidance","growth","expansion","partnership",
      "wins","rebound","demand","momentum","profit jump",
    ];

    const moderatePositive = [
      "launch","production","deliveries","delivery","analyst","bullish","margin",
      "forecast","outlook","sec filing","insider buy",
    ];

    const strongNegative = [
      "miss","misses","warning","downgrade","sell rating","price target cut",
      "lawsuit","probe","investigation","recall","delay","cuts guidance","weak",
      "slump","plunge","loss",
    ];

    const moderateNegative = [
      "falls","drop","soft","tariff","concern","pressure","decline","headwinds",
      "insider sale","tax-driven share sale",
    ];

    if (keywordHits(title, strongPositive)) itemScore += 3.2;
    if (keywordHits(title, moderatePositive)) itemScore += 1.4;
    if (keywordHits(title, strongNegative)) itemScore -= 3.2;
    if (keywordHits(title, moderateNegative)) itemScore -= 1.4;

    if (
      keywordHits(title, ["earnings","results","revenue","guidance","quarter"]) &&
      keywordHits(title, ["beat","beats","strong","raises","growth","record"])
    ) {
      itemScore += 2.2;
    }

    if (
      keywordHits(title, ["earnings","results","revenue","guidance","quarter"]) &&
      keywordHits(title, ["miss","warning","cuts","weak","loss"])
    ) {
      itemScore -= 2.2;
    }

    if (
      keywordHits(title, ["insider","cfo","director","executive"]) &&
      keywordHits(title, ["tax-driven","rsu","vesting"])
    ) {
      itemScore += 0.5;
    }

    if (itemScore > 0.75) {
      positiveTitles.push(item.title);
      signalCount += 1;
    } else if (itemScore < -0.75) {
      negativeTitles.push(item.title);
      signalCount += 1;
    }

    weightedSum += itemScore * positionWeight;
    totalWeight += positionWeight;
  }

  if (!totalWeight) {
    return {
      score: 50,
      tone: "yellow",
      label: "Neutral",
      reason: "There is not enough usable headline detail here to push sentiment strongly either way.",
      positives: [],
      negatives: [],
      confidence: "Low",
    };
  }

  const avg = weightedSum / totalWeight;

  let rawScore = 50 + avg * 11;

  if (signalCount >= 3) rawScore += avg > 0 ? 4 : avg < 0 ? -4 : 0;
  if (signalCount >= 4) rawScore += avg > 0 ? 2 : avg < 0 ? -2 : 0;

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let tone: ScoreTone = "yellow";
  let label = "Neutral";

  if (score >= 66) { tone = "green"; label = "Bullish"; }
  else if (score <= 34) { tone = "red"; label = "Bearish"; }
  else if (score >= 58) { tone = "green"; label = "Slightly Bullish"; }
  else if (score <= 42) { tone = "red"; label = "Slightly Bearish"; }

  const confidence: "Low" | "Medium" | "High" =
    signalCount >= 4 ? "High" : signalCount >= 2 ? "Medium" : "Low";

  let reason = "The latest headline mix looks fairly balanced, so the score stays close to neutral rather than showing a strong directional lean.";

  if (label === "Bullish") {
    reason = "Recent coverage is leaning clearly constructive, with the stronger usable headlines skewing toward upgrades, growth, better-than-feared developments, or supportive business momentum.";
  } else if (label === "Slightly Bullish") {
    reason = "Recent coverage is leaning constructive overall, although the positive read is not strong enough yet to count as a fully decisive bullish headline backdrop.";
  } else if (label === "Bearish") {
    reason = "Recent coverage is leaning clearly weaker, with the stronger usable headlines skewing toward downgrades, misses, legal or operational risk, or broader pressure on the story.";
  } else if (label === "Slightly Bearish") {
    reason = "Recent coverage is leaning a bit weaker than supportive, although the negative read is not broad or strong enough yet to count as a fully decisive bearish backdrop.";
  }

  return {
    score,
    tone,
    label,
    reason,
    positives: positiveTitles.slice(0, 3),
    negatives: negativeTitles.slice(0, 3),
    confidence,
  };
}

function scoreEarnings(news: NewsItem[]) {
  const ranked = [...news].sort((a, b) => {
    const scoreDiff = scoreNewsItem(b) - scoreNewsItem(a);
    if (scoreDiff !== 0) return scoreDiff;
    const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return bTime - aTime;
  });

  const earningsNews = ranked.filter(
    (item) =>
      !isLowValueNewsItem(item) &&
      keywordHits(item.title, ["earnings","results","revenue","guidance","quarter","q1","q2","q3","q4"]),
  );

  if (!earningsNews.length) {
    return {
      score: 50,
      tone: "yellow" as ScoreTone,
      label: "No clear earnings read",
      reason: "There is not enough obvious earnings-specific coverage in the latest higher-value headlines to push this score strongly either way.",
    };
  }

  let raw = 50;

  earningsNews.slice(0, 4).forEach((item, index) => {
    const weight = index === 0 ? 1.3 : index === 1 ? 1.15 : 1;
    const title = item.title.toLowerCase();

    if (keywordHits(title, ["beat","beats","strong","raises","growth","tops","record"])) raw += 9 * weight;
    if (keywordHits(title, ["miss","cuts","warning","weak","drops","loss"])) raw -= 9 * weight;
  });

  const score = Math.max(0, Math.min(100, Math.round(raw)));

  let tone: ScoreTone = "yellow";
  let label = "Mixed earnings tone";
  let reason = "Recent earnings-linked headlines are mixed, so the score stays close to the middle.";

  if (score >= 64) {
    tone = "green";
    label = "Positive earnings tone";
    reason = "The earnings-linked headlines look more constructive than negative, which may help support confidence in the next leg of the story.";
  } else if (score <= 36) {
    tone = "red";
    label = "Weak earnings tone";
    reason = "The earnings-linked headlines look more pressured than supportive, which can weigh on sentiment until the business story improves again.";
  }

  return { score, tone, label, reason };
}

function buildLeadSummary(args: {
  symbol: string;
  companyName: string;
  trend: string;
  newsScore: NewsScoreResult;
  earningsScore: { score: number; tone: ScoreTone; label: string; reason: string; };
}) {
  const { symbol, companyName, trend, newsScore, earningsScore } = args;
  const lead = companyName ? `${companyName} (${symbol})` : symbol;
  return `${lead} is currently showing a ${newsScore.label.toLowerCase()} headline tone with a ${trend.toLowerCase()} backdrop. The latest news flow is being framed here as context rather than prediction, so beginners can quickly see whether headlines are helping, hurting, or complicating the chart story. Earnings tone is currently ${earningsScore.label.toLowerCase()}.`;
}

function buildNewsSummary(item: NewsItem, symbol: string, trend: string, newsScore: NewsScoreResult) {
  const source = compactSource(item.source);
  const lower = item.title.toLowerCase();

  if (keywordHits(lower, ["earnings","results","revenue","guidance","quarter"])) {
    return `${source} is highlighting an earnings-related update for ${symbol}. Recent coverage is focusing on whether the latest results or guidance shift expectations for the next phase of the stock story.`;
  }
  if (keywordHits(lower, ["upgrade","downgrade","price target","analyst"])) {
    return `${source} is focusing on analyst sentiment around ${symbol}. That can matter for short-term attention, especially when the chart is already leaning in the same direction.`;
  }
  if (keywordHits(lower, ["delivery","deliveries","production","factory","supply"])) {
    return `${source} is focusing on operating execution around ${symbol}. The latest coverage suggests traders are watching whether real business performance is lining up with the bigger growth narrative.`;
  }
  if (keywordHits(lower, ["lawsuit","probe","investigation","recall"])) {
    return `${source} is highlighting a risk-related development around ${symbol}. Recent headlines suggest the market may need time to judge whether this is temporary noise or a more durable problem.`;
  }
  if (keywordHits(lower, ["ai","chip","product","launch","software"])) {
    return `${source} is discussing product or theme momentum around ${symbol}. That can help explain why investors stay engaged with the stock, especially when the broader setup already looks active.`;
  }
  if (keywordHits(lower, ["market","sector","fed","rates","tariff"])) {
    return `${source} is framing ${symbol} inside a wider market or sector story. That matters because a stock move is not always driven by company-specific news alone.`;
  }
  if (newsScore.tone === "red" && trend === "Bearish trend") {
    return `${source} is drawing attention to a development that fits into an already softer backdrop for ${symbol}.`;
  }
  if (newsScore.tone === "green" && trend === "Bullish trend") {
    return `${source} is highlighting a development that may support an already stronger backdrop for ${symbol}.`;
  }
  return `${source} is drawing attention to a recent development around ${symbol}. Traders will usually care most about whether the stock shows real follow-through after the market has time to digest the headline.`;
}

function buildWhyItMatters(item: NewsItem, symbol: string, trend: string, newsScore: NewsScoreResult) {
  const lower = item.title.toLowerCase();

  if (keywordHits(lower, ["earnings","results","revenue","guidance","quarter"])) {
    return `Quarterly updates can reset expectations quickly, so even one earnings-related headline can change how investors frame ${symbol} in the near term.`;
  }
  if (keywordHits(lower, ["upgrade","downgrade","price target","analyst"])) {
    return `Analyst calls can shift attention fast, but they usually matter more when price action starts confirming the same message.`;
  }
  if (keywordHits(lower, ["delivery","deliveries","production","factory","supply"])) {
    return `Execution headlines matter because investors want proof that the business story is holding up in real operations, not just in market hype.`;
  }
  if (keywordHits(lower, ["lawsuit","probe","investigation","recall"])) {
    return `Risk headlines can weigh on sentiment because uncertainty often stays in the stock until the market sees the issue is contained.`;
  }
  if (keywordHits(lower, ["ai","chip","product","launch","software"])) {
    return `Product and theme headlines matter when traders are trying to decide whether a stock still has a strong reason to stay in focus.`;
  }
  if (keywordHits(lower, ["market","sector","fed","rates","tariff"])) {
    return `Sometimes a stock reacts more to the environment around it than to company-specific news, so broader context can matter more than one isolated headline.`;
  }
  if (newsScore.tone === "green" && trend === "Bullish trend") {
    return `The headline matters more when the chart is already supportive, because news and price structure are pulling in the same direction.`;
  }
  if (newsScore.tone === "red" && trend === "Bearish trend") {
    return `The headline matters more when the chart is already weak, because bad news has less technical support underneath it.`;
  }
  return `This matters mainly because traders now watch whether the chart absorbs the headline calmly or starts to break in response.`;
}

function isLowValueNewsItem(item: NewsItem) {
  const title = item.title.toLowerCase();
  const source = (item.source ?? "").toLowerCase();

  const lowValuePatterns = [
    "stock price","current price","live price","price chart","quote today","stock quote",
    "company profile","market cap","forecast 2025","forecast 2026","forecast 2030",
    "buy sell hold","prediction","how to buy","review","price prediction","current chart",
  ];

  const lowValueSources = ["financialcontent","capital.com"];

  if (lowValuePatterns.some((pattern) => title.includes(pattern))) return true;

  if (
    lowValueSources.includes(source) &&
    !keywordHits(title, ["earnings","revenue","guidance","analyst","upgrade","downgrade","price target","delivery","deliveries","production","lawsuit","investigation","recall","partnership","launch","insider","sec"])
  ) {
    return true;
  }

  return false;
}

function scoreNewsItem(item: NewsItem) {
  const title = item.title.toLowerCase();
  const source = (item.source ?? "").toLowerCase();
  let score = 0;

  const strongSignals = [
    "earnings","results","revenue","guidance","quarter","analyst","upgrade","downgrade",
    "price target","delivery","deliveries","production","factory","supply","recall",
    "investigation","lawsuit","probe","launch","partnership","acquisition","margin",
    "forecast","insider","sec","tariff","fed","regulation","robotaxi","autonomous",
  ];

  const weakSignals = [
    "stock price","current price","live price","price chart","quote today","stock quote",
    "company profile","market cap","prediction","buy sell hold","how to buy","review",
  ];

  for (const term of strongSignals) { if (title.includes(term)) score += 3; }
  for (const term of weakSignals) { if (title.includes(term)) score -= 4; }

  if (item.description && item.description.trim().length > 80) score += 1;

  if (source.includes("reuters")) score += 3;
  if (source.includes("barron")) score += 2;
  if (source.includes("marketwatch")) score += 2;
  if (source.includes("stock titan")) score += 2;
  if (source.includes("financialcontent")) score -= 2;
  if (source.includes("capital.com")) score -= 2;

  const pubTime = item.pubDate ? new Date(item.pubDate).getTime() : 0;
  if (pubTime) {
    const ageHours = (Date.now() - pubTime) / (1000 * 60 * 60);
    if (ageHours <= 24) score += 3;
    else if (ageHours <= 72) score += 2;
    else if (ageHours <= 168) score += 1;
  }

  return score;
}

function buildWhatItMeans(args: {
  symbol: string;
  trend: string;
  newsScore: NewsScoreResult;
  rsi: number | null;
  priceVs50: number | null;
}) {
  const { symbol, trend, newsScore, rsi, priceVs50 } = args;
  const lines: string[] = [];

  if (newsScore.tone === "green" && trend === "Bullish trend") {
    lines.push(`${symbol} has a cleaner backdrop when positive headlines are landing into an already supportive chart, because the news and the structure are pointing in the same direction.`);
  } else if (newsScore.tone === "green") {
    lines.push(`The recent headline flow for ${symbol} looks better than the chart structure, so traders may now watch for stronger price confirmation rather than assuming the story has already fully improved.`);
  } else if (newsScore.tone === "red" && trend === "Bearish trend") {
    lines.push(`${symbol} looks more vulnerable when weaker headlines arrive into an already soft chart, because negative news has less technical support underneath it.`);
  } else if (newsScore.tone === "red") {
    lines.push(`The chart may still be holding up better than the recent headline tone, but traders will watch whether weaker coverage starts damaging support or simply gets absorbed.`);
  } else {
    lines.push(`${symbol} currently sits in a more mixed zone where headline tone alone is unlikely to settle the next move without clearer price confirmation.`);
  }

  if (typeof rsi === "number" && rsi >= 70) {
    lines.push(`Momentum already looks warm, so even strong news may lead to pause-and-hold behaviour before the next cleaner move higher.`);
  } else if (typeof rsi === "number" && rsi <= 35) {
    lines.push(`Momentum is softer, which means modestly better news could matter more than usual if traders start looking for stabilisation or rebound attempts.`);
  }

  if (typeof priceVs50 === "number" && priceVs50 >= 10) {
    lines.push(`Because ${symbol} is already stretched above the 50-day average, the next bullish step often depends on support holding rather than on endless excitement.`);
  } else if (typeof priceVs50 === "number" && priceVs50 <= -10) {
    lines.push(`Because ${symbol} is trading well below the 50-day average, stronger headlines may first need to repair damage before the market treats them as a fresh uptrend signal.`);
  }

  return lines.slice(0, 3);
}

function buildBeyondHeadline(args: {
  symbol: string;
  newsScore: NewsScoreResult;
  trend: string;
  recentHigh: number | null;
  recentLow: number | null;
}) {
  const { symbol, newsScore, trend, recentHigh, recentLow } = args;

  if (newsScore.tone === "red" && trend !== "Bearish trend") {
    return `The outside-the-box read for ${symbol} is that apparently bad news does not always become lasting damage. If price keeps holding above important structure despite weaker headlines, that can mean some fear was already priced in or that stronger hands are still supporting the stock.`;
  }
  if (newsScore.tone === "green" && trend === "Bearish trend") {
    return `The outside-the-box read for ${symbol} is that good news can still disappoint if the chart remains weak. Traders often want to see reclaim attempts and better price behaviour before assuming the headlines have truly changed the bigger trend.`;
  }
  if (typeof recentHigh === "number" && typeof recentLow === "number") {
    return `${symbol} may not need perfect headlines to improve. Sometimes the more important clue is whether the stock stops making lower lows near ${formatMoney(recentLow)} and starts building toward resistance near ${formatMoney(recentHigh)}. That kind of behaviour can quietly matter more than a dramatic headline.`;
  }
  return `The deeper read for ${symbol} is that headlines often matter most when they confirm or challenge the chart at a key moment. Good news is most useful when it attracts follow-through. Bad news is most dangerous when support is already fragile.`;
}

function buildTechnicalRead(args: {
  symbol: string;
  price: number | null;
  ma50: number | null;
  ma200: number | null;
  trend: string;
  rsi: number | null;
  priceVs50: number | null;
  priceVs200: number | null;
}) {
  const { symbol, price, ma50, ma200, trend, rsi, priceVs50, priceVs200 } = args;

  const trendText =
    trend === "Bullish trend"
      ? `${symbol} is trading in a stronger trend structure, with price holding above the shorter and longer trend references.`
      : trend === "Bearish trend"
        ? `${symbol} is trading in a weaker trend structure, with price still sitting below key trend references.`
        : `${symbol} is not giving a fully clean trend read right now, which makes the quality of follow-through especially important.`;

  let momentumText = "Momentum is not especially stretched right now, so price behaviour around fresh headlines may matter more than an extreme oscillator reading.";
  if (typeof rsi === "number" && rsi >= 70) momentumText = "Momentum looks hot rather than calm, which can support strength but also raises the chance of chop, pause, or pullback after fast gains.";
  else if (typeof rsi === "number" && rsi <= 30) momentumText = "Momentum looks washed out rather than strong, which can create rebound interest but does not by itself prove a durable reversal.";

  const levelText = `Last price is ${formatMoney(price)}, versus MA50 at ${formatMoney(ma50)} and MA200 at ${formatMoney(ma200)}. Relative to those reference points, ${symbol} is ${formatPercent(priceVs50)} vs MA50 and ${formatPercent(priceVs200)} vs MA200.`;

  return { trendText, momentumText, levelText };
}

function getArticleSnippet(item: NewsItem, symbol: string) {
  const text = item.description?.replace(/\s+/g, " ").trim();
  if (text && text.length >= 40) return text.length > 520 ? `${text.slice(0, 520).trim()}…` : text;
  return `${item.title} is one of the latest ${symbol} headlines from ${compactSource(item.source)}. Use the full article link for the complete source context.`;
}

function structuredNews(news: NewsItem[], summaryByTitle: Record<string, string>) {
  return news.map((item) => ({
    "@type": "NewsArticle",
    headline: item.title,
    datePublished: item.pubDate,
    description: summaryByTitle[item.title] ?? item.description ?? undefined,
    publisher: { "@type": "Organization", name: compactSource(item.source) },
  }));
}

async function fetchQuoteForMeta(symbol: string): Promise<{ price: number | null; date: string | null }> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { price: null, date: null };
  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { next: { revalidate: 900 }, headers: { accept: "application/json" } });
    if (!res.ok) return { price: null, date: null };
    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;
    const price = typeof row?.price === "number" && Number.isFinite(row.price) ? (row.price as number) : null;
    return { price, date: new Date().toISOString().slice(0, 10) };
  } catch {
    return { price: null, date: null };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  const [rawHistory, { price, date }] = await Promise.all([
    getDailyHistory(upper).catch(() => []),
    fetchQuoteForMeta(upper),
  ]);

  const points: Point[] = (rawHistory as Point[]).filter(
    (p) => p.date && Number.isFinite(p.close)
  );

  const seed = computeIndicatorSeed(points, "", price, date);

  const priceStr = seed.lastClose != null ? ` — Price $${seed.lastClose.toFixed(2)}` : "";
  const trendStr = seed.trend ? `, ${seed.trend}` : "";

  const title = `${upper} Stock News${priceStr} | MyStockHarbor`;
  const description = `Latest ${upper} stock news with beginner-friendly summaries${trendStr}. Headline sentiment score, earnings context and chart analysis on MyStockHarbor.`;

  return {
    title,
    description,
    alternates: { canonical: `https://www.mystockharbor.com/stock/${upper}/news` },
    openGraph: {
      title: `${upper} Stock News & Analysis | MyStockHarbor`,
      description,
      url: `https://www.mystockharbor.com/stock/${upper}/news`,
      siteName: "MyStockHarbor",
      type: "article",
      images: [{ url: "https://www.mystockharbor.com/og-image-v2.png", width: 1200, height: 630, alt: "MyStockHarbor stock news dashboard" }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${upper} Stock News & Analysis | MyStockHarbor`,
      description,
      images: ["https://www.mystockharbor.com/og-image-v2.png"],
    },
  };
}

async function DetailedNewsAiSection({
  aiData, symbol, companyName, trend, newsScore, detailedNews, compactNews,
}: {
  aiData: Awaited<ReturnType<typeof getStockNewsAiData>>;
  symbol: string;
  companyName: string;
  trend: string;
  newsScore: NewsScoreResult;
  detailedNews: NewsItem[];
  compactNews: NewsItem[];
}) {
  return (
    <section style={editorialCardStyle}>
      <div style={sectionEyebrowStyle}>Latest briefing</div>
      <h2 style={sectionTitleStyle}>What's happening with {symbol}</h2>
      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        {detailedNews.length ? (
          detailedNews.map((item, index) => {
            const aiBrief = aiData.aiBriefs[index];
            const hasAi = !!aiBrief?.summary?.trim() && !!aiBrief?.whyItMatters?.trim();
            return (
              <article key={`${item.link}-${index}`} style={{ ...newsLeadCardStyle, borderLeft: index === 0 ? "3px solid rgba(59,130,246,0.75)" : "3px solid rgba(255,255,255,0.08)" }}>
                {item.image ? (
                  <div style={newsThumbWrapStyle}>
                    <img src={item.image} alt="" loading="lazy" style={newsThumbImgStyle} />
                  </div>
                ) : null}
                <div style={newsMetaRowStyle}>
                  <span style={newsSourcePillStyle}>{compactSource(item.source)}</span>
                  <span style={newsDateStyle}>{formatDate(item.pubDate)}</span>
                </div>
                <h3 style={newsHeadlineStyle}>{item.title}</h3>
                <p style={newsSummaryStyle}>{getArticleSnippet(item, symbol)}</p>
                <div style={whyItMattersBoxStyle}>
                  <div style={whyItMattersLabelStyle}>Why this matters</div>
                  <div style={whyItMattersTextStyle}>{hasAi ? aiBrief!.whyItMatters : buildWhyItMatters(item, symbol, trend, newsScore)}</div>
                </div>
                <div style={{ ...sourceFooterStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <span>Article excerpt provided by the FMP news feed. AI is used only for the short investor read above.</span>
                  <a href={item.link} target="_blank" rel="noopener noreferrer" style={readArticleLinkStyle}>Read full article ↗</a>
                </div>
              </article>
            );
          })
        ) : (
          <div style={newsLeadCardStyle}>
            <h3 style={{ ...newsHeadlineStyle, marginTop: 0 }}>No fresh headline set available</h3>
            <p style={newsSummaryStyle}>This page still works as a stock-news analysis hub, but the current news feed is light.</p>
          </div>
        )}
      </div>
      {compactNews.length ? (
        <div style={{ marginTop: 16 }}>
          <div style={compactFeedLabelStyle}>Older updates drop into a lighter feed</div>
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {compactNews.map((item, index) => (
              <article key={`${item.link}-compact-${index}`} className="compactNewsRow" style={compactNewsRowStyle}>
                {item.image ? (
                  <img src={item.image} alt="" loading="lazy" style={compactThumbStyle} />
                ) : null}
                <div style={{ minWidth: 88, flexShrink: 0 }}>
                  <div style={compactSourceStyle}>{compactSource(item.source)}</div>
                  <div style={compactDateStyle}>{formatDate(item.pubDate)}</div>
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={compactHeadlineStyle}>{item.title}</div>
                </div>
                <a href={item.link} target="_blank" rel="noopener noreferrer" style={compactMutedLinkStyle}>Read ↗</a>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

async function InsightAiCard({
  aiData, symbol, companyName, trend, newsScore, earningsScore, lastRsi, priceVs50,
  priceVs200, recentHigh, recentLow, detailedNews, fallbackBeyondHeadline,
}: {
  aiData: Awaited<ReturnType<typeof getStockNewsAiData>>;
  symbol: string; companyName: string; trend: string; newsScore: NewsScoreResult;
  earningsScore: { score: number; label: string; tone: ScoreTone; reason: string; };
  lastRsi: number | null; priceVs50: number | null; priceVs200: number | null;
  recentHigh: number | null; recentLow: number | null; detailedNews: NewsItem[];
  fallbackBeyondHeadline: string;
}) {
  const displayBeyondHeadline = aiData.aiInsight?.beyondHeadline?.trim() ? aiData.aiInsight.beyondHeadline : fallbackBeyondHeadline;
  const hasAiInsight = !!aiData.aiInsight?.beyondHeadline?.trim() && Array.isArray(aiData.aiInsight?.whatItMeans) && aiData.aiInsight.whatItMeans.length > 0;
  return (
    <section style={{ ...featuredInsightShellStyle, position: "relative" }}>
      <div style={sectionEyebrowStyle}>Beyond the headline</div>
      <h2 style={sectionTitleStyle}>A deeper look for beginners</h2>
      <p style={bodyCopyStyle}>{displayBeyondHeadline}</p>
      <div style={{ position: "absolute", right: 16, bottom: 14, fontSize: 10, opacity: 0.18, fontWeight: 700, letterSpacing: "0.08em" }}>{hasAiInsight ? "1" : "0"}</div>
    </section>
  );
}

async function GoingForwardAiCard({
  aiData, symbol, companyName, trend, newsScore, earningsScore, lastRsi, priceVs50,
  priceVs200, recentHigh, recentLow, detailedNews, fallbackWhatItMeans,
}: {
  aiData: Awaited<ReturnType<typeof getStockNewsAiData>>;
  symbol: string; companyName: string; trend: string; newsScore: NewsScoreResult;
  earningsScore: { score: number; label: string; tone: ScoreTone; reason: string; };
  lastRsi: number | null; priceVs50: number | null; priceVs200: number | null;
  recentHigh: number | null; recentLow: number | null; detailedNews: NewsItem[];
  fallbackWhatItMeans: string[];
}) {
  const displayWhatItMeans = aiData.aiInsight?.whatItMeans?.length ? aiData.aiInsight.whatItMeans : fallbackWhatItMeans;
  const hasAiInsight = !!aiData.aiInsight?.beyondHeadline?.trim() && Array.isArray(aiData.aiInsight?.whatItMeans) && aiData.aiInsight.whatItMeans.length > 0;
  return (
    <section style={{ ...sidebarCardStyle, position: "relative" }}>
      <div style={sectionEyebrowStyle}>What this could mean</div>
      <h2 style={sectionTitleSmallStyle}>Going Forward</h2>
      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        {displayWhatItMeans.map((line) => (
          <div key={line} style={bulletRowStyle}>
            <div style={bulletDotStyle} />
            <div style={bulletTextStyle}>{line}</div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", right: 16, bottom: 14, fontSize: 10, opacity: 0.18, fontWeight: 700, letterSpacing: "0.08em" }}>{hasAiInsight ? "1" : "0"}</div>
    </section>
  );
}

function loadingBarStyle(width: string): CSSProperties {
  return { width, height: 12, borderRadius: 999, background: "rgba(30,41,59,0.9)" };
}

function loadingParagraphStyle(widths: string[]) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {widths.map((width, index) => (
        <div key={`${width}-${index}`} className="shimmer" style={loadingBarStyle(width)} />
      ))}
    </div>
  );
}

function DetailedNewsFallback({ symbol, detailedNews, compactNews }: { symbol: string; detailedNews: NewsItem[]; compactNews: NewsItem[]; }) {
  return (
    <section style={editorialCardStyle}>
      <div style={sectionEyebrowStyle}>Latest briefing</div>
      <h2 style={sectionTitleStyle}>What's happening with {symbol}</h2>
      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        {detailedNews.length ? (
          detailedNews.map((item, index) => (
            <article key={`${item.link}-${index}`} style={{ ...newsLeadCardStyle, borderLeft: index === 0 ? "3px solid rgba(59,130,246,0.75)" : "3px solid rgba(255,255,255,0.08)" }}>
              {item.image ? (
                <div style={newsThumbWrapStyle}>
                  <img src={item.image} alt="" loading="lazy" style={newsThumbImgStyle} />
                </div>
              ) : null}
              <div style={newsMetaRowStyle}>
                <span style={newsSourcePillStyle}>{compactSource(item.source)}</span>
                <span style={newsDateStyle}>{formatDate(item.pubDate)}</span>
              </div>
              <h3 style={newsHeadlineStyle}>{item.title}</h3>
              <p style={newsSummaryStyle}>{getArticleSnippet(item, symbol)}</p>
              <div style={whyItMattersBoxStyle}>
                <div style={whyItMattersLabelStyle}>Why this matters</div>
                <div style={whyItMattersTextStyle}>The source item may affect how investors interpret {symbol}'s latest news flow.</div>
              </div>
              <div style={{ ...sourceFooterStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span>Article excerpt provided by the FMP news feed.</span>
                <a href={item.link} target="_blank" rel="noopener noreferrer" style={readArticleLinkStyle}>Read full article ↗</a>
              </div>
            </article>
          ))
        ) : (
          <div style={newsLeadCardStyle}>
            <h3 style={{ ...newsHeadlineStyle, marginTop: 0 }}>No fresh headline set available</h3>
            <p style={newsSummaryStyle}>This page still works as a stock-news analysis hub, but the current news feed is light.</p>
          </div>
        )}
      </div>
      {compactNews.length ? (
        <div style={{ marginTop: 16 }}>
          <div style={compactFeedLabelStyle}>Older updates drop into a lighter feed</div>
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {compactNews.map((item, index) => (
              <article key={`${item.link}-compact-${index}`} className="compactNewsRow" style={compactNewsRowStyle}>
                {item.image ? (
                  <img src={item.image} alt="" loading="lazy" style={compactThumbStyle} />
                ) : null}
                <div style={{ minWidth: 88, flexShrink: 0 }}>
                  <div style={compactSourceStyle}>{compactSource(item.source)}</div>
                  <div style={compactDateStyle}>{formatDate(item.pubDate)}</div>
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={compactHeadlineStyle}>{item.title}</div>
                </div>
                <a href={item.link} target="_blank" rel="noopener noreferrer" style={compactMutedLinkStyle}>Read ↗</a>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function InsightFallbackCard() {
  return (
    <section style={{ ...featuredInsightShellStyle, position: "relative" }}>
      <div style={sectionEyebrowStyle}>Beyond the headline</div>
      <h2 style={sectionTitleStyle}>A deeper look for beginners</h2>
      <div style={{ marginTop: 16 }}>{loadingParagraphStyle(["96%", "90%", "86%", "68%"])}</div>
    </section>
  );
}

function GoingForwardFallbackCard() {
  return (
    <section style={{ ...sidebarCardStyle, position: "relative" }}>
      <div style={sectionEyebrowStyle}>What this could mean</div>
      <h2 style={sectionTitleSmallStyle}>Going Forward</h2>
      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        {[1, 2, 3].map((item) => (
          <div key={item} style={bulletRowStyle}>
            <div style={bulletDotStyle} />
            <div style={{ display: "grid", gap: 8 }}>
              <div style={loadingBarStyle(item === 1 ? "92%" : item === 2 ? "86%" : "78%")} />
              <div style={loadingBarStyle(item === 1 ? "76%" : item === 2 ? "68%" : "62%")} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function isEarningsHeadline(item: NewsItem) {
  const text = `${item.title} ${item.description ?? ""}`.toLowerCase();
  return keywordHits(text, ["earnings","eps","results","quarter","quarterly","revenue","guidance","profit","loss","margin","q1","q2","q3","q4"]);
}

function getEarningsNewsItems(news: NewsItem[]) {
  return [...news]
    .filter((item) => !isLowValueNewsItem(item) && isEarningsHeadline(item))
    .sort((a, b) => {
      const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 5);
}

function EarningsNewsSection({ symbol, earningsNews, latestEarnings }: { symbol: string; earningsNews: NewsItem[]; latestEarnings: LatestEarningsData; }) {
  return (
    <section style={editorialCardStyle}>
      <div style={sectionEyebrowStyle}>Earnings news</div>
      <h2 style={sectionTitleStyle}>{symbol} earnings headlines</h2>
      <p style={bodyCopyStyle}>This section is separated from the general news feed so investors can quickly connect the latest headlines with the structured earnings report.</p>
      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {earningsNews.length ? (
          earningsNews.slice(0, 2).map((item, index) => (
            <a key={`${item.link}-${index}`} href={item.link} target="_blank" rel="noopener noreferrer" style={earningsNewsRowStyle}>
              <div style={earningsNewsNumberStyle}>{index + 1}</div>
              {item.image ? (
                <img src={item.image} alt="" loading="lazy" style={earningsThumbStyle} />
              ) : null}
              <div style={{ minWidth: 0 }}>
                <div style={newsMetaRowStyle}>
                  <span style={newsSourcePillStyle}>{compactSource(item.source)}</span>
                  <span style={newsDateStyle}>{formatDate(item.pubDate)}</span>
                </div>
                <h3 style={earningsNewsHeadlineStyle}>{item.title}</h3>
                {item.description ? <p style={earningsNewsTextStyle}>{item.description}</p> : null}
              </div>
            </a>
          ))
        ) : (
          <div style={earningsNoNewsStyle}>
            <strong>No recent earnings-specific headlines found.</strong>
            <span>The latest structured earnings snapshot is still shown using FMP data{latestEarnings.reportDate ? ` from ${formatPlainDate(latestEarnings.reportDate)}` : ""}.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function LatestEarningsCard({ earnings, symbol }: { earnings: LatestEarningsData; symbol: string; }) {
  const toneCopy = earnings.hasStructuredData ? earnings.toneLabel : "Unavailable";
  return (
    <section style={earningsCardStyle(earnings.tone)}>
      <div style={sectionEyebrowStyle}>Latest earnings</div>
      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <h2 style={{ ...sectionTitleSmallStyle, margin: 0 }}>Earnings snapshot</h2>
        <div style={earningsTonePillStyle(earnings.tone)}>{toneCopy}</div>
      </div>
      {!earnings.hasStructuredData ? (
        <p style={bodyCopyStyle}>Structured EPS and revenue data is not available for this symbol right now. The page will show the latest reported earnings here when FMP returns usable data.</p>
      ) : (
        <>
          <div style={earningsDateRowStyle}>
            <div>
              <div style={earningsMiniLabelStyle}>Latest report</div>
              <div style={earningsMiniValueStyle}>{formatPlainDate(earnings.reportDate)}</div>
            </div>
            <div>
              <div style={earningsMiniLabelStyle}>Next earnings</div>
              <div style={earningsMiniValueStyle}>{formatPlainDate(earnings.nextEarningsDate)}</div>
            </div>
          </div>
          <div style={earningsMetricGridStyle}>
            <EarningsMetric label="Actual EPS" value={formatMoney(earnings.actualEps)} />
            <EarningsMetric label="Estimated EPS" value={formatMoney(earnings.estimatedEps)} />
            <EarningsMetric label="EPS surprise" value={formatMoney(earnings.epsSurprise)} meta={formatPercent(earnings.epsSurprisePercent, 1)} tone={metricTone(earnings.epsSurprisePercent)} />
            <EarningsMetric label="Revenue" value={formatLargeMoney(earnings.revenue)} />
            <EarningsMetric label="Revenue estimate" value={formatLargeMoney(earnings.revenueEstimate)} />
            <EarningsMetric label="Revenue surprise" value={formatLargeMoney(earnings.revenueSurprise)} meta={formatPercent(earnings.revenueSurprisePercent, 1)} tone={metricTone(earnings.revenueSurprisePercent)} />
            <EarningsMetric label="Gross margin" value={formatPercent(earnings.grossMargin, 1)} />
            <EarningsMetric label="Operating margin" value={formatPercent(earnings.operatingMargin, 1)} />
            <EarningsMetric label="Net income" value={formatLargeMoney(earnings.netIncome)} />
            <Link href={`/stock/${encodeURIComponent(symbol)}/earnings`} style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 82, borderRadius: 14, border: "1px solid rgba(59,130,246,0.32)", background: "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(15,23,42,0.30))", color: "#dbeafe", textDecoration: "none", fontSize: 13, fontWeight: 950, letterSpacing: "0.02em", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)" }}>See full report →</Link>
          </div>
          {earnings.recentReports.length ? (
            <div style={earningsTrendBoxStyle}>
              <div style={earningsMiniLabelStyle}>Recent earnings trend</div>
              <div style={earningsDotRowStyle}>
                {[...earnings.recentReports].reverse().map((item) => (
                  <div key={`${item.label}-${item.date}`} style={earningsDotItemStyle}>
                    <span style={earningsDotStyle(item.tone)} />
                    <span style={earningsDotLabelStyle}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {earnings.yearlySummaries.length ? (
            <div style={earningsTrendBoxStyle}>
              <div style={earningsMiniLabelStyle}>Yearly earnings read</div>
              <div style={yearlyEarningsGridStyle}>
                {earnings.yearlySummaries.map((item) => (
                  <div key={item.year} style={yearlyEarningsBadgeStyle(item.tone)}>
                    <strong>{item.year}</strong>
                    <span>{item.toneLabel}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
      <div style={earningsSourceStyle}>{earnings.sourceNote}</div>
    </section>
  );
}

function EarningsMetric({ label, value, meta, tone }: { label: string; value: string; meta?: string; tone?: ScoreTone; }) {
  return (
    <div style={earningsMetricStyle(tone)}>
      <div style={earningsMiniLabelStyle}>{label}</div>
      <div style={earningsMetricValueStyle}>{value}</div>
      {meta && meta !== "—" ? <div style={earningsMetricMetaStyle(tone)}>{meta}</div> : null}
    </div>
  );
}

function metricTone(value: number | null): ScoreTone | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value > 0) return "green";
  if (value < 0) return "red";
  return "yellow";
}

export default async function StockNewsPage({ params }: Props) {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  const newsData = await getStockNewsBaseData(upper, { maxDetailedItems: 3 });

  const {
    quote, history, companyName, news, trend, lastClose, lastMA50, lastMA200,
    lastRsi, isInvalidTicker, isDataUnavailable, priceVs50, priceVs200,
    recentHigh, recentLow, newsScore, earningsScore, detailedNews, compactNews,
  } = newsData;

  const latestEarnings = await getLatestEarningsData(upper, earningsScore);
  const earningsNewsItems = getEarningsNewsItems(news);

  const leadSummary = buildLeadSummary({ symbol: upper, companyName, trend, newsScore, earningsScore });
  const whatItMeans = buildWhatItMeans({ symbol: upper, trend, newsScore, rsi: lastRsi, priceVs50 });
  const beyondHeadline = buildBeyondHeadline({ symbol: upper, newsScore, trend, recentHigh, recentLow });
  const technicalRead = buildTechnicalRead({ symbol: upper, price: quote?.price ?? lastClose, ma50: lastMA50, ma200: lastMA200, trend, rsi: lastRsi, priceVs50, priceVs200 });

  const summaryByTitle = Object.fromEntries(
    detailedNews.map((item) => [item.title, getArticleSnippet(item, upper)]),
  );

  const aiData = await getStockNewsAiData(
    {
      symbol: upper, companyName, quote: null, history: [], news: [], trend,
      lastClose: null, lastMA50: null, lastMA200: null, lastRsi, priceVs50, priceVs200,
      recentHigh, recentLow, isInvalidTicker, isDataUnavailable, newsScore, earningsScore,
      rankedNews: detailedNews, detailedNews, compactNews,
    },
    { includeInsight: true },
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(37,99,235,0.18), transparent 22%), radial-gradient(circle at top right, rgba(34,197,94,0.10), transparent 22%), #06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              { "@type": "Organization", "@id": "https://www.mystockharbor.com/#organization", name: "MyStockHarbor", url: "https://www.mystockharbor.com", logo: { "@type": "ImageObject", url: "https://www.mystockharbor.com/logo.png" } },
              { "@type": "WebSite", "@id": "https://www.mystockharbor.com/#website", name: "MyStockHarbor", url: "https://www.mystockharbor.com", publisher: { "@id": "https://www.mystockharbor.com/#organization" } },
              { "@type": "WebPage", "@id": `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news#webpage`, url: `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news`, name: `${upper} Stock News, Summary & Analysis | MyStockHarbor`, description: leadSummary, isPartOf: { "@id": "https://www.mystockharbor.com/#website" }, about: { "@id": `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}#financialproduct` }, breadcrumb: { "@id": `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news#breadcrumb` }, mainEntity: { "@id": `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news#collection` } },
              { "@type": "CollectionPage", "@id": `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news#collection`, url: `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news`, name: `${upper} Stock News`, description: `Latest ${upper} stock news with beginner-friendly summaries, news score, earnings tone and technical context.`, isPartOf: { "@id": "https://www.mystockharbor.com/#website" }, about: { "@id": `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}#financialproduct` }, hasPart: structuredNews(news, summaryByTitle) },
              { "@type": "BreadcrumbList", "@id": `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news#breadcrumb`, itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "https://www.mystockharbor.com/" }, { "@type": "ListItem", position: 2, name: `${upper} Stock Analysis`, item: `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}` }, { "@type": "ListItem", position: 3, name: `${upper} Stock News`, item: `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news` }] },
            ],
          }),
        }}
      />

      <div className="newsWrap">
        <PageShareBar
          url={`https://www.mystockharbor.com/stock/${upper}/news`}
          title={`${upper} Stock News & Analysis | MyStockHarbor`}
          text={`${upper} stock news — headline sentiment, earnings context & chart analysis 📊 MyStockHarbor`}
        />

        <section className="newsHeroShell" style={heroShellStyle}>
          <div className="newsHeroLeft" style={heroLeftStyle}>
            <div style={newsDeskTagStyle}>NEWS DESK</div>
            <h1 className="newsHeroTitle" style={heroTitleStyle}>
              {upper} Stock News, News Score & What It Could Mean
            </h1>
            <p className="newsHeroLead" style={heroLeadStyle}>{leadSummary}</p>
            <div style={{ marginTop: 18, padding: "14px 16px", borderRadius: 14, border: "1px solid rgba(59,130,246,0.25)", background: "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(8,18,30,0.92))", fontSize: 14, lineHeight: 1.6, color: "#e5e7eb", maxWidth: 620 }}>
              <strong style={{ color: "#93c5fd" }}>HEADLINE TAKE:</strong>{" "}{newsScore.reason}
            </div>
            <StockNewsTickerJump currentSymbol={upper} />
            <div className="newsHeroCtaRow" style={heroCtaRowStyle}>
              <a href={`/api/go/tradingview?symbol=${encodeURIComponent(upper)}`} target="_blank" rel="noopener noreferrer sponsored nofollow" className="newsHeroBtn" style={heroPrimaryCtaStyle}>OPEN ON TRADINGVIEW ↗</a>
              <Link href="/platforms" className="newsHeroBtn" style={heroSecondaryCtaStyle}>TRADE THIS STOCK</Link>
            </div>
            <div className="newsHeroSubCopy" style={heroSubCopyStyle}>Full chart, indicators and drawing tools on TradingView. Move to Platforms when you are ready to act.</div>
          </div>

          <div className="newsHeroRight" style={heroRightStyle}>
            <div style={scorePanelStyle(newsScore.tone)}>
              <NewsScoreGauge newsScore={newsScore} />
            </div>
            <div style={miniScoreGridStyle}>
              <div style={miniScoreCardStyle(latestEarnings.tone)}>
                <div style={miniScoreTitleStyle}>Earnings Tone</div>
                <div style={miniScoreNumberStyle}>{earningsToneScore(latestEarnings)}</div>
                <div style={miniScoreLabelStyle}>{latestEarnings.hasStructuredData ? `${latestEarnings.toneLabel} based on actual EPS/revenue` : "Structured data unavailable"}</div>
              </div>
              <div style={miniScoreCardStyle(newsScore.tone)}>
                <div style={miniScoreTitleStyle}>Confidence</div>
                <div style={miniScoreNumberStyle}>{newsScore.confidence}</div>
                <div style={miniScoreLabelStyle}>Headline depth</div>
              </div>
            </div>
            <div style={miniScoreGridStyle}>
              <div style={heroMetricStyle}>
                <div style={heroMetricLabelStyle}>Last Price</div>
                <div style={heroMetricValueStyle}>{isDataUnavailable ? "DATA UNAVAILABLE" : formatMoney(quote?.price ?? lastClose)}</div>
              </div>
              <div style={heroMetricStyle}>
                <div style={heroMetricLabelStyle}>Trend Context</div>
                <div style={heroMetricValueStyle}>{trend}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="newsGrid" style={newsGridStyle}>
          <div className="newsMainColumn" style={{ display: "grid", gap: 18 }}>
            <Suspense fallback={<DetailedNewsFallback symbol={upper} detailedNews={detailedNews} compactNews={compactNews} />}>
              <DetailedNewsAiSection aiData={aiData} symbol={upper} companyName={companyName} trend={trend} newsScore={newsScore} detailedNews={detailedNews} compactNews={compactNews} />
            </Suspense>
            <EarningsNewsSection symbol={upper} earningsNews={earningsNewsItems} latestEarnings={latestEarnings} />
            <Suspense fallback={<InsightFallbackCard />}>
              <InsightAiCard aiData={aiData} symbol={upper} companyName={companyName} trend={trend} newsScore={newsScore} earningsScore={earningsScore} lastRsi={lastRsi} priceVs50={priceVs50} priceVs200={priceVs200} recentHigh={recentHigh} recentLow={recentLow} detailedNews={detailedNews} fallbackBeyondHeadline={beyondHeadline} />
            </Suspense>
          </div>

          <aside className="newsSidebar" style={{ display: "grid", gap: 18 }}>
            <section style={sidebarCardStyle}>
              <div style={sectionEyebrowStyle}>Why the score looks like this</div>
              <h2 style={sectionTitleSmallStyle}>News Score Breakdown</h2>
              <p style={bodyCopyStyle}>{newsScore.reason}</p>
              <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                <div style={signalBoxStyle("green")}>
                  <div style={signalBoxTitleStyle}>Positive drivers</div>
