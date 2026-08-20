import type { Metadata } from "next";
import Link from "next/link";
import EarningsSymbolPicker from "./EarningsSymbolPicker";
import { getDailyHistory } from "@/lib/server/historyCache";
import { getLatestEarningsData } from "@/lib/latest-earnings-data";
import {
  computeIndicatorSeed,
  type Point,
} from "@/lib/indicators";
import ShareButton from "@/app/components/ShareButton";
import TickerLogo from "@/app/components/TickerLogo";
import { WatermarkVisibilityProvider, HideWatermarksBar, EarningsScoreWatermark } from "@/app/components/WatermarkVisibility";
import { IncomeStatementCard, AnnualConsensusCard, CashFlowCard, SegmentationCard, BalanceSheetCard, type IncomeDetail, type AnnualConsensus, type CashFlow, type BalanceHealth, type SegmentGroup } from "./EarningsDetail";
import { getRelatedSymbols } from "@/lib/curatedSymbols";
import RelatedStocks from "@/app/components/RelatedStocks";

// No segment config here on purpose -- it cascades from
// app/stock/[symbol]/layout.tsx (`revalidate = 900`), so the overview, /news
// and /earnings share one cache policy and cannot drift apart. This page used
// to carry `dynamic = "force-dynamic"`, which meant every request and every
// crawl paid a full serverless render (~575 in 24h) of what is, between
// reports, the same HTML.

type Props = {
  params: Promise<{ symbol: string }>;
};

type EarningsTone = "good" | "neutral" | "weak";

type FmpEarningsRow = {
  symbol?: string;
  date?: string;
  fiscalLabel?: string;
  fiscalYear?: string;
  periodEndDate?: string;
  epsActual?: number | null;
  epsEstimated?: number | null;
  revenueActual?: number | null;
  revenueEstimated?: number | null;
  lastUpdated?: string;
  time?: string;
};

type FmpIncomeStatementRow = {
  date?: string;
  calendarYear?: string;
  period?: string;
  revenue?: number | null;
  costOfRevenue?: number | null;
  grossProfit?: number | null;
  researchAndDevelopment?: number | null;
  sga?: number | null;
  operatingIncome?: number | null;
  ebitda?: number | null;
  interestExpense?: number | null;
  incomeBeforeTax?: number | null;
  incomeTaxExpense?: number | null;
  netIncome?: number | null;
  eps?: number | null;
  epsDiluted?: number | null;
  weightedAverageShsDil?: number | null;
};

type FmpHistoricalEarningCalendarRow = {
  date?: string;
  epsActual?: number | null;
  epsEstimated?: number | null;
};

type FmpAnalystEstimateRow = {
  date?: string;
  revenueLow?: number | null;
  revenueHigh?: number | null;
  revenueAvg?: number | null;
  epsLow?: number | null;
  epsHigh?: number | null;
  epsAvg?: number | null;
  numAnalystsRevenue?: number | null;
  numAnalystsEps?: number | null;
};

type EarningsTrendPoint = {
  label: string;
  tone: EarningsTone;
  epsActual: number | null;
  epsEstimated: number | null;
  revenueActual: number | null;
  revenueEstimated: number | null;
};

type EarningsGrowthMarginPoint = {
  label: string;
  yoyEpsGrowth: number | null;
  yoyRevenueGrowth: number | null;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
};

type EarningsReactionPoint = {
  label: string;
  reactionPct: number | null;
  volumeMultiple: number | null;
  drift5Pct: number | null;
  drift20Pct: number | null;
};

type YearlySummary = {
  year: string;
  tone: EarningsTone;
  toneLabel: string;
  positiveCount: number;
  totalCount: number;
};

type SharedEarningsScore = {
  score: number | null;
  tone: "green" | "yellow" | "red";
  toneLabel: "Good" | "Neutral" | "Weak" | "Unavailable";
};

const FMP_BASE = "https://financialmodelingprep.com/stable";

