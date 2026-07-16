// lib/latest-earnings-data.ts
//
// Canonical "latest earnings" computation, used by:
//  - app/api/stock-earnings/[symbol]/route.ts (HTTP endpoint; consumed by the
//    dashboard, the main stock page's sidebar LatestEarningsCard, and the
//    Earnings page's overall score)
//  - app/stock/[symbol]/news/page.tsx (called directly, server-side, no
//    network hop)
//
// This used to be duplicated with genuinely different FMP endpoints and
// matching logic between the News page's own getLatestEarningsData() and
// this API route (the route pulled from /historical/earning_calendar and
// matched fiscal quarters via income-statement metadata; the News page used
// analyst-estimates + earnings-surprises instead and had no fiscal-quarter
// matching). Per the site owner, the News page's numbers are the ones that
// have been checked against real filings, so THIS file is that logic,
// promoted to a shared module both callers now use. A numeric 0-100 `score`
// (which the News page's version never produced) is layered on top using a
// simplified version of the old API route's methodology, so the Earnings
// page's overall score gauge keeps working.

import type {
  LatestEarningsData,
  EarningsPeriodSummary,
  EarningsYearSummary,
  ScoreTone,
} from "@/app/components/LatestEarningsCard";

export type {
  LatestEarningsData,
  EarningsPeriodSummary,
  EarningsYearSummary,
  ScoreTone,
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

function quarterLabel(dateValue: string | null | undefined) {
  if (!dateValue) return "Recent";
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateValue;
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `Q${quarter} ${String(date.getUTCFullYear()).slice(-2)}`;
}

function earningsToneLabel(tone: ScoreTone): "Good" | "Neutral" | "Weak" {
  if (tone === "green") return "Good";
  if (tone === "red") return "Weak";
  return "Neutral";
}

function completedEarningsTone(item: FmpStableEarningsItem): ScoreTone {
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function calcGrowth(current: number | null, previous: number | null) {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// Simplified numeric 0-100 score for the Earnings page's hero gauge. The old
// API route matched same-quarter-last-year via fiscal-year/quarter metadata
// derived from the income statement; this data set doesn't carry that
// metadata, so it falls back to "4 rows back" the same way the old route
// did whenever fiscal matching wasn't available.
function buildNumericScore(args: {
  actualEps: number | null;
  estimatedEps: number | null;
  revenue: number | null;
  revenueEstimate: number | null;
  completedRows: FmpStableEarningsItem[];
}): number | null {
  const { actualEps, estimatedEps, revenue, revenueEstimate, completedRows } = args;
  if (!completedRows.length) return null;

  const sameQuarterLastYear = completedRows[4] ?? null;
  const epsSurprisePct =
    typeof actualEps === "number" &&
    typeof estimatedEps === "number" &&
    estimatedEps !== 0
      ? ((actualEps - estimatedEps) / Math.abs(estimatedEps)) * 100
      : null;
  const revenueSurprisePct =
    typeof revenue === "number" &&
    typeof revenueEstimate === "number" &&
    revenueEstimate !== 0
      ? ((revenue - revenueEstimate) / Math.abs(revenueEstimate)) * 100
      : null;
  const yoyEpsGrowth = calcGrowth(actualEps, safeNumber(sameQuarterLastYear?.epsActual));
  const yoyRevenueGrowth = calcGrowth(revenue, safeNumber(sameQuarterLastYear?.revenueActual));

  let score = 50;
  if (epsSurprisePct != null) score += clamp(epsSurprisePct * 1.35, -22, 22);
  if (revenueSurprisePct != null) score += clamp(revenueSurprisePct * 3.2, -20, 20);
  if (actualEps != null) score += actualEps > 0 ? 6 : -8;
  if (yoyEpsGrowth != null) score += clamp(yoyEpsGrowth * 0.18, -10, 10);
  if (yoyRevenueGrowth != null) score += clamp(yoyRevenueGrowth * 0.22, -10, 10);

  const recentTones = completedRows.slice(0, 6).map(completedEarningsTone);
  for (const tone of recentTones.slice(0, 4)) {
    if (tone === "green") score += 2.5;
    if (tone === "red") score -= 2.5;
  }
  const weakRecentCount = recentTones.filter((t) => t === "red").length;
  const mixedRecentCount = recentTones.filter((t) => t === "yellow").length;
  const maxScore = weakRecentCount > 0 ? 92 : mixedRecentCount > 0 ? 95 : 100;

  return Math.round(clamp(score, 0, maxScore));
}

export async function getLatestEarningsData(
  symbol: string,
  fallbackTone: ScoreTone = "yellow",
): Promise<LatestEarningsData> {
  const apiKey = process.env.FMP_API_KEY;

  const empty: LatestEarningsData = {
    hasStructuredData: false,
    tone: fallbackTone,
    toneLabel: "Unavailable",
    score: null,
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

  if (!symbol || !apiKey) return empty;

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
    fallbackTone: fallbackTone,
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
  const score = hasStructuredData
    ? buildNumericScore({ actualEps, estimatedEps, revenue, revenueEstimate, completedRows: completedEarningsRows })
    : null;

  return {
    hasStructuredData,
    tone: hasStructuredData ? tone.tone : fallbackTone,
    toneLabel: hasStructuredData ? tone.toneLabel : "Unavailable",
    score,
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
