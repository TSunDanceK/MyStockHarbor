import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ symbol: string }>;
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

type FmpStableEarningsItem = {
  symbol?: string;
  date?: string;
  fiscalLabel?: string;
  fiscalYear?: string;
  periodEndDate?: string;
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
  eps?: number | string | null;
  epsDiluted?: number | string | null;
};

type FmpHistoricalEarningCalendarItem = {
  date?: string;
  epsActual?: number | null;
  epsEstimated?: number | null;
};

type StockEarningsData = {
  hasStructuredData: boolean;
  tone: ScoreTone;
  toneLabel: "Good" | "Neutral" | "Weak" | "Unavailable";
  score: number | null;
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

function cleanSymbol(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function dateTime(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(`${value}T00:00:00Z`).getTime();
  return Number.isNaN(time) ? null : time;
}

function quarterLabel(dateValue: string | null | undefined) {
  if (!dateValue) return "Recent";
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateValue;
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `Q${quarter} ${String(date.getUTCFullYear()).slice(-2)}`;
}

function fiscalLabelFromStatement(row?: FmpIncomeStatement | null) {
  if (!row) return null;

  const period = String(row.period || "").toUpperCase();
  const year =
    row.calendarYear ||
    (row.date && row.date.length >= 4 ? row.date.slice(0, 4) : "");

  if (/^Q[1-4]$/.test(period) && year) {
    return `${period} ${String(year).slice(-2)}`;
  }

  return row.date ? quarterLabel(row.date) : null;
}

function displayQuarterLabel(item: FmpStableEarningsItem) {
  return item.fiscalLabel || quarterLabel(item.date);
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
      label: displayQuarterLabel(item),
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
  const byYear = new Map<string, ScoreTone[]>();

  for (const item of items) {
    if (!item.date) continue;
    const year = item.fiscalYear || item.date.slice(0, 4);
    if (!/^\d{4}$/.test(year)) continue;

    const current = byYear.get(year) ?? [];
    current.push(completedEarningsTone(item));
    byYear.set(year, current);
  }

  return [...byYear.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .slice(0, 5)
    .map(([year, tones]) => {
      const goodCount = tones.filter((tone) => tone === "green").length;
      const neutralCount = tones.filter((tone) => tone === "yellow").length;
      const weakCount = tones.filter((tone) => tone === "red").length;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function calcGrowth(current: number | null, previous: number | null) {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function findSameQuarterLastYear(
  latest: FmpStableEarningsItem | null,
  completedRows: FmpStableEarningsItem[],
) {
  if (!latest) return null;

  const latestFiscalQuarter = latest.fiscalLabel?.split(" ")[0] ?? null;
  const latestFiscalYear =
    latest.fiscalYear && Number.isFinite(Number(latest.fiscalYear))
      ? Number(latest.fiscalYear)
      : null;

  if (latestFiscalQuarter && latestFiscalYear) {
    const matched =
      completedRows.find((row) => {
        if (!row.date || row.date === latest.date) return false;

        const rowQuarter = row.fiscalLabel?.split(" ")[0] ?? null;
        const rowYear =
          row.fiscalYear && Number.isFinite(Number(row.fiscalYear))
            ? Number(row.fiscalYear)
            : null;

        return rowQuarter === latestFiscalQuarter && rowYear === latestFiscalYear - 1;
      }) ?? null;

    if (matched) return matched;
  }

  return completedRows[4] ?? null;
}

function buildEarningsScore(args: {
  latest: FmpStableEarningsItem | null;
  sameQuarterLastYear: FmpStableEarningsItem | null;
  completedRows: FmpStableEarningsItem[];
}) {
  const { latest, sameQuarterLastYear, completedRows } = args;

  if (!latest) return null;

  const epsActual = safeNumber(latest.epsActual);
  const epsEstimated = safeNumber(latest.epsEstimated);
  const revenueActual = safeNumber(latest.revenueActual);
  const revenueEstimated = safeNumber(latest.revenueEstimated);

  const epsSurprisePct =
    epsActual != null && epsEstimated != null && epsEstimated !== 0
      ? ((epsActual - epsEstimated) / Math.abs(epsEstimated)) * 100
      : null;

  const revenueSurprisePct =
    revenueActual != null && revenueEstimated != null && revenueEstimated !== 0
      ? ((revenueActual - revenueEstimated) / Math.abs(revenueEstimated)) * 100
      : null;

  const yoyEpsGrowth = calcGrowth(
    epsActual,
    safeNumber(sameQuarterLastYear?.epsActual),
  );

  const yoyRevenueGrowth = calcGrowth(
    revenueActual,
    safeNumber(sameQuarterLastYear?.revenueActual),
  );

  let score = 50;

  if (epsSurprisePct != null) score += clamp(epsSurprisePct * 1.35, -22, 22);
  if (revenueSurprisePct != null) score += clamp(revenueSurprisePct * 3.2, -20, 20);

  if (epsActual != null) score += epsActual > 0 ? 6 : -8;

  if (yoyEpsGrowth != null) score += clamp(yoyEpsGrowth * 0.18, -10, 10);
  if (yoyRevenueGrowth != null) score += clamp(yoyRevenueGrowth * 0.22, -10, 10);

  const recent = completedRows.slice(0, 4);
  for (const row of recent) {
    const tone = completedEarningsTone(row);
    if (tone === "green") score += 2.5;
    if (tone === "red") score -= 2.5;
  }

  const recentTones = completedRows.slice(0, 6).map(completedEarningsTone);
  const weakRecentCount = recentTones.filter((item) => item === "red").length;
  const mixedRecentCount = recentTones.filter((item) => item === "yellow").length;
  const maxScore = weakRecentCount > 0 ? 92 : mixedRecentCount > 0 ? 95 : 100;

  return Math.round(clamp(score, 0, maxScore));
}

function toneFromScore(score: number | null): ScoreTone {
  if (typeof score !== "number") return "yellow";
  if (score >= 66) return "green";
  if (score <= 39) return "red";
  return "yellow";
}

function buildOverallTone(args: {
  actualEps: number | null;
  estimatedEps: number | null;
  revenue: number | null;
  revenueEstimate: number | null;
  netIncome: number | null;
}): { tone: ScoreTone; toneLabel: "Good" | "Neutral" | "Weak" | "Unavailable" } {
  const epsSurprisePercent =
    typeof args.actualEps === "number" &&
    typeof args.estimatedEps === "number" &&
    args.estimatedEps !== 0
      ? ((args.actualEps - args.estimatedEps) / Math.abs(args.estimatedEps)) * 100
      : null;

  const revenueSurprisePercent =
    typeof args.revenue === "number" &&
    typeof args.revenueEstimate === "number" &&
    args.revenueEstimate !== 0
      ? ((args.revenue - args.revenueEstimate) / Math.abs(args.revenueEstimate)) * 100
      : null;

  const hasStructuredComparison =
    typeof epsSurprisePercent === "number" ||
    typeof revenueSurprisePercent === "number" ||
    typeof args.netIncome === "number";

  if (!hasStructuredComparison) return { tone: "yellow", toneLabel: "Unavailable" };

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

function findClosestStatement(items: FmpIncomeStatement[], dateValue: string | null) {
  if (!dateValue) return items[0] ?? null;
  const target = dateTime(dateValue);
  if (target == null) return items[0] ?? null;

  return [...items]
    .filter((item) => dateTime(item.date) != null)
    .sort((a, b) => {
      const aDiff = Math.abs((dateTime(a.date) ?? 0) - target);
      const bDiff = Math.abs((dateTime(b.date) ?? 0) - target);
      return aDiff - bDiff;
    })[0] ?? null;
}

async function fetchFmpJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 60 * 60 * 6 },
    });

    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function emptyPayload(): StockEarningsData {
  return {
    hasStructuredData: false,
    tone: "yellow",
    toneLabel: "Unavailable",
    score: null,
    reportDate: null,
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
    nextEarningsDate: null,
    recentReports: [],
    yearlySummaries: [],
    sourceNote: "Structured earnings data is unavailable right now.",
  };
}

export async function GET(_request: Request, { params }: Props) {
  const { symbol } = await params;
  const clean = cleanSymbol(symbol);
  const apiKey = process.env.FMP_API_KEY;

  if (!clean || !apiKey) {
    return NextResponse.json(emptyPayload());
  }

  const encoded = encodeURIComponent(clean);
  const key = encodeURIComponent(apiKey);

  const [earningsRowsRaw, stableIncomeRaw, legacyIncomeRaw, historicalCalendarRaw] = await Promise.all([
    fetchFmpJson<FmpStableEarningsItem[]>(
      `https://financialmodelingprep.com/stable/earnings?symbol=${encoded}&apikey=${key}`,
    ),
    fetchFmpJson<FmpIncomeStatement[]>(
      `https://financialmodelingprep.com/stable/income-statement?symbol=${encoded}&period=quarter&limit=12&apikey=${key}`,
    ),
    fetchFmpJson<FmpIncomeStatement[]>(
      `https://financialmodelingprep.com/api/v3/income-statement/${encoded}?period=quarter&limit=12&apikey=${key}`,
    ),
    fetchFmpJson<unknown[]>(
      `https://financialmodelingprep.com/api/v3/historical/earning_calendar/${encoded}?apikey=${key}`,
    ),
  ]);

  const earningsRows = Array.isArray(earningsRowsRaw) ? earningsRowsRaw : [];
  const incomeStatements =
    Array.isArray(stableIncomeRaw) && stableIncomeRaw.length
      ? stableIncomeRaw
      : Array.isArray(legacyIncomeRaw)
        ? legacyIncomeRaw
        : [];

  const historicalCalendarRows: FmpHistoricalEarningCalendarItem[] = Array.isArray(
    historicalCalendarRaw,
  )
    ? historicalCalendarRaw
        .map((item) => {
          const row = item as Record<string, unknown>;

          return {
            date: typeof row.date === "string" ? row.date : "",
            epsActual:
              safeNumber(row.actualEarningResult) ??
              safeNumber(row.epsActual) ??
              safeNumber(row.actualEPS),
            epsEstimated:
              safeNumber(row.estimatedEarning) ??
              safeNumber(row.epsEstimated) ??
              safeNumber(row.estimatedEPS),
          };
        })
        .filter((item) => Boolean(item.date))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    : [];

  const historicalByDate = new Map(
    historicalCalendarRows.map((item) => [item.date, item]),
  );

  const completedRows = [...earningsRows]
    .filter((item) => {
      const itemTime = dateTime(item.date);
      if (itemTime == null || itemTime > Date.now()) return false;
      return safeNumber(item.epsActual) != null || safeNumber(item.revenueActual) != null;
    })
    .sort((a, b) => (dateTime(b.date) ?? 0) - (dateTime(a.date) ?? 0))
    .map((item, index) => {
      const matchingCalendar = item.date ? historicalByDate.get(item.date) : null;
      const matchingIncome = incomeStatements[index] ?? null;
      const incomeEps =
        safeNumber(matchingIncome?.epsDiluted) ??
        safeNumber(matchingIncome?.eps) ??
        null;

      return {
        ...item,
        fiscalLabel: fiscalLabelFromStatement(matchingIncome) ?? undefined,
        fiscalYear:
          matchingIncome?.calendarYear ||
          matchingIncome?.date?.slice(0, 4) ||
          item.date?.slice(0, 4),
        periodEndDate: matchingIncome?.date,
        // Prefer FMP's earnings EPS first because this is usually the market-facing
        // adjusted/non-GAAP EPS used in earnings headlines. Income-statement EPS is
        // GAAP/basic/diluted and is only a fallback.
        epsActual:
          safeNumber(item.epsActual) ??
          matchingCalendar?.epsActual ??
          incomeEps,
        epsEstimated:
          matchingCalendar?.epsEstimated ??
          safeNumber(item.epsEstimated),
        revenueActual:
          safeNumber(matchingIncome?.revenue) ??
          safeNumber(item.revenueActual),
      };
    });

  const latest = completedRows[0] ?? null;

  const nextRow = [...earningsRows]
    .filter((item) => {
      const itemTime = dateTime(item.date);
      if (itemTime == null || itemTime <= Date.now()) return false;
      return safeNumber(item.epsActual) == null && safeNumber(item.revenueActual) == null;
    })
    .sort((a, b) => (dateTime(a.date) ?? 0) - (dateTime(b.date) ?? 0))[0] ?? null;

  const reportDate = latest?.date ?? null;
  const statement = latest?.periodEndDate
    ? incomeStatements.find((item) => item.date === latest.periodEndDate) ??
      findClosestStatement(incomeStatements, reportDate)
    : findClosestStatement(incomeStatements, reportDate);

  const actualEps = safeNumber(latest?.epsActual);
  const estimatedEps = safeNumber(latest?.epsEstimated);
  const revenue = safeNumber(latest?.revenueActual) ?? safeNumber(statement?.revenue);
  const revenueEstimate = safeNumber(latest?.revenueEstimated);

  const grossProfit = safeNumber(statement?.grossProfit);
  const operatingIncome = safeNumber(statement?.operatingIncome);
  const netIncome = safeNumber(statement?.netIncome);

  const epsSurprise =
    typeof actualEps === "number" && typeof estimatedEps === "number"
      ? actualEps - estimatedEps
      : null;

  const epsSurprisePercent =
    typeof epsSurprise === "number" && typeof estimatedEps === "number" && estimatedEps !== 0
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
    typeof grossProfit === "number" && typeof revenue === "number" && revenue !== 0
      ? (grossProfit / revenue) * 100
      : null;

  const operatingMargin =
    typeof operatingIncome === "number" && typeof revenue === "number" && revenue !== 0
      ? (operatingIncome / revenue) * 100
      : null;

  const hasStructuredData = Boolean(
    reportDate ||
      typeof actualEps === "number" ||
      typeof estimatedEps === "number" ||
      typeof revenue === "number" ||
      typeof revenueEstimate === "number" ||
      typeof netIncome === "number",
  );

  const sameQuarterLastYear = findSameQuarterLastYear(latest, completedRows);

  const score = hasStructuredData
    ? buildEarningsScore({
        latest,
        sameQuarterLastYear,
        completedRows,
      })
    : null;

  const scoreTone = toneFromScore(score);
  const tone = buildOverallTone({
    actualEps,
    estimatedEps,
    revenue,
    revenueEstimate,
    netIncome,
  });

  return NextResponse.json({
    hasStructuredData,
    tone: hasStructuredData ? scoreTone : "yellow",
    toneLabel: hasStructuredData ? earningsToneLabel(scoreTone) : "Unavailable",
    score,
    reportDate,
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
    nextEarningsDate: nextRow?.date ?? null,
    recentReports: buildRecentEarningsReports(completedRows),
    yearlySummaries: buildYearlyEarningsSummaries(completedRows),
    sourceNote: hasStructuredData
      ? "Structured earnings data from Financial Modeling Prep. Latest completed report is selected before upcoming report dates."
      : "Structured earnings data is unavailable right now.",
  } satisfies StockEarningsData);
}