function cleanSymbol(value: string) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "")
    .trim();
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatDate(value?: string | null) {
  if (!value) return "Unavailable";
  const dt = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatMoney(value: number | null | undefined, compact = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (compact) {
    if (abs >= 1_000_000_000) return `${value < 0 ? "-" : ""}$${(abs / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${value < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${value < 0 ? "-" : ""}$${(abs / 1_000).toFixed(1)}K`;
  }
  return `${value < 0 ? "-" : ""}$${abs.toFixed(2)}`;
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function calcDifference(actual: number | null, estimate: number | null) {
  if (actual == null || estimate == null) return null;
  return actual - estimate;
}

function calcPercentDifference(actual: number | null, estimate: number | null) {
  if (actual == null || estimate == null || estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

function calcGrowth(current: number | null, previous: number | null) {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function findSameQuarterLastYear(row: FmpEarningsRow, rows: FmpEarningsRow[]): FmpEarningsRow | null {
  const rowQuarter = row.fiscalLabel?.split(" ")[0] ?? null;
  const rowYear = row.fiscalYear && Number.isFinite(Number(row.fiscalYear)) ? Number(row.fiscalYear) : null;
  if (!rowQuarter || rowYear == null) return null;
  return rows.find((candidate) => {
    if (!candidate.date || candidate.date === row.date) return false;
    const candidateQuarter = candidate.fiscalLabel?.split(" ")[0] ?? null;
    const candidateYear = candidate.fiscalYear && Number.isFinite(Number(candidate.fiscalYear)) ? Number(candidate.fiscalYear) : null;
    return candidateQuarter === rowQuarter && candidateYear === rowYear - 1;
  }) ?? null;
}

function marginPct(numerator: number | null | undefined, revenue: number | null | undefined) {
  if (typeof numerator !== "number" || typeof revenue !== "number" || !Number.isFinite(numerator) || !Number.isFinite(revenue) || revenue === 0) return null;
  return (numerator / Math.abs(revenue)) * 100;
}

function computeEarningsReactionDetail(row: FmpEarningsRow, points: Point[]): { reactionPct: number | null; volumeMultiple: number | null; drift5Pct: number | null; drift20Pct: number | null } {
  const empty = { reactionPct: null, volumeMultiple: null, drift5Pct: null, drift20Pct: null };
  if (!row.date || !points.length) return empty;
  const dates = points.map((p) => p.date);
  let idx = dates.indexOf(row.date);
  if (idx === -1) {
    idx = dates.findIndex((d) => d >= String(row.date));
  }
  if (idx === -1) return empty;
  const time = (row.time || "").toLowerCase();
  let baseIdx: number;
  let reactIdx: number;
  if (time === "bmo") { baseIdx = idx - 1; reactIdx = idx; }
  else if (time === "amc") { baseIdx = idx; reactIdx = idx + 1; }
  else { baseIdx = idx - 1; reactIdx = idx + 1; }

  const base = points[baseIdx]?.close;
  const react = points[reactIdx]?.close;
  const reactionPct = typeof base === "number" && typeof react === "number" && Number.isFinite(base) && Number.isFinite(react) && base !== 0
    ? ((react - base) / Math.abs(base)) * 100
    : null;

  const reactionVolume = points[reactIdx]?.volume;
  let volumeMultiple: number | null = null;
  if (typeof reactionVolume === "number" && Number.isFinite(reactionVolume) && reactionVolume > 0) {
    const lookback = 20;
    const windowStart = Math.max(0, baseIdx - lookback + 1);
    const window = points.slice(windowStart, baseIdx + 1)
      .map((p) => p.volume)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
    if (window.length) {
      const avgVolume = window.reduce((a, b) => a + b, 0) / window.length;
      if (avgVolume > 0) volumeMultiple = reactionVolume / avgVolume;
    }
  }

  let drift5Pct: number | null = null;
  let drift20Pct: number | null = null;
  if (typeof base === "number" && Number.isFinite(base) && base !== 0) {
    const close5 = points[reactIdx + 4]?.close;
    const close20 = points[reactIdx + 19]?.close;
    if (typeof close5 === "number" && Number.isFinite(close5)) drift5Pct = ((close5 - base) / Math.abs(base)) * 100;
    if (typeof close20 === "number" && Number.isFinite(close20)) drift20Pct = ((close20 - base) / Math.abs(base)) * 100;
  }

  return { reactionPct, volumeMultiple, drift5Pct, drift20Pct };
}

function quarterLabel(date?: string | null) {
  if (!date) return "—";
  const dt = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return date;
  const month = dt.getUTCMonth();
  const quarter = Math.floor(month / 3) + 1;
  const year = String(dt.getUTCFullYear()).slice(-2);
  return `Q${quarter} ${year}`;
}

function fiscalLabelFromStatement(row?: FmpIncomeStatementRow | null) {
  if (!row) return null;
  const period = String(row.period || "").toUpperCase();
  const year = row.calendarYear || (row.date && row.date.length >= 4 ? row.date.slice(0, 4) : "");
  if (/^Q[1-4]$/.test(period) && year) return `${period} ${String(year).slice(-2)}`;
  return row.date ? quarterLabel(row.date) : null;
}

function displayQuarterLabel(row?: FmpEarningsRow | null) {
  if (!row) return "—";
  return row.fiscalLabel || quarterLabel(row.date);
}

function classifyQuarter(row: FmpEarningsRow): EarningsTone {
  const epsPct = calcPercentDifference(asNumber(row.epsActual), asNumber(row.epsEstimated));
  const revenuePct = calcPercentDifference(asNumber(row.revenueActual), asNumber(row.revenueEstimated));
  let score = 0;
  if (epsPct != null) { if (epsPct > 2) score += 1; else if (epsPct < -2) score -= 1; }
  if (revenuePct != null) { if (revenuePct > 1) score += 1; else if (revenuePct < -1) score -= 1; }
  if (asNumber(row.epsActual) != null) score += Number(row.epsActual) > 0 ? 0.5 : -0.5;
  if (score >= 1.25) return "good";
  if (score <= -1.25) return "weak";
  return "neutral";
}

function toneLabel(tone: EarningsTone) {
  if (tone === "good") return "Good";
  if (tone === "weak") return "Weak";
  return "Mixed";
}

function toneColor(tone: EarningsTone) {
  if (tone === "good") return "#22c55e";
  if (tone === "weak") return "#ef4444";
  return "#facc15";
}

function toneBg(tone: EarningsTone) {
  if (tone === "good") return "rgba(34,197,94,0.10)";
  if (tone === "weak") return "rgba(239,68,68,0.10)";
  return "rgba(250,204,21,0.10)";
}

function sharedToneToEarningsTone(tone: SharedEarningsScore["tone"]): EarningsTone {
  if (tone === "green") return "good";
  if (tone === "red") return "weak";
  return "neutral";
}

function scoreExplanation(tone: EarningsTone) {
  if (tone === "good") return "The latest earnings read is constructive because the report shows stronger-than-expected fundamentals or improving year-over-year momentum.";
  if (tone === "weak") return "The latest earnings read is weak because the report shows pressure in estimates, profitability, revenue momentum, or recent consistency.";
  return "The latest earnings read is mixed, so investors should focus on whether future reports confirm improvement or reveal more pressure.";
}

function buildScoreResult(score: number, tone: EarningsTone) {
  return { score, tone, label: toneLabel(tone), explanation: scoreExplanation(tone) };
}

// Calls the shared lib/latest-earnings-data.ts function IN-PROCESS instead of
// self-fetching this deployment's own /api/stock-earnings/[symbol] route over
// HTTP. That route is BotID-protected (instrumentation-client.ts), and BotID
// only validates a signed header a real browser attaches client-side -- a
// server-to-server self-fetch never carries one, so it always reads as an
// unverified bot and 403s itself. This function used `cache: "no-store"`, so
// every single request hit that self-block with zero caching cushion; the
// failure was masked because the caller falls back to a locally-computed
// score (scoreEarnings()) whenever this returns null, so the page never
// visibly broke -- it just silently used the wrong (non-canonical) score on
// every load. Same self-block failure mode as
// claude/pickers-firewall-selfblock-2026-07-17.md and
// claude/stock-page-earnings-selfblock-2026-07-21.md.
async function fetchSharedEarningsScore(symbol: string) {
  try {
    const data = await getLatestEarningsData(symbol, "yellow");
    if (typeof data.score !== "number" || !Number.isFinite(data.score)) return null;
    return buildScoreResult(data.score, sharedToneToEarningsTone(data.tone));
  } catch { return null; }
}

function getMetricHelp(label: string) {
  if (label === "FMP EPS") return "EPS means earnings per share. This value comes from FMP earnings data and may differ from GAAP EPS or adjusted EPS quoted in company headlines.";
  if (label === "EPS surprise") return "EPS surprise compares FMP EPS with the FMP analyst estimate. A positive number means EPS came in better than FMP's estimate.";
  if (label === "Revenue surprise") return "Revenue surprise compares actual revenue with the analyst estimate. A positive number means sales came in better than expected.";
  if (label === "Revenue") return "Revenue is the company's sales for the quarter before expenses are removed.";
  if (label === "YoY EPS growth") return "Year-over-year EPS growth compares this quarter's FMP EPS with the same quarter last year.";
  if (label === "YoY revenue growth") return "Year-over-year revenue growth compares this quarter's revenue with the same quarter last year.";
  return "This metric helps investors judge whether the latest earnings report was stronger, weaker, or broadly in line with expectations.";
}

function MetricLabelWithHelp({ label }: { label: string }) {
  return (
    <div className="metricLabelWrap">
      <span className="metricLabel">{label}</span>
      <span className="metricHelp" tabIndex={0} aria-label={`${label} explanation`}>
        ?
        <span className="metricHelpBubble">{getMetricHelp(label)}</span>
      </span>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function scoreEarnings(args: { latest: FmpEarningsRow | null; sameQuarterLastYear: FmpEarningsRow | null; completedRows: FmpEarningsRow[]; }) {
  const { latest, sameQuarterLastYear, completedRows } = args;
  if (!latest) return { score: 50, tone: "neutral" as EarningsTone, label: "Unavailable", explanation: "Structured earnings data is not available for this symbol yet." };
  const epsActual = asNumber(latest.epsActual);
  const epsEstimated = asNumber(latest.epsEstimated);
  const revenueActual = asNumber(latest.revenueActual);
  const revenueEstimated = asNumber(latest.revenueEstimated);
  const epsSurprisePct = calcPercentDifference(epsActual, epsEstimated);
  const revenueSurprisePct = calcPercentDifference(revenueActual, revenueEstimated);
  const yoyEpsGrowth = calcGrowth(epsActual, asNumber(sameQuarterLastYear?.epsActual));
  const yoyRevenueGrowth = calcGrowth(revenueActual, asNumber(sameQuarterLastYear?.revenueActual));
  let score = 50;
  if (epsSurprisePct != null) score += clamp(epsSurprisePct * 1.35, -22, 22);
  if (revenueSurprisePct != null) score += clamp(revenueSurprisePct * 3.2, -20, 20);
  if (epsActual != null) score += epsActual > 0 ? 6 : -8;
  if (yoyEpsGrowth != null) score += clamp(yoyEpsGrowth * 0.18, -10, 10);
  if (yoyRevenueGrowth != null) score += clamp(yoyRevenueGrowth * 0.22, -10, 10);
  const recent = completedRows.slice(0, 4);
  for (const row of recent) { const tone = classifyQuarter(row); if (tone === "good") score += 2.5; if (tone === "weak") score -= 2.5; }
  const recentTones = completedRows.slice(0, 6).map(classifyQuarter);
  const weakRecentCount = recentTones.filter((item) => item === "weak").length;
  const mixedRecentCount = recentTones.filter((item) => item === "neutral").length;
  const maxScore = weakRecentCount > 0 ? 92 : mixedRecentCount > 0 ? 95 : 100;
  const rounded = Math.round(clamp(score, 0, maxScore));
  const tone: EarningsTone = rounded >= 66 ? "good" : rounded <= 39 ? "weak" : "neutral";
  return buildScoreResult(rounded, tone);
}

function makeYearlySummaries(rows: FmpEarningsRow[]): YearlySummary[] {
  const groups = new Map<string, FmpEarningsRow[]>();
  for (const row of rows) {
    if (!row.date) continue;
    const year = row.fiscalYear || row.date.slice(0, 4);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year)?.push(row);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => Number(b) - Number(a))
    .slice(0, 5)
    .map(([year, group]) => {
      const tones = group.map(classifyQuarter);
      const goodCount = tones.filter((x) => x === "good").length;
      const weakCount = tones.filter((x) => x === "weak").length;
      const totalCount = tones.length;
      let tone: EarningsTone = "neutral";
      if (goodCount > weakCount && goodCount >= Math.ceil(totalCount / 2)) tone = "good";
      if (weakCount > goodCount && weakCount >= Math.ceil(totalCount / 2)) tone = "weak";
      return { year, tone, toneLabel: toneLabel(tone), positiveCount: goodCount, totalCount };
    });
}

async function fetchFmpJson<T>(path: string): Promise<T | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;
  const url = `${FMP_BASE}${path}${path.includes("?") ? "&" : "?"}apikey=${apiKey}`;
  try {
    const response = await fetch(url, { next: { revalidate: 60 * 60 * 6 } });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch { return null; }
}

async function fetchFmpLegacyJson<T>(path: string): Promise<T | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;
  const url = `https://financialmodelingprep.com/api/v3${path}${path.includes("?") ? "&" : "?"}apikey=${apiKey}`;
  try {
    const response = await fetch(url, { next: { revalidate: 60 * 60 * 6 } });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch { return null; }
}

async function getEarningsData(symbol: string) {
  const [earningsJson, incomeJson, historicalCalendarJson, analystEstimatesJson, annualEstimatesJson, cashFlowJson, balanceJson, productSegJson, geoSegJson, dailyHistory] = await Promise.all([
    fetchFmpJson<unknown[]>(`/earnings?symbol=${encodeURIComponent(symbol)}`),
    fetchFmpJson<unknown[]>(`/income-statement?symbol=${encodeURIComponent(symbol)}&period=quarter&limit=12`),
    fetchFmpLegacyJson<unknown[]>(`/historical/earning_calendar/${encodeURIComponent(symbol)}`),
    fetchFmpJson<unknown[]>(`/analyst-estimates?symbol=${encodeURIComponent(symbol)}&period=quarter&limit=24`),
    fetchFmpJson<unknown[]>(`/analyst-estimates?symbol=${encodeURIComponent(symbol)}&period=annual&limit=6`),
    fetchFmpJson<unknown[]>(`/cash-flow-statement?symbol=${encodeURIComponent(symbol)}&period=quarter&limit=4`),
    fetchFmpJson<unknown[]>(`/balance-sheet-statement?symbol=${encodeURIComponent(symbol)}&period=quarter&limit=1`),
    fetchFmpJson<unknown[]>(`/revenue-product-segmentation?symbol=${encodeURIComponent(symbol)}&period=annual&structure=flat`),
    fetchFmpJson<unknown[]>(`/revenue-geographic-segmentation?symbol=${encodeURIComponent(symbol)}&period=annual&structure=flat`),
    getDailyHistory(symbol).catch(() => [] as Point[]),
  ]);

  const earningsRows: FmpEarningsRow[] = Array.isArray(earningsJson)
    ? earningsJson.map((item) => { const row = item as Record<string, unknown>; return { symbol, date: typeof row.date === "string" ? row.date : "", epsActual: asNumber(row.epsActual), epsEstimated: asNumber(row.epsEstimated), revenueActual: asNumber(row.revenueActual), revenueEstimated: asNumber(row.revenueEstimated), lastUpdated: typeof row.lastUpdated === "string" ? row.lastUpdated : "", time: typeof row.time === "string" ? row.time.toLowerCase() : undefined }; }).filter((row) => Boolean(row.date)).sort((a, b) => String(b.date).localeCompare(String(a.date)))
    : [];

  const incomeRows: FmpIncomeStatementRow[] = Array.isArray(incomeJson)
    ? incomeJson.map((item) => { const row = item as Record<string, unknown>; return { date: typeof row.date === "string" ? row.date : "", calendarYear: typeof row.calendarYear === "string" ? row.calendarYear : "", period: typeof row.period === "string" ? row.period : "", revenue: asNumber(row.revenue), costOfRevenue: asNumber(row.costOfRevenue), grossProfit: asNumber(row.grossProfit), researchAndDevelopment: asNumber(row.researchAndDevelopmentExpenses) ?? asNumber(row.researchAndDevelopment), sga: asNumber(row.sellingGeneralAndAdministrativeExpenses) ?? asNumber(row.generalAndAdministrativeExpenses) ?? asNumber(row.sellingAndMarketingExpenses), operatingIncome: asNumber(row.operatingIncome), ebitda: asNumber(row.ebitda), interestExpense: asNumber(row.interestExpense), incomeBeforeTax: asNumber(row.incomeBeforeTax), incomeTaxExpense: asNumber(row.incomeTaxExpense), netIncome: asNumber(row.netIncome), eps: asNumber(row.eps), epsDiluted: asNumber(row.epsDiluted), weightedAverageShsDil: asNumber(row.weightedAverageShsOutDil) ?? asNumber(row.weightedAverageShsOut) }; }).filter((row) => Boolean(row.date))
    : [];

  const historicalCalendarRows: FmpHistoricalEarningCalendarRow[] = Array.isArray(historicalCalendarJson)
    ? historicalCalendarJson.map((item) => { const row = item as Record<string, unknown>; return { date: typeof row.date === "string" ? row.date : "", epsActual: asNumber(row.actualEarningResult) ?? asNumber(row.epsActual) ?? asNumber(row.actualEPS), epsEstimated: asNumber(row.estimatedEarning) ?? asNumber(row.epsEstimated) ?? asNumber(row.estimatedEPS) }; }).filter((row) => Boolean(row.date)).sort((a, b) => String(b.date).localeCompare(String(a.date)))
    : [];

  const analystEstimateRows: FmpAnalystEstimateRow[] = Array.isArray(analystEstimatesJson)
    ? analystEstimatesJson.map((item) => { const row = item as Record<string, unknown>; return { date: typeof row.date === "string" ? row.date : "", revenueLow: asNumber(row.revenueLow), revenueHigh: asNumber(row.revenueHigh), revenueAvg: asNumber(row.revenueAvg), epsLow: asNumber(row.epsLow), epsHigh: asNumber(row.epsHigh), epsAvg: asNumber(row.epsAvg), numAnalystsRevenue: asNumber(row.numAnalystsRevenue), numAnalystsEps: asNumber(row.numAnalystsEps) }; }).filter((row) => Boolean(row.date)).sort((a, b) => String(a.date).localeCompare(String(b.date)))
    : [];

  const annualEstimateRows: FmpAnalystEstimateRow[] = Array.isArray(annualEstimatesJson)
    ? annualEstimatesJson.map((item) => { const row = item as Record<string, unknown>; return { date: typeof row.date === "string" ? row.date : "", revenueLow: asNumber(row.revenueLow), revenueHigh: asNumber(row.revenueHigh), revenueAvg: asNumber(row.revenueAvg), epsLow: asNumber(row.epsLow), epsHigh: asNumber(row.epsHigh), epsAvg: asNumber(row.epsAvg), numAnalystsRevenue: asNumber(row.numAnalystsRevenue), numAnalystsEps: asNumber(row.numAnalystsEps) }; }).filter((row) => Boolean(row.date)).sort((a, b) => String(a.date).localeCompare(String(b.date)))
    : [];

  const historicalByDate = new Map(historicalCalendarRows.map((row) => [row.date, row]));
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const completedRows = earningsRows
    .filter((row) => row.epsActual != null || row.revenueActual != null)
    .map((row, index) => {
      const matchingCalendar = row.date ? historicalByDate.get(row.date) : null;
      const matchingIncome = incomeRows[index] ?? null;
      const incomeEps = matchingIncome?.epsDiluted ?? matchingIncome?.eps ?? null;
      return { ...row, fiscalLabel: fiscalLabelFromStatement(matchingIncome) ?? undefined, fiscalYear: matchingIncome?.calendarYear || matchingIncome?.date?.slice(0, 4) || row.date?.slice(0, 4), periodEndDate: matchingIncome?.date, epsActual: row.epsActual ?? matchingCalendar?.epsActual ?? incomeEps ?? null, epsEstimated: matchingCalendar?.epsEstimated ?? row.epsEstimated ?? null, revenueActual: matchingIncome?.revenue ?? row.revenueActual ?? null, grossProfit: matchingIncome?.grossProfit ?? null, operatingIncome: matchingIncome?.operatingIncome ?? null };
    });

  const latest = completedRows[0] ?? null;
  // Use start-of-day (UTC) rather than the current instant so a report
  // scheduled for *today* still counts as the next expected date. With the old
  // `> today.getTime()` comparison, on the earnings day itself the row's
  // midnight-UTC timestamp was already in the past, so the day-of report was
  // dropped from `next` while its actuals were still null — leaving the field
  // blank ("Unavailable") until the numbers posted. Also pick the *soonest*
  // upcoming row (earningsRows is sorted newest-first, so `.find` returned the
  // farthest-out future row).
  const startOfTodayUtcMs = new Date(`${todayIso}T00:00:00Z`).getTime();
  const next = earningsRows
    .filter((row) => { if (!row.date) return false; const dt = new Date(`${row.date}T00:00:00Z`); return dt.getTime() >= startOfTodayUtcMs && row.epsActual == null && row.revenueActual == null; })
    .sort((a, b) => new Date(`${a.date}T00:00:00Z`).getTime() - new Date(`${b.date}T00:00:00Z`).getTime())[0] ?? null;

  const nextEstimate = analystEstimateRows.find((row) => Boolean(row.date) && String(row.date) >= todayIso && (row.epsAvg != null || row.revenueAvg != null)) ?? null;

  const latestFiscalQuarter = latest?.fiscalLabel?.split(" ")[0] ?? null;
  const latestFiscalYear = latest?.fiscalYear && Number.isFinite(Number(latest.fiscalYear)) ? Number(latest.fiscalYear) : null;
  const sameQuarterLastYear = latestFiscalQuarter && latestFiscalYear
    ? completedRows.find((row) => { if (!row.date || row.date === latest?.date) return false; const rowQuarter = row.fiscalLabel?.split(" ")[0] ?? null; const rowYear = row.fiscalYear && Number.isFinite(Number(row.fiscalYear)) ? Number(row.fiscalYear) : null; return rowQuarter === latestFiscalQuarter && rowYear === latestFiscalYear - 1; }) ?? null
    : completedRows[4] ?? null;

  const matchingIncome = latest?.periodEndDate ? incomeRows.find((row) => row.date === latest.periodEndDate) ?? incomeRows[0] ?? null : incomeRows[0] ?? null;
  const grossMargin = matchingIncome?.grossProfit != null && matchingIncome?.revenue != null && matchingIncome.revenue !== 0 ? (matchingIncome.grossProfit / Math.abs(matchingIncome.revenue)) * 100 : null;
  const operatingMargin = matchingIncome?.operatingIncome != null && matchingIncome?.revenue != null && matchingIncome.revenue !== 0 ? (matchingIncome.operatingIncome / Math.abs(matchingIncome.revenue)) * 100 : null;
  const netIncome = matchingIncome?.netIncome ?? null;
  const recentTrend: EarningsTrendPoint[] = completedRows.slice(0, 6).reverse().map((row) => ({ label: displayQuarterLabel(row), tone: classifyQuarter(row), epsActual: row.epsActual ?? null, epsEstimated: row.epsEstimated ?? null, revenueActual: row.revenueActual ?? null, revenueEstimated: row.revenueEstimated ?? null }));
  const chartQuarters: EarningsTrendPoint[] = completedRows.slice(0, 8).reverse().map((row) => ({ label: displayQuarterLabel(row), tone: classifyQuarter(row), epsActual: row.epsActual ?? null, epsEstimated: row.epsEstimated ?? null, revenueActual: row.revenueActual ?? null, revenueEstimated: row.revenueEstimated ?? null }));
  const growthMarginQuarters: EarningsGrowthMarginPoint[] = completedRows.slice(0, 8).reverse().map((row) => {
    const priorYearRow = findSameQuarterLastYear(row, completedRows);
    return {
      label: displayQuarterLabel(row),
      yoyEpsGrowth: calcGrowth(asNumber(row.epsActual), asNumber(priorYearRow?.epsActual)),
      yoyRevenueGrowth: calcGrowth(asNumber(row.revenueActual), asNumber(priorYearRow?.revenueActual)),
      grossMarginPct: marginPct(row.grossProfit, row.revenueActual),
      operatingMarginPct: marginPct(row.operatingIncome, row.revenueActual),
    };
  });
  const yearlySummaries = makeYearlySummaries(completedRows);
  const priceReactionQuarters: EarningsReactionPoint[] = completedRows.slice(0, 8).reverse().map((row) => {
    const detail = computeEarningsReactionDetail(row, dailyHistory as Point[]);
    return { label: displayQuarterLabel(row), ...detail };
  });
  const epsBeatFlags = completedRows.slice(0, 8).map((row) => (row.epsActual != null && row.epsEstimated != null ? row.epsActual >= row.epsEstimated : null));
  const epsBeatConsidered = epsBeatFlags.filter((v): v is boolean => v != null);
  const epsBeatCount = epsBeatConsidered.filter(Boolean).length;
  const epsBeatTotal = epsBeatConsidered.length;
  let currentStreakCount = 0;
  let currentStreakType: "beat" | "miss" | null = null;
  for (const flag of epsBeatFlags) {
    if (flag == null) break;
    if (currentStreakType == null) { currentStreakType = flag ? "beat" : "miss"; currentStreakCount = 1; }
    else if ((flag && currentStreakType === "beat") || (!flag && currentStreakType === "miss")) currentStreakCount += 1;
    else break;
  }
  const localScore = scoreEarnings({ latest, sameQuarterLastYear, completedRows });
  const sharedScore = await fetchSharedEarningsScore(symbol);
  const score = sharedScore ?? localScore;

  // Forward full-year consensus, a trailing-12-month base for growth context, and the full latest P&L.
  const annualEstimate = annualEstimateRows.find((row) => Boolean(row.date) && String(row.date) >= todayIso && (row.epsAvg != null || row.revenueAvg != null)) ?? null;
  const last4Income = incomeRows.slice(0, 4);
  const ttmRevenue = last4Income.length === 4 && last4Income.every((r) => r.revenue != null) ? last4Income.reduce((sum, r) => sum + (r.revenue ?? 0), 0) : null;
  const ttmEps = last4Income.length === 4 && last4Income.every((r) => (r.epsDiluted ?? r.eps) != null) ? last4Income.reduce((sum, r) => sum + ((r.epsDiluted ?? r.eps) ?? 0), 0) : null;
  const li = matchingIncome;
  const latestIncomeStatement = li ? {
    periodEnd: li.date ?? null,
    periodLabel: li.period ?? null,
    revenue: li.revenue ?? null,
    costOfRevenue: li.costOfRevenue ?? (li.revenue != null && li.grossProfit != null ? li.revenue - li.grossProfit : null),
    grossProfit: li.grossProfit ?? null,
    researchAndDevelopment: li.researchAndDevelopment ?? null,
    sga: li.sga ?? null,
    operatingIncome: li.operatingIncome ?? null,
    ebitda: li.ebitda ?? null,
    interestExpense: li.interestExpense ?? null,
    incomeBeforeTax: li.incomeBeforeTax ?? null,
    incomeTaxExpense: li.incomeTaxExpense ?? null,
    netIncome: li.netIncome ?? null,
    epsDiluted: li.epsDiluted ?? li.eps ?? null,
    weightedAverageShsDil: li.weightedAverageShsDil ?? null,
  } : null;

  // Cash flow (quality of earnings + FCF), balance-sheet health, and revenue segmentation.
  const cashRows = Array.isArray(cashFlowJson)
    ? cashFlowJson.map((item) => { const row = item as Record<string, unknown>; return { date: typeof row.date === "string" ? row.date : "", operatingCashFlow: asNumber(row.netCashProvidedByOperatingActivities) ?? asNumber(row.operatingCashFlow), capex: asNumber(row.capitalExpenditure) ?? asNumber(row.investmentsInPropertyPlantAndEquipment), freeCashFlow: asNumber(row.freeCashFlow), netIncome: asNumber(row.netIncome), stockBasedCompensation: asNumber(row.stockBasedCompensation) }; }).filter((row) => Boolean(row.date)).sort((a, b) => String(b.date).localeCompare(String(a.date)))
    : [];
  const cashLatest = (latest?.periodEndDate ? cashRows.find((r) => r.date === latest.periodEndDate) : null) ?? cashRows[0] ?? null;
  const cashflow = cashLatest ? {
    periodEnd: cashLatest.date ?? null,
    operatingCashFlow: cashLatest.operatingCashFlow ?? null,
    capex: cashLatest.capex ?? null,
    freeCashFlow: cashLatest.freeCashFlow ?? (cashLatest.operatingCashFlow != null && cashLatest.capex != null ? cashLatest.operatingCashFlow + cashLatest.capex : null),
    netIncome: cashLatest.netIncome ?? null,
    stockBasedCompensation: cashLatest.stockBasedCompensation ?? null,
  } : null;

  const balRow = Array.isArray(balanceJson) && balanceJson.length ? (balanceJson[0] as Record<string, unknown>) : null;
  const balCash = balRow ? asNumber(balRow.cashAndShortTermInvestments) : null;
  const balDebt = balRow ? asNumber(balRow.totalDebt) : null;
  const balNetDebt = balRow ? asNumber(balRow.netDebt) : null;
  const balCurAssets = balRow ? asNumber(balRow.totalCurrentAssets) : null;
  const balCurLiab = balRow ? asNumber(balRow.totalCurrentLiabilities) : null;
  const balance = balRow ? {
    periodEnd: typeof balRow.date === "string" ? balRow.date : null,
    cashAndStInvestments: balCash,
    totalDebt: balDebt,
    netCash: balCash != null && balDebt != null ? balCash - balDebt : (balNetDebt != null ? -balNetDebt : null),
    currentRatio: balCurAssets != null && balCurLiab != null && balCurLiab !== 0 ? balCurAssets / balCurLiab : null,
  } : null;

  const latestSegment = (json: unknown) => {
    if (!Array.isArray(json)) return { fiscalYear: null as number | string | null, items: [] as { name: string; value: number | null }[] };
    const rows = json.map((item) => item as Record<string, unknown>).filter((row) => row && typeof row.data === "object" && row.data != null).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const top = rows[0];
    if (!top) return { fiscalYear: null as number | string | null, items: [] as { name: string; value: number | null }[] };
    const data = top.data as Record<string, unknown>;
    const items = Object.entries(data).map(([name, val]) => ({ name, value: asNumber(val) })).filter((s) => s.value != null && s.value !== 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const fiscalYear = (typeof top.fiscalYear === "number" || typeof top.fiscalYear === "string") ? top.fiscalYear : (typeof top.date === "string" ? top.date.slice(0, 4) : null);
    return { fiscalYear, items };
  };
  const productSeg = latestSegment(productSegJson);
  const geoSeg = latestSegment(geoSegJson);

  return { rows: earningsRows, completedRows, latest, next, nextEstimate, annualEstimate, ttmRevenue, ttmEps, latestIncomeStatement, cashflow, balance, productSeg, geoSeg, sameQuarterLastYear, grossMargin, operatingMargin, netIncome, recentTrend, chartQuarters, growthMarginQuarters, priceReactionQuarters, yearlySummaries, score, epsBeatCount, epsBeatTotal, currentStreakCount, currentStreakType };
}

function metricCardStyle(tone: EarningsTone | "default" = "default") {
  const border = tone === "good" ? "rgba(34,197,94,0.22)" : tone === "weak" ? "rgba(239,68,68,0.22)" : tone === "neutral" ? "rgba(250,204,21,0.22)" : "rgba(255,255,255,0.08)";
  const bg = tone === "good" ? "linear-gradient(135deg, rgba(34,197,94,0.10), rgba(15,23,42,0.22))" : tone === "weak" ? "linear-gradient(135deg, rgba(239,68,68,0.10), rgba(15,23,42,0.22))" : tone === "neutral" ? "linear-gradient(135deg, rgba(250,204,21,0.10), rgba(15,23,42,0.22))" : "rgba(255,255,255,0.035)";
  return { border: `1px solid ${border}`, borderRadius: 18, padding: 16, background: bg, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)" };
}

type BarChartPoint = { label: string; actual: number | null; estimate: number | null };

// Nominal width (in "user units") for the chart SVGs below. Choosing a
// realistic pixel-scale number here -- rather than an abstract 0-100 -- and
// then letting the SVG scale uniformly (width: 100%, height: auto, no
// preserveAspectRatio="none") keeps x and y scaled by very nearly the same
// factor. That's what keeps circles round and strokes a consistent thin
// line instead of the squashed-ellipse / stretched-line look you get from
// forcing a near-square viewBox to fill a wide card non-uniformly.
const CHART_VIEW_W = 640;

function ChartFrame({ height, labels, scaleTop, scaleMid, scaleBottom, children }: { height: number; labels: string[]; scaleTop?: string; scaleMid?: string; scaleBottom?: string; children: import("react").ReactNode; }) {
  const hasScale = scaleTop != null || scaleMid != null || scaleBottom != null;
  return (
    <div>
      <div className="chartRow">
        <div className="chartPlot">{children}</div>
        {hasScale && (
          <div className="chartScale">
            {scaleTop != null && <span className="scaleTop">{scaleTop}</span>}
            {scaleMid != null && <span className="scaleMid">{scaleMid}</span>}
            {scaleBottom != null && <span className="scaleBottom">{scaleBottom}</span>}
          </div>
        )}
      </div>
      {/* Mirrors the row above (same flex structure + spacer) so the quarter
          labels line up under the actual bars/dots instead of being centered
          across the full card width while the plot itself is narrower by the
          Y-axis scale column. */}
      <div className="chartRow">
        <div className="chartCategories">
          {labels.map((l, i) => <span key={`${l}-${i}`}>{l}</span>)}
        </div>
        {hasScale && <div className="chartScaleSpacer" aria-hidden="true" />}
      </div>
    </div>
  );
}

function EarningsBarChart({ data, formatValue, height = 168 }: { data: BarChartPoint[]; formatValue: (v: number) => string; height?: number; }) {
  const values = data.flatMap((d) => [d.actual, d.estimate]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const maxAbs = values.length ? Math.max(...values.map((v) => Math.abs(v)), 0.0001) : 1;
  const zeroY = height / 2;
  const usable = zeroY - 10;
  const groupW = CHART_VIEW_W / Math.max(data.length, 1);

  return (
    <ChartFrame
      height={height}
      labels={data.map((d) => d.label)}
      scaleTop={values.length ? formatValue(maxAbs) : undefined}
      scaleMid={values.length ? formatValue(0) : undefined}
      scaleBottom={values.length ? formatValue(-maxAbs) : undefined}
    >
      <svg viewBox={`0 0 ${CHART_VIEW_W} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Actual versus estimate chart">
        <line x1="0" y1={zeroY} x2={CHART_VIEW_W} y2={zeroY} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        {data.map((d, i) => {
          const cx = i * groupW + groupW / 2;
          const barW = Math.min(groupW * 0.30, 26);
          const estH = d.estimate != null ? (Math.abs(d.estimate) / maxAbs) * usable : 0;
          const actH = d.actual != null ? (Math.abs(d.actual) / maxAbs) * usable : 0;
          const estUp = (d.estimate ?? 0) >= 0;
          const actUp = (d.actual ?? 0) >= 0;
          const beat = d.actual != null && d.estimate != null ? d.actual >= d.estimate : null;
          const actualColor = beat == null ? "#60a5fa" : beat ? "#22c55e" : "#ef4444";
          return (
            <g key={`${d.label}-${i}`}>
              {d.estimate != null && (
                <rect
                  x={cx - barW - 3}
                  y={estUp ? zeroY - estH : zeroY}
                  width={barW}
                  height={Math.max(estH, 2)}
                  fill="rgba(148,163,184,0.38)"
                  rx="3"
                />
              )}
              {d.actual != null && (
                <rect
                  x={cx + 3}
                  y={actUp ? zeroY - actH : zeroY}
                  width={barW}
                  height={Math.max(actH, 2)}
                  fill={actualColor}
                  rx="3"
                />
              )}
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

function ChartLegend({ actualLabel = "Actual" }: { actualLabel?: string }) {
  return (
    <div className="chartLegend">
      <span><i style={{ background: "#22c55e" }} /> {actualLabel} (beat)</span>
      <span><i style={{ background: "#ef4444" }} /> {actualLabel} (miss)</span>
      <span><i style={{ background: "rgba(148,163,184,0.6)" }} /> Estimate</span>
    </div>
  );
}

type LineSeries = { name: string; color: string; values: (number | null)[] };

function MultiLineChart({ labels, series, height = 168, formatValue = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%` }: { labels: string[]; series: LineSeries[]; height?: number; formatValue?: (v: number) => string; }) {
  const allValues = series.flatMap((s) => s.values).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const maxAbs = allValues.length ? Math.max(...allValues.map((v) => Math.abs(v)), 0.5) : 1;
  const zeroY = height / 2;
  const usable = zeroY - 10;
  const groupW = CHART_VIEW_W / Math.max(labels.length, 1);

  function yFor(v: number) {
    return zeroY - (v / maxAbs) * usable;
  }

  function pathFor(values: (number | null)[]) {
    let d = "";
    let started = false;
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { started = false; return; }
      const x = i * groupW + groupW / 2;
      const y = yFor(v);
      d += `${started ? "L" : "M"}${x},${y} `;
      started = true;
    });
    return d.trim();
  }

  return (
    <ChartFrame
      height={height}
      labels={labels}
      scaleTop={allValues.length ? formatValue(maxAbs) : undefined}
      scaleMid={allValues.length ? formatValue(0) : undefined}
      scaleBottom={allValues.length ? formatValue(-maxAbs) : undefined}
    >
      <svg viewBox={`0 0 ${CHART_VIEW_W} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Trend chart">
        <line x1="0" y1={zeroY} x2={CHART_VIEW_W} y2={zeroY} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        {series.map((s) => (
          <g key={s.name}>
            <path d={pathFor(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) => (v != null && Number.isFinite(v) ? <circle key={i} cx={i * groupW + groupW / 2} cy={yFor(v)} r="3.5" fill={s.color} /> : null))}
          </g>
        ))}
      </svg>
    </ChartFrame>
  );
}

function SeriesLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="chartLegend">
      {items.map((item) => (
        <span key={item.label}><i style={{ background: item.color }} /> {item.label}</span>
      ))}
    </div>
  );
}

type SingleBarPoint = { label: string; value: number | null };

function SingleValueBarChart({ data, height = 168, formatValue = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%` }: { data: SingleBarPoint[]; height?: number; formatValue?: (v: number) => string; }) {
  const values = data.map((d) => d.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const maxAbs = values.length ? Math.max(...values.map((v) => Math.abs(v)), 0.5) : 1;
  const zeroY = height / 2;
  const usable = zeroY - 10;
  const groupW = CHART_VIEW_W / Math.max(data.length, 1);

  return (
    <ChartFrame
      height={height}
      labels={data.map((d) => d.label)}
      scaleTop={values.length ? formatValue(maxAbs) : undefined}
      scaleMid={values.length ? formatValue(0) : undefined}
      scaleBottom={values.length ? formatValue(-maxAbs) : undefined}
    >
      <svg viewBox={`0 0 ${CHART_VIEW_W} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Price reaction chart">
        <line x1="0" y1={zeroY} x2={CHART_VIEW_W} y2={zeroY} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        {data.map((d, i) => {
          const cx = i * groupW + groupW / 2;
          const barW = Math.min(groupW * 0.42, 38);
          const h = d.value != null ? (Math.abs(d.value) / maxAbs) * usable : 0;
          const up = (d.value ?? 0) >= 0;
          const color = d.value == null ? "rgba(148,163,184,0.35)" : up ? "#22c55e" : "#ef4444";
          return d.value != null ? (
            <rect key={`${d.label}-${i}`} x={cx - barW / 2} y={up ? zeroY - h : zeroY} width={barW} height={Math.max(h, 2)} fill={color} rx="3" />
          ) : null;
        })}
      </svg>
    </ChartFrame>
  );
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
  } catch { return { price: null, date: null }; }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const clean = cleanSymbol(symbol);
  const [rawHistory, { price, date }] = await Promise.all([getDailyHistory(clean).catch(() => []), fetchQuoteForMeta(clean)]);
  const points: Point[] = (rawHistory as Point[]).filter((p) => p.date && Number.isFinite(p.close));
  const seed = computeIndicatorSeed(points, "", price, date);
  const priceStr = seed.lastClose != null ? ` — Price $${seed.lastClose.toFixed(2)}` : "";
  const trendStr = seed.trend ? `, ${seed.trend}` : "";
  const title = `${clean} Earnings, EPS & Revenue${priceStr} | MyStockHarbor`;
  const description = `Review ${clean} stock earnings, EPS surprise, revenue surprise${trendStr} and a simple earnings score. Historical trend and yearly breakdown on MyStockHarbor.`;
  return {
    title, description,
    robots: {
      index: true,
      follow: true,
    },
    alternates: { canonical: `https://www.mystockharbor.com/stock/${clean}/earnings` },
    openGraph: { title: `${clean} Earnings & Earnings Score | MyStockHarbor`, description, url: `https://www.mystockharbor.com/stock/${clean}/earnings`, siteName: "MyStockHarbor", type: "article", images: [{ url: "https://www.mystockharbor.com/og-image-v2.png", width: 1200, height: 630, alt: "MyStockHarbor earnings dashboard" }] },
    twitter: { card: "summary_large_image", title: `${clean} Earnings & Earnings Score | MyStockHarbor`, description, images: ["https://www.mystockharbor.com/og-image-v2.png"] },
  };
}

export default async function StockEarningsPage({ params }: Props) {
  const { symbol } = await params;
  const clean = cleanSymbol(symbol);
  const data = await getEarningsData(clean);

  const latest = data.latest;
  const next = data.next;
  const nextEstimate = data.nextEstimate;
  const incomeDetail: IncomeDetail | null = data.latestIncomeStatement;
  const annualEstimateRow = data.annualEstimate;
  const annualConsensus: AnnualConsensus | null = annualEstimateRow
    ? {
        date: annualEstimateRow.date ?? null,
        revenueAvg: annualEstimateRow.revenueAvg ?? null,
        revenueLow: annualEstimateRow.revenueLow ?? null,
        revenueHigh: annualEstimateRow.revenueHigh ?? null,
        epsAvg: annualEstimateRow.epsAvg ?? null,
        epsLow: annualEstimateRow.epsLow ?? null,
        epsHigh: annualEstimateRow.epsHigh ?? null,
        numAnalystsRevenue: annualEstimateRow.numAnalystsRevenue ?? null,
        numAnalystsEps: annualEstimateRow.numAnalystsEps ?? null,
        ttmRevenue: data.ttmRevenue,
        ttmEps: data.ttmEps,
      }
    : null;
  const epsActual = latest?.epsActual ?? null;
  const epsEstimated = latest?.epsEstimated ?? null;
  const epsSurprise = calcDifference(epsActual, epsEstimated);
  const epsSurprisePct = calcPercentDifference(epsActual, epsEstimated);
  const revenueActual = latest?.revenueActual ?? null;
  const revenueEstimated = latest?.revenueEstimated ?? null;
  const revenueSurprise = calcDifference(revenueActual, revenueEstimated);
  const revenueSurprisePct = calcPercentDifference(revenueActual, revenueEstimated);
  const yoyEpsGrowth = calcGrowth(epsActual, data.sameQuarterLastYear?.epsActual ?? null);
  const yoyRevenueGrowth = calcGrowth(revenueActual, data.sameQuarterLastYear?.revenueActual ?? null);
  const score = data.score;

  const epsChartData: BarChartPoint[] = data.chartQuarters.map((q) => ({ label: q.label, actual: q.epsActual, estimate: q.epsEstimated }));
  const revenueChartData: BarChartPoint[] = data.chartQuarters.map((q) => ({ label: q.label, actual: q.revenueActual, estimate: q.revenueEstimated }));
  const growthLabels = data.growthMarginQuarters.map((q) => q.label);
  const growthSeries: LineSeries[] = [
    { name: "Revenue growth", color: "#60a5fa", values: data.growthMarginQuarters.map((q) => q.yoyRevenueGrowth) },
    { name: "EPS growth", color: "#22c55e", values: data.growthMarginQuarters.map((q) => q.yoyEpsGrowth) },
  ];
  const marginSeries: LineSeries[] = [
    { name: "Gross margin", color: "#38bdf8", values: data.growthMarginQuarters.map((q) => q.grossMarginPct) },
    { name: "Operating margin", color: "#facc15", values: data.growthMarginQuarters.map((q) => q.operatingMarginPct) },
  ];
  const reactionData: SingleBarPoint[] = data.priceReactionQuarters.map((q) => ({ label: q.label, value: q.reactionPct }));
  const hasAnyReaction = reactionData.some((d) => d.value != null);
  const driftLabels = data.priceReactionQuarters.map((q) => q.label);
  const driftSeries: LineSeries[] = [
    { name: "Day of reaction", color: "#60a5fa", values: data.priceReactionQuarters.map((q) => q.reactionPct) },
    { name: "+5 trading days", color: "#facc15", values: data.priceReactionQuarters.map((q) => q.drift5Pct) },
    { name: "+20 trading days", color: "#22c55e", values: data.priceReactionQuarters.map((q) => q.drift20Pct) },
  ];
  const hasAnyDrift = driftSeries.some((s) => s.values.some((v) => v != null));
  const latestReaction = [...data.priceReactionQuarters].reverse().find((q) => q.reactionPct != null) ?? null;
  const epsBeatPct = data.epsBeatTotal > 0 ? Math.round((data.epsBeatCount / data.epsBeatTotal) * 100) : null;

  // Curated, deterministic set of OTHER stock symbols for the "Explore More
  // Stocks" internal-linking module (see lib/curatedSymbols.ts and
  // app/components/RelatedStocks.tsx).
  const relatedSymbols = getRelatedSymbols(clean);

  const pageJsonLd = {
    "@context": "https://schema.org", "@type": "WebPage",
    name: `${clean} Stock Earnings`,
    url: `https://www.mystockharbor.com/stock/${clean}/earnings`,
    description: `${clean} stock earnings, EPS, revenue and earnings score.`,
    breadcrumb: { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://www.mystockharbor.com/" },
      { "@type": "ListItem", position: 2, name: clean, item: `https://www.mystockharbor.com/stock/${clean}` },
      { "@type": "ListItem", position: 3, name: "Earnings", item: `https://www.mystockharbor.com/stock/${clean}/earnings` },
    ]},
  };

  return (
    <WatermarkVisibilityProvider>
      <main className="earningsPage">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageJsonLd) }} />

        <style>{`
        .earningsPage { min-height: 100vh; background: radial-gradient(circle at top left, rgba(59,130,246,0.12), transparent 28%), radial-gradient(circle at top right, rgba(34,197,94,0.09), transparent 26%), #06080d; color: #f1f5f9; font-family: system-ui, Arial; }
        .earningsWrap { max-width: 1240px; margin: 0 auto; padding: 24px 18px 52px; }
        .topLinks { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
        .topLinks a, .earningsSearchRow button, .actionLink { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(59,130,246,0.32); background: rgba(59,130,246,0.10); color: #dbeafe; text-decoration: none; font-weight: 900; font-size: 13px; cursor: pointer; }
        .topLinks a.green, .actionLink.green { border-color: rgba(34,197,94,0.32); background: rgba(34,197,94,0.10); color: #dcfce7; }
        .hero { border: 1px solid rgba(255,255,255,0.08); border-radius: 28px; padding: 24px; background: linear-gradient(135deg, rgba(15,23,42,0.96), rgba(6,10,18,0.98)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 38px rgba(0,0,0,0.24); display: grid; grid-template-columns: minmax(0, 1fr) 410px; gap: 24px; align-items: stretch; }
        .heroTopBar { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .eyebrow, .smallLabel { font-size: 12px; font-weight: 950; text-transform: uppercase; letter-spacing: 0.08em; color: #93c5fd; }
        .hero h1 { margin: 12px 0 0; font-size: 46px; line-height: 1.04; letter-spacing: -0.055em; }
        .hero p { margin: 12px 0 0; color: rgba(226,232,240,0.80); line-height: 1.7; font-size: 16px; max-width: 760px; }
        .scoreCard { border: 1px solid ${toneColor(score.tone)}55; border-radius: 22px; padding: 18px; background: linear-gradient(135deg, ${toneBg(score.tone)}, rgba(255,255,255,0.026)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.045); }
        .scoreTop { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
        .scorePill { display: inline-flex; align-items: center; justify-content: center; border: 1px solid ${toneColor(score.tone)}66; background: ${toneBg(score.tone)}; color: ${toneColor(score.tone)}; border-radius: 999px; padding: 8px 11px; font-weight: 950; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
        .scoreNumberRow { margin-top: 14px; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .scoreNumber { font-size: 48px; line-height: 1; font-weight: 950; letter-spacing: -0.06em; }
        .scoreWatermark { font-size: 15px; font-weight: 850; letter-spacing: 0.02em; color: rgba(255,255,255,0.24); }
        .scoreBar { position: relative; margin-top: 18px; height: 14px; border-radius: 999px; background: linear-gradient(90deg, #ef4444, #facc15, #22c55e); overflow: hidden; }
        .scoreNeedle { position: absolute; top: -5px; left: calc(${score.score}% - 9px); width: 18px; height: 24px; border-radius: 999px; background: #f8fafc; border: 3px solid ${toneColor(score.tone)}; box-shadow: 0 8px 20px rgba(0,0,0,0.32); }
        .scoreLabels { display: flex; justify-content: space-between; margin-top: 9px; color: rgba(226,232,240,0.70); font-size: 11px; font-weight: 950; text-transform: uppercase; letter-spacing: 0.07em; }
        .contentGrid { margin-top: 22px; display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.85fr); gap: 22px; align-items: start; }
        .card { border: 1px solid rgba(255,255,255,0.08); border-radius: 22px; padding: 18px; background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.022)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.035); overflow: visible; }
        .card h2, .card h3 { margin: 8px 0 0; letter-spacing: -0.035em; line-height: 1.15; }
        .card h2 { font-size: 26px; } .card h3 { font-size: 22px; }
        .card p { color: rgba(226,232,240,0.82); line-height: 1.7; }
        .metricGrid { margin-top: 16px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; overflow: visible; }
        .metricLabelWrap { position: relative; display: inline-flex; align-items: center; gap: 7px; max-width: 100%; overflow: visible; }
        .metricLabel { font-size: 11px; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(203,213,225,0.72); }
        .metricHelp { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; border-radius: 999px; border: 1px solid rgba(147,197,253,0.30); background: #1e293b; color: #dbeafe; font-size: 11px; font-weight: 950; line-height: 1; cursor: help; z-index: 20; flex: 0 0 auto; }
        .metricHelpBubble { position: absolute; left: 50%; bottom: calc(100% + 10px); transform: translateX(-50%); width: 260px; max-width: min(260px, 72vw); padding: 11px 12px; border-radius: 13px; border: 1px solid rgba(147,197,253,0.22); background: #020617; color: #e5e7eb; box-shadow: 0 18px 44px rgba(0,0,0,0.55); font-size: 12px; font-weight: 750; letter-spacing: 0; line-height: 1.55; text-transform: none; text-align: left; opacity: 0; visibility: hidden; pointer-events: none; white-space: normal; z-index: 9999; }
        .metricHelpBubble::after { content: ""; position: absolute; left: 50%; top: 100%; transform: translateX(-50%); border-width: 7px; border-style: solid; border-color: #020617 transparent transparent transparent; }
        .metricHelp:hover .metricHelpBubble, .metricHelp:focus .metricHelpBubble, .metricHelp:focus-visible .metricHelpBubble { opacity: 1; visibility: visible; }
        .metricValue { margin-top: 8px; font-size: 24px; font-weight: 950; letter-spacing: -0.035em; }
        .earningsDataNote { margin: 10px 0 0; color: rgba(148,163,184,0.78); font-size: 12px; line-height: 1.45; }
        .metricSub { margin-top: 8px; font-size: 12px; line-height: 1.5; color: rgba(226,232,240,0.66); }
        .trendDots { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 14px; }
        .trendDot { text-align: center; min-width: 52px; }
        .trendDot span { display: inline-flex; width: 18px; height: 18px; border-radius: 999px; box-shadow: 0 0 0 6px rgba(255,255,255,0.04); }
        .trendDot strong { display: block; margin-top: 9px; font-size: 11px; color: rgba(241,245,249,0.86); }
        .chartLegend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 14px; font-size: 11px; font-weight: 800; color: rgba(226,232,240,0.72); }
        .chartLegend span { display: inline-flex; align-items: center; gap: 6px; }
        .chartLegend i { display: inline-block; width: 9px; height: 9px; border-radius: 3px; }
        .chartRow { display: flex; align-items: stretch; gap: 8px; }
        .chartPlot { flex: 1 1 auto; min-width: 0; }
        .chartScale { position: relative; width: 66px; flex: 0 0 auto; border-left: 1px solid rgba(255,255,255,0.08); }
        .chartScale span { position: absolute; right: 4px; left: 4px; font-size: 11px; font-weight: 800; color: rgba(203,213,225,0.62); white-space: nowrap; text-align: right; overflow: visible; }
        .chartScale .scaleTop { top: 0; }
        .chartScale .scaleMid { top: 50%; transform: translateY(-50%); }
        .chartScale .scaleBottom { bottom: 0; }
        .chartScaleSpacer { width: 66px; flex: 0 0 auto; }
        .chartCategories { display: flex; flex: 1 1 auto; min-width: 0; margin-top: 6px; }
        .chartCategories span { flex: 1 1 0; text-align: center; font-size: 11px; font-weight: 800; color: rgba(203,213,225,0.68); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 1px; }
        .chartBlock { margin-top: 14px; }
        .chartBlock + .chartBlock { margin-top: 26px; }
        .chartBlockTitle { font-size: 13px; font-weight: 900; color: rgba(226,232,240,0.85); margin-bottom: 4px; }
        .yearGrid { margin-top: 14px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .yearBadge { display: flex; justify-content: space-between; gap: 10px; align-items: center; border-radius: 13px; padding: 10px 12px; font-size: 13px; font-weight: 950; border: 1px solid rgba(255,255,255,0.10); }
        .historyTable { width: 100%; border-collapse: separate; border-spacing: 0 10px; margin-top: 14px; }
        .historyTable th { text-align: left; color: rgba(203,213,225,0.68); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; padding: 0 10px; }
        .historyTable td { background: rgba(255,255,255,0.035); border-top: 1px solid rgba(255,255,255,0.07); border-bottom: 1px solid rgba(255,255,255,0.07); padding: 12px 10px; font-size: 13px; }
        .historyTable td:first-child { border-left: 1px solid rgba(255,255,255,0.07); border-radius: 12px 0 0 12px; font-weight: 900; }
        .historyTable td:last-child { border-right: 1px solid rgba(255,255,255,0.07); border-radius: 0 12px 12px 0; }
        .sideColumn { position: sticky; top: 18px; display: grid; gap: 16px; }
        .bulletList { margin: 14px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; }
        .bulletList li { display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 10px; color: rgba(226,232,240,0.84); line-height: 1.65; }
        .bulletList li::before { content: ""; width: 9px; height: 9px; border-radius: 999px; margin-top: 8px; background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,0.10); }
        .estimateGrid { margin-top: 16px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .estimateGridStacked { grid-template-columns: 1fr; }
        @media (max-width: 980px) { .hero, .contentGrid { grid-template-columns: 1fr; } .sideColumn { position: static; } .metricGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 720px) {
          .earningsPage, .earningsPage * { box-sizing: border-box; }
          .earningsWrap { width: 100%; padding: 14px 10px 38px; overflow-x: hidden; }
          .topLinks { display: grid; grid-template-columns: 1fr; justify-content: stretch; gap: 8px; margin-bottom: 12px; }
          .topLinks a, .actionLink { width: 100%; min-height: 44px; padding: 10px 12px; text-align: center; }
          .hero { padding: 16px; border-radius: 20px; gap: 18px; }
          .hero h1 { margin-top: 10px; font-size: clamp(29px, 9vw, 36px); line-height: 1.08; letter-spacing: -0.045em; }
          .hero p { font-size: 14px; line-height: 1.65; }
          .scoreCard, .card { width: 100%; min-width: 0; border-radius: 18px; padding: 15px; }
          .scoreTop { align-items: flex-start; }
          .scoreNumberRow { margin-top: 18px; }
          .scoreNumber { font-size: 42px; }
          .scoreNeedle { left: calc(${score.score}% - 8px); width: 16px; height: 22px; }
          .contentGrid { gap: 16px; }
          .card h2 { font-size: 23px; } .card h3 { font-size: 20px; }
          .card p, .bulletList li { font-size: 14px; line-height: 1.6; }
          .yearGrid, .earningsSearchRow, .estimateGrid { grid-template-columns: 1fr; }
          .metricGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
          .metricCard { padding: 10px !important; border-radius: 14px !important; }
          .metricValue { font-size: 18px; word-break: break-word; }
          .metricLabel { font-size: 9.5px; }
          .metricSub { font-size: 10.5px; margin-top: 5px; }
          .metricHelp { width: 14px; height: 14px; font-size: 9px; }
          .metricHelpBubble { position: fixed; left: 12px; right: 12px; bottom: auto; top: 92px; transform: none; width: auto; max-width: none; }
          .metricHelpBubble::after { display: none; }
          .trendDots { gap: 12px; justify-content: flex-start; }
          .trendDot { min-width: 48px; }
          .chartScale { width: 58px; }
          .chartScaleSpacer { width: 58px; }
          .chartScale span { font-size: 10px; left: 2px; right: 2px; }
          .chartCategories span { font-size: 9.5px; }
          .historyTable { display: block; width: 100%; border-spacing: 0; margin-top: 12px; }
          .historyTable thead { display: none; }
          .historyTable tbody, .historyTable tr, .historyTable td { display: block; width: 100%; }
          .historyTable tr { margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; background: rgba(255,255,255,0.035); overflow: hidden; }
          .historyTable td { display: flex; align-items: center; justify-content: space-between; gap: 14px; border: none; border-bottom: 1px solid rgba(255,255,255,0.07); border-radius: 0; background: transparent; padding: 11px 12px; font-size: 13px; text-align: right; }
          .historyTable td:first-child, .historyTable td:last-child { border-radius: 0; border-left: none; border-right: none; }
          .historyTable td:last-child { border-bottom: none; }
          .historyTable td::before { content: ""; flex: 0 0 auto; color: rgba(203,213,225,0.70); font-size: 11px; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; text-align: left; }
          .historyTable td:nth-child(1)::before { content: "Quarter"; }
          .historyTable td:nth-child(2)::before { content: "EPS"; }
          .historyTable td:nth-child(3)::before { content: "EPS Est."; }
          .historyTable td:nth-child(4)::before { content: "EPS Surprise"; }
          .historyTable td:nth-child(5)::before { content: "Revenue"; }
          .historyTable td:nth-child(6)::before { content: "Revenue Surprise"; }
          .historyTable td:nth-child(7)::before { content: "Read"; }
        }
        @media (max-width: 380px) { .earningsWrap { padding-left: 8px; padding-right: 8px; } .hero, .scoreCard, .card { padding: 13px; } .scoreNumber { font-size: 38px; } }
      `}</style>

        <div className="earningsWrap">
          <section className="hero">
            <div className="heroTopBar">
              <div className="eyebrow">Earnings desk</div>
              <ShareButton
                url={`https://www.mystockharbor.com/stock/${clean}/earnings`}
                title={`${clean} Earnings & Earnings Score | MyStockHarbor`}
                text={`${clean} earnings — EPS, revenue & earnings score 📊 MyStockHarbor`}
              />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0 0" }}>
                <TickerLogo symbol={clean} size={34} radius={8} />
                <h1 style={{ margin: 0 }}>{clean} Stock Earnings, EPS & Revenue Breakdown</h1>
              </div>
              <p>Review the latest reported earnings for {clean}, including actual EPS, estimates, revenue surprise, year-over-year context, recent earnings consistency and a simple earnings score.</p>
              <EarningsSymbolPicker currentSymbol={clean} />
            </div>
            <aside className="scoreCard">
              <div className="scoreTop">
                <div className="smallLabel">Earnings score</div>
                <div className="scorePill">{score.label}</div>
              </div>
              <div className="scoreNumberRow">
                <div className="scoreNumber">{score.score}/100</div>
                <EarningsScoreWatermark />
              </div>
              <div className="scoreBar" aria-hidden="true"><div className="scoreNeedle" /></div>
              <div className="scoreLabels"><span>Weak</span><span>Mixed</span><span>Strong</span></div>
              <p style={{ marginTop: 16 }}>{score.explanation}</p>
            </aside>
          </section>

          <section className="contentGrid">
            <div style={{ display: "grid", gap: 18 }}>
              <section className="card">
                <div className="eyebrow">Latest report</div>
                <h2>{clean} latest earnings snapshot</h2>
                <p>Latest completed report: <strong>{formatDate(latest?.date)}</strong>. Next expected earnings date: <strong>{formatDate(next?.date)}</strong>.</p>
                {!latest ? (
                  <p>Structured earnings data is not available for this symbol yet.</p>
                ) : (
                  <>
                    <div className="metricGrid">
                      <div className="metricCard" style={metricCardStyle(score.tone)}><MetricLabelWithHelp label="FMP EPS" /><div className="metricValue">{formatMoney(epsActual)}</div><div className="metricSub">FMP estimate: {formatMoney(epsEstimated)}</div></div>
                      <div className="metricCard" style={metricCardStyle(epsSurprise != null && epsSurprise >= 0 ? "good" : "weak")}><MetricLabelWithHelp label="EPS surprise" /><div className="metricValue">{formatMoney(epsSurprise)}</div><div className="metricSub">{formatPercent(epsSurprisePct)}</div></div>
                      <div className="metricCard" style={metricCardStyle(revenueSurprise != null && revenueSurprise >= 0 ? "good" : "weak")}><MetricLabelWithHelp label="Revenue surprise" /><div className="metricValue">{formatMoney(revenueSurprise, true)}</div><div className="metricSub">{formatPercent(revenueSurprisePct)}</div></div>
                      <div className="metricCard" style={metricCardStyle("default")}><MetricLabelWithHelp label="Revenue" /><div className="metricValue">{formatMoney(revenueActual, true)}</div><div className="metricSub">Estimate: {formatMoney(revenueEstimated, true)}</div></div>
                      <div className="metricCard" style={metricCardStyle(yoyEpsGrowth != null && yoyEpsGrowth >= 0 ? "good" : "weak")}><MetricLabelWithHelp label="YoY EPS growth" /><div className="metricValue">{formatPercent(yoyEpsGrowth)}</div><div className="metricSub">Compared with {displayQuarterLabel(data.sameQuarterLastYear)}</div></div>
                      <div className="metricCard" style={metricCardStyle(yoyRevenueGrowth != null && yoyRevenueGrowth >= 0 ? "good" : "weak")}><MetricLabelWithHelp label="YoY revenue growth" /><div className="metricValue">{formatPercent(yoyRevenueGrowth)}</div><div className="metricSub">Compared with {displayQuarterLabel(data.sameQuarterLastYear)}</div></div>
                    </div>
                    <p className="earningsDataNote">EPS fields are shown from FMP earnings data. They can differ from GAAP EPS or adjusted EPS quoted in earnings headlines.</p>
                  </>
                )}
              </section>

              <section className="card">
                <div className="eyebrow">Recent earnings trend</div>
                <h2>How recent earnings have been landing</h2>
                <p>The dots below simplify recent earnings into good, mixed or weak reads based on EPS surprise, revenue surprise and whether the report was profitable.</p>
                {epsBeatPct != null ? (
                  <p><strong>{clean}</strong> has beaten EPS estimates in <strong>{data.epsBeatCount} of the last {data.epsBeatTotal}</strong> quarters ({epsBeatPct}%){data.currentStreakType ? `, including a current streak of ${data.currentStreakCount} straight ${data.currentStreakType === "beat" ? "beats" : "misses"}` : ""}.</p>
                ) : null}
                {data.recentTrend.length ? (
                  <div className="trendDots">
                    {data.recentTrend.map((item) => (
                      <div key={item.label} className="trendDot">
                        <span style={{ background: toneColor(item.tone) }} title={`${item.label}: ${toneLabel(item.tone)}`} />
                        <strong>{item.label}</strong>
                      </div>
                    ))}
                  </div>
                ) : <p>No recent completed earnings trend is available yet.</p>}

                {data.chartQuarters.length ? (
                  <>
                    <div className="chartBlock">
                      <div className="chartBlockTitle">EPS: actual vs. estimate by quarter</div>
                      <EarningsBarChart data={epsChartData} formatValue={(v) => formatMoney(v)} />
                    </div>
                    <div className="chartBlock">
                      <div className="chartBlockTitle">Revenue: actual vs. estimate by quarter</div>
                      <EarningsBarChart data={revenueChartData} formatValue={(v) => formatMoney(v, true)} />
                    </div>
                    <ChartLegend />
                  </>
                ) : null}
              </section>

              <section className="card">
                <div className="eyebrow">Growth &amp; margins</div>
                <h2>Is growth accelerating, and are margins holding up?</h2>
                <p>A single quarter&apos;s beat matters less than the trend behind it. These lines show whether year-over-year growth is speeding up or slowing down, and whether margins are expanding or getting squeezed.</p>
                {growthLabels.length ? (
                  <>
                    <div className="chartBlock">
                      <div className="chartBlockTitle">YoY revenue &amp; EPS growth by quarter</div>
                      <MultiLineChart labels={growthLabels} series={growthSeries} />
                      <SeriesLegend items={[{ label: "Revenue growth", color: "#60a5fa" }, { label: "EPS growth", color: "#22c55e" }]} />
                    </div>
                    <div className="chartBlock">
                      <div className="chartBlockTitle">Gross &amp; operating margin by quarter</div>
                      <MultiLineChart labels={growthLabels} series={marginSeries} />
                      <SeriesLegend items={[{ label: "Gross margin", color: "#38bdf8" }, { label: "Operating margin", color: "#facc15" }]} />
                    </div>
                    <p className="earningsDataNote">Growth compares each quarter with the same quarter a year earlier. Margins are gross profit and operating income as a share of revenue for that quarter.</p>
                  </>
                ) : (
                  <p>Not enough quarterly history is available yet to chart growth and margin trends.</p>
                )}
              </section>

              <CashFlowCard cashflow={data.cashflow} />

              <BalanceSheetCard balance={data.balance} />

              <SegmentationCard product={data.productSeg} geographic={data.geoSeg} />

              <section className="card">
                <div className="eyebrow">Price reaction</div>
                <h2>How has {clean} actually traded around its last reports?</h2>
                <p>This shows the stock&apos;s closing-price move around each report: for reports released before market open, it&apos;s the move from the prior close into the report-day close; for reports released after market close, it&apos;s the move from the report-day close into the next day&apos;s close. When exact timing isn&apos;t available, it spans the day before the report to the day after.</p>
                {latestReaction && (latestReaction.reactionPct != null || latestReaction.volumeMultiple != null) && (
                  <p><strong>Most recent reaction ({latestReaction.label}):</strong> {formatPercent(latestReaction.reactionPct)}{latestReaction.volumeMultiple != null ? ` on ${latestReaction.volumeMultiple.toFixed(1)}x average volume` : ""}.</p>
                )}
                {hasAnyReaction ? (
                  <>
                    <div className="chartBlock">
                      <SingleValueBarChart data={reactionData} />
                    </div>
                    <SeriesLegend items={[{ label: "Rose after report", color: "#22c55e" }, { label: "Fell after report", color: "#ef4444" }]} />
                    <p className="earningsDataNote">This reflects the stock&apos;s actual price move, which can be driven by broader market moves as well as the earnings report itself &mdash; it isn&apos;t a clean read of earnings reaction alone.</p>
                  </>
                ) : (
                  <p>Not enough price history is available yet to chart the reaction around earnings.</p>
                )}
                {hasAnyDrift && (
                  <>
                    <div className="chartBlock">
                      <div className="chartBlockTitle">Did the move hold? Price vs. pre-earnings close, over time</div>
                      <MultiLineChart labels={driftLabels} series={driftSeries} />
                      <SeriesLegend items={[{ label: "Day of reaction", color: "#60a5fa" }, { label: "+5 trading days", color: "#facc15" }, { label: "+20 trading days", color: "#22c55e" }]} />
                    </div>
                    <p className="earningsDataNote">This tracks the stock from just before each report through the following weeks, to show whether the initial reaction stuck, faded, or reversed. The most recent quarters may not have a full 20 trading days of data yet.</p>
                  </>
                )}
              </section>

              <section className="card">
                <div className="eyebrow">Earnings history</div>
                <h2>Recent reported quarters</h2>
                {data.completedRows.length ? (
                  <table className="historyTable">
                    <thead><tr><th>Quarter</th><th>EPS</th><th>EPS Est.</th><th>EPS Surprise</th><th>Revenue</th><th>Revenue Surprise</th><th>Read</th></tr></thead>
                    <tbody>
                      {data.completedRows.slice(0, 8).map((row) => {
                        const rowEpsActual = asNumber(row.epsActual);
                        const rowEpsEstimated = asNumber(row.epsEstimated);
                        const rowRevenueActual = asNumber(row.revenueActual);
                        const rowRevenueEstimated = asNumber(row.revenueEstimated);
                        const rowTone = classifyQuarter(row);
                        return (
                          <tr key={`${row.date}-${row.epsActual}-${row.revenueActual}`}>
                            <td>{displayQuarterLabel(row)}</td>
                            <td>{formatMoney(rowEpsActual)}</td>
                            <td>{formatMoney(rowEpsEstimated)}</td>
                            <td>{formatPercent(calcPercentDifference(rowEpsActual, rowEpsEstimated))}</td>
                            <td>{formatMoney(rowRevenueActual, true)}</td>
                            <td>{formatPercent(calcPercentDifference(rowRevenueActual, rowRevenueEstimated))}</td>
                            <td><span style={{ color: toneColor(rowTone), fontWeight: 950 }}>{toneLabel(rowTone)}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : <p>No completed earnings history is available yet.</p>}
              </section>
            </div>

            <aside className="sideColumn">
              <section className="card">
                <div className="eyebrow">What it means</div>
                <h3>Investor read</h3>
                <p>{score.explanation}</p>
                <ul className="bulletList">
                  <li>EPS surprise shows whether profit landed above or below analyst expectations.</li>
                  <li>Revenue surprise shows whether demand was stronger or weaker than expected.</li>
                  <li>Year-over-year growth helps separate one-quarter noise from a real earnings trend.</li>
                </ul>
              </section>

              {nextEstimate ? (
                <section className="card">
                  <div className="eyebrow">Wall Street expectations</div>
                  <h3>Analyst estimates for the next report</h3>
                  <p>Consensus estimates for the period ending around <strong>{formatDate(nextEstimate.date)}</strong>, based on covering analysts.</p>
                  <div className="estimateGrid estimateGridStacked">
                    <div style={metricCardStyle("default")}>
                      <div className="metricLabel">Consensus EPS</div>
                      <div className="metricValue">{formatMoney(nextEstimate.epsAvg)}</div>
                      <div className="metricSub">Range {formatMoney(nextEstimate.epsLow)} – {formatMoney(nextEstimate.epsHigh)}{nextEstimate.numAnalystsEps ? ` · ${nextEstimate.numAnalystsEps} analysts` : ""}</div>
                    </div>
                    <div style={metricCardStyle("default")}>
                      <div className="metricLabel">Consensus revenue</div>
                      <div className="metricValue">{formatMoney(nextEstimate.revenueAvg, true)}</div>
                      <div className="metricSub">Range {formatMoney(nextEstimate.revenueLow, true)} – {formatMoney(nextEstimate.revenueHigh, true)}{nextEstimate.numAnalystsRevenue ? ` · ${nextEstimate.numAnalystsRevenue} analysts` : ""}</div>
                    </div>
                  </div>
                  <p className="earningsDataNote">Analyst estimates come from FMP&apos;s covering-analyst consensus and can change as the report date approaches.</p>
                </section>
              ) : null}

              <AnnualConsensusCard estimate={annualConsensus} stacked />

              <IncomeStatementCard income={incomeDetail} />

              <section className="card">
                <div className="eyebrow">Yearly earnings read</div>
                <h3>Recent yearly pattern</h3>
                {data.yearlySummaries.length ? (
                  <div className="yearGrid">
                    {data.yearlySummaries.map((item) => (
                      <div key={item.year} className="yearBadge" style={{ color: "#f8fafc", borderColor: `${toneColor(item.tone)}55`, background: toneBg(item.tone) }}>
                        <span>{item.year}</span><span style={{ color: toneColor(item.tone) }}>{item.toneLabel}</span>
                      </div>
                    ))}
                  </div>
                ) : <p>No yearly earnings pattern is available yet.</p>}
              </section>

              <section className="card">
                <div className="eyebrow">Why it matters</div>
                <h3>Earnings can reset the stock narrative</h3>
                <p>Earnings matter because they test whether the company story is being supported by actual revenue, profit and estimate performance.</p>
              </section>

              <section className="card">
                <div className="eyebrow">Learn</div>
                <h3>New to reading earnings?</h3>
                <p>Understand EPS, revenue surprise, margins and the three financial statements behind every earnings report — in plain English.</p>
                <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                  <Link className="actionLink green" href="/learn/how-to-read-financial-data">How to Read Financial Data &rarr;</Link>
                </div>
              </section>

              <section className="card">
                <div className="eyebrow">Next step</div>
                <h3>Connect earnings with price action</h3>
                <p>Use this page for the earnings read, then compare it with the stock page and latest news.</p>
                <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                  <Link className="actionLink" href={`/stock/${encodeURIComponent(clean)}`}>Open {clean} stock page &rarr;</Link>
                  <Link className="actionLink green" href={`/stock/${encodeURIComponent(clean)}/news`}>Read {clean} news &rarr;</Link>
                  <Link className="actionLink" href="/pickers">Open stock pickers &rarr;</Link>
                </div>
              </section>
            </aside>
          </section>

          <HideWatermarksBar />
        </div>

        {/* -- Explore More Stocks -- server-rendered internal-linking
               module, same pattern as app/stock/[symbol]/page.tsx (see
               lib/curatedSymbols.ts + app/components/RelatedStocks.tsx). -- */}
        <RelatedStocks currentSymbol={clean} symbols={relatedSymbols} />
      </main>
    </WatermarkVisibilityProvider>
  );
}
