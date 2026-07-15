import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import EarningsSymbolPicker from "./EarningsSymbolPicker";
import { getDailyHistory } from "@/lib/server/historyCache";
import {
  computeIndicatorSeed,
  type Point,
} from "@/lib/indicators";
import PageShareBar from "@/app/components/PageShareBar";

export const dynamic = "force-dynamic";

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
};

type FmpIncomeStatementRow = {
  date?: string;
  calendarYear?: string;
  period?: string;
  revenue?: number | null;
  grossProfit?: number | null;
  operatingIncome?: number | null;
  netIncome?: number | null;
  eps?: number | null;
  epsDiluted?: number | null;
};

type FmpHistoricalEarningCalendarRow = {
  date?: string;
  epsActual?: number | null;
  epsEstimated?: number | null;
};

type EarningsTrendPoint = {
  label: string;
  tone: EarningsTone;
  epsActual: number | null;
  epsEstimated: number | null;
  revenueActual: number | null;
  revenueEstimated: number | null;
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
  if (typeof value !== "number" || !Number.isFinite(value)) return "\\u2014";
  const abs = Math.abs(value);
  if (compact) {
    if (abs >= 1_000_000_000) return `${value < 0 ? "-" : ""}$${(abs / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${value < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${value < 0 ? "-" : ""}$${(abs / 1_000).toFixed(1)}K`;
  }
  return `${value < 0 ? "-" : ""}$${abs.toFixed(2)}`;
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "\\u2014";
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

function quarterLabel(date?: string | null) {
  if (!date) return "\\u2014";
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
  if (!row) return "\\u2014";
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

async function getOriginFromHeaders() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host") || "www.mystockharbor.com";
  const proto = headerStore.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function fetchSharedEarningsScore(symbol: string) {
  try {
    const origin = await getOriginFromHeaders();
    const response = await fetch(`${origin}/api/stock-earnings/${encodeURIComponent(symbol)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as SharedEarningsScore;
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
  const [earningsJson, incomeJson, historicalCalendarJson] = await Promise.all([
    fetchFmpJson<unknown[]>(`/earnings?symbol=${encodeURIComponent(symbol)}`),
    fetchFmpJson<unknown[]>(`/income-statement?symbol=${encodeURIComponent(symbol)}&period=quarter&limit=12`),
    fetchFmpLegacyJson<unknown[]>(`/historical/earning_calendar/${encodeURIComponent(symbol)}`),
  ]);

  const earningsRows: FmpEarningsRow[] = Array.isArray(earningsJson)
    ? earningsJson.map((item) => { const row = item as Record<string, unknown>; return { symbol, date: typeof row.date === "string" ? row.date : "", epsActual: asNumber(row.epsActual), epsEstimated: asNumber(row.epsEstimated), revenueActual: asNumber(row.revenueActual), revenueEstimated: asNumber(row.revenueEstimated), lastUpdated: typeof row.lastUpdated === "string" ? row.lastUpdated : "" }; }).filter((row) => Boolean(row.date)).sort((a, b) => String(b.date).localeCompare(String(a.date)))
    : [];

  const incomeRows: FmpIncomeStatementRow[] = Array.isArray(incomeJson)
    ? incomeJson.map((item) => { const row = item as Record<string, unknown>; return { date: typeof row.date === "string" ? row.date : "", calendarYear: typeof row.calendarYear === "string" ? row.calendarYear : "", period: typeof row.period === "string" ? row.period : "", revenue: asNumber(row.revenue), grossProfit: asNumber(row.grossProfit), operatingIncome: asNumber(row.operatingIncome), netIncome: asNumber(row.netIncome), eps: asNumber(row.eps), epsDiluted: asNumber(row.epsDiluted) }; }).filter((row) => Boolean(row.date))
    : [];

  const historicalCalendarRows: FmpHistoricalEarningCalendarRow[] = Array.isArray(historicalCalendarJson)
    ? historicalCalendarJson.map((item) => { const row = item as Record<string, unknown>; return { date: typeof row.date === "string" ? row.date : "", epsActual: asNumber(row.actualEarningResult) ?? asNumber(row.epsActual) ?? asNumber(row.actualEPS), epsEstimated: asNumber(row.estimatedEarning) ?? asNumber(row.epsEstimated) ?? asNumber(row.estimatedEPS) }; }).filter((row) => Boolean(row.date)).sort((a, b) => String(b.date).localeCompare(String(a.date)))
    : [];

  const historicalByDate = new Map(historicalCalendarRows.map((row) => [row.date, row]));
  const today = new Date();

  const completedRows = earningsRows
    .filter((row) => row.epsActual != null || row.revenueActual != null)
    .map((row, index) => {
      const matchingCalendar = row.date ? historicalByDate.get(row.date) : null;
      const matchingIncome = incomeRows[index] ?? null;
      const incomeEps = matchingIncome?.epsDiluted ?? matchingIncome?.eps ?? null;
      return { ...row, fiscalLabel: fiscalLabelFromStatement(matchingIncome) ?? undefined, fiscalYear: matchingIncome?.calendarYear || matchingIncome?.date?.slice(0, 4) || row.date?.slice(0, 4), periodEndDate: matchingIncome?.date, epsActual: row.epsActual ?? matchingCalendar?.epsActual ?? incomeEps ?? null, epsEstimated: matchingCalendar?.epsEstimated ?? row.epsEstimated ?? null, revenueActual: matchingIncome?.revenue ?? row.revenueActual ?? null };
    });

  const latest = completedRows[0] ?? null;
  const next = earningsRows.find((row) => { if (!row.date) return false; const dt = new Date(`${row.date}T00:00:00Z`); return dt.getTime() > today.getTime() && row.epsActual == null && row.revenueActual == null; }) ?? null;

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
  const yearlySummaries = makeYearlySummaries(completedRows);
  const localScore = scoreEarnings({ latest, sameQuarterLastYear, completedRows });
  const sharedScore = await fetchSharedEarningsScore(symbol);
  const score = sharedScore ?? localScore;

  return { rows: earningsRows, completedRows, latest, next, sameQuarterLastYear, grossMargin, operatingMargin, netIncome, recentTrend, yearlySummaries, score };
}

function metricCardStyle(tone: EarningsTone | "default" = "default") {
  const border = tone === "good" ? "rgba(34,197,94,0.22)" : tone === "weak" ? "rgba(239,68,68,0.22)" : tone === "neutral" ? "rgba(250,204,21,0.22)" : "rgba(255,255,255,0.08)";
  const bg = tone === "good" ? "linear-gradient(135deg, rgba(34,197,94,0.10), rgba(15,23,42,0.22))" : tone === "weak" ? "linear-gradient(135deg, rgba(239,68,68,0.10), rgba(15,23,42,0.22))" : tone === "neutral" ? "linear-gradient(135deg, rgba(250,204,21,0.10), rgba(15,23,42,0.22))" : "rgba(255,255,255,0.035)";
  return { border: `1px solid ${border}`, borderRadius: 18, padding: 16, background: bg, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)" };
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
  const priceStr = seed.lastClose != null ? ` \\u2014 Price $${seed.lastClose.toFixed(2)}` : "";
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
    <main className="earningsPage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageJsonLd) }} />

      <style>{`
        .earningsPage { min-height: 100vh; background: radial-gradient(circle at top left, rgba(59,130,246,0.12), transparent 28%), radial-gradient(circle at top right, rgba(34,197,94,0.09), transparent 26%), #06080d; color: #f1f5f9; font-family: system-ui, Arial; }
        .earningsWrap { max-width: 1240px; margin: 0 auto; padding: 24px 18px 52px; }
        .topLinks { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
        .topLinks a, .earningsSearchRow button, .actionLink { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(59,130,246,0.32); background: rgba(59,130,246,0.10); color: #dbeafe; text-decoration: none; font-weight: 900; font-size: 13px; cursor: pointer; }
        .topLinks a.green, .actionLink.green { border-color: rgba(34,197,94,0.32); background: rgba(34,197,94,0.10); color: #dcfce7; }
        .hero { border: 1px solid rgba(255,255,255,0.08); border-radius: 28px; padding: 24px; background: linear-gradient(135deg, rgba(15,23,42,0.96), rgba(6,10,18,0.98)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 38px rgba(0,0,0,0.24); display: grid; grid-template-columns: minmax(0, 1fr) 410px; gap: 24px; align-items: stretch; }
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
          .metricGrid, .yearGrid, .earningsSearchRow { grid-template-columns: 1fr; }
          .metricGrid { gap: 10px; }
          .metricValue { font-size: 22px; word-break: break-word; }
          .metricHelpBubble { position: fixed; left: 12px; right: 12px; bottom: auto; top: 92px; transform: none; width: auto; max-width: none; }
          .metricHelpBubble::after { display: none; }
          .trendDots { gap: 12px; justify-content: flex-start; }
          .trendDot { min-width: 48px; }
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
        <PageShareBar
          url={`https://www.mystockharbor.com/stock/${clean}/earnings`}
          title={`${clean} Earnings & Earnings Score | MyStockHarbor`}
          text={`${clean} earnings \\u2014 EPS, revenue & earnings score \\uD83D\\uDCCA MyStockHarbor`}
        />

        <section className="hero">
          <div>
            <div className="eyebrow">Earnings desk</div>
            <h1>{clean} Stock Earnings, EPS & Revenue Breakdown</h1>
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
              <div className="scoreWatermark">MyStockHarbor</div>
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
                    <div style={metricCardStyle(score.tone)}><MetricLabelWithHelp label="FMP EPS" /><div className="metricValue">{formatMoney(epsActual)}</div><div className="metricSub">FMP estimate: {formatMoney(epsEstimated)}</div></div>
                    <div style={metricCardStyle(epsSurprise != null && epsSurprise >= 0 ? "good" : "weak")}><MetricLabelWithHelp label="EPS surprise" /><div className="metricValue">{formatMoney(epsSurprise)}</div><div className="metricSub">{formatPercent(epsSurprisePct)}</div></div>
                    <div style={metricCardStyle(revenueSurprise != null && revenueSurprise >= 0 ? "good" : "weak")}><MetricLabelWithHelp label="Revenue surprise" /><div className="metricValue">{formatMoney(revenueSurprise, true)}</div><div className="metricSub">{formatPercent(revenueSurprisePct)}</div></div>
                    <div style={metricCardStyle("default")}><MetricLabelWithHelp label="Revenue" /><div className="metricValue">{formatMoney(revenueActual, true)}</div><div className="metricSub">Estimate: {formatMoney(revenueEstimated, true)}</div></div>
                    <div style={metricCardStyle(yoyEpsGrowth != null && yoyEpsGrowth >= 0 ? "good" : "weak")}><MetricLabelWithHelp label="YoY EPS growth" /><div className="metricValue">{formatPercent(yoyEpsGrowth)}</div><div className="metricSub">Compared with {displayQuarterLabel(data.sameQuarterLastYear)}</div></div>
                    <div style={metricCardStyle(yoyRevenueGrowth != null && yoyRevenueGrowth >= 0 ? "good" : "weak")}><MetricLabelWithHelp label="YoY revenue growth" /><div className="metricValue">{formatPercent(yoyRevenueGrowth)}</div><div className="metricSub">Compared with {displayQuarterLabel(data.sameQuarterLastYear)}</div></div>
                  </div>
                  <p className="earningsDataNote">EPS fields are shown from FMP earnings data. They can differ from GAAP EPS or adjusted EPS quoted in earnings headlines.</p>
                </>
              )}
            </section>

            <section className="card">
              <div className="eyebrow">Recent earnings trend</div>
              <h2>How recent earnings have been landing</h2>
              <p>The dots below simplify recent earnings into good, mixed or weak reads based on EPS surprise, revenue surprise and whether the report was profitable.</p>
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
            <section className="card">
              <div className="eyebrow">Why it matters</div>
              <h3>Earnings can reset the stock narrative</h3>
              <p>Earnings matter because they test whether the company story is being supported by actual revenue, profit and estimate performance.</p>
            </section>
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
      </div>
    </main>
  );
}
