import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ symbol: string }>;
};

type StockValuationData = {
  peRatio: number | null;
  priceToSalesRatio: number | null;
  priceToBookRatio: number | null;
  evToEbitda: number | null;
  sourceNote: string;
};

function cleanSymbol(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function firstNumber(row: Record<string, unknown> | null, keys: string[]) {
  if (!row) return null;

  for (const key of keys) {
    const value = safeNumber(row[key]);
    if (value != null) return value;
  }

  return null;
}

async function fetchFmpJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      next: { revalidate: 60 * 60 * 6 },
    });

    if (!response.ok) return null;

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function emptyPayload(): StockValuationData {
  return {
    peRatio: null,
    priceToSalesRatio: null,
    priceToBookRatio: null,
    evToEbitda: null,
    sourceNote: "Valuation multiples are unavailable right now.",
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

  const [stableRatiosRaw, stableMetricsRaw, legacyRatiosRaw, legacyMetricsRaw] =
    await Promise.all([
      fetchFmpJson<unknown[]>(
        `https://financialmodelingprep.com/stable/ratios-ttm?symbol=${encoded}&apikey=${key}`,
      ),
      fetchFmpJson<unknown[]>(
        `https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${encoded}&apikey=${key}`,
      ),
      fetchFmpJson<unknown[]>(
        `https://financialmodelingprep.com/api/v3/ratios-ttm/${encoded}?apikey=${key}`,
      ),
      fetchFmpJson<unknown[]>(
        `https://financialmodelingprep.com/api/v3/key-metrics-ttm/${encoded}?apikey=${key}`,
      ),
    ]);

  const ratiosRow = (
    Array.isArray(stableRatiosRaw) && stableRatiosRaw.length
      ? stableRatiosRaw[0]
      : Array.isArray(legacyRatiosRaw) && legacyRatiosRaw.length
        ? legacyRatiosRaw[0]
        : null
  ) as Record<string, unknown> | null;

  const metricsRow = (
    Array.isArray(stableMetricsRaw) && stableMetricsRaw.length
      ? stableMetricsRaw[0]
      : Array.isArray(legacyMetricsRaw) && legacyMetricsRaw.length
        ? legacyMetricsRaw[0]
        : null
  ) as Record<string, unknown> | null;

  const peRatio =
    firstNumber(ratiosRow, [
      "priceEarningsRatioTTM",
      "priceEarningsRatio",
      "peRatioTTM",
      "peRatio",
    ]) ??
    firstNumber(metricsRow, [
      "peRatioTTM",
      "peRatio",
    ]);

  const priceToSalesRatio =
    firstNumber(ratiosRow, [
      "priceToSalesRatioTTM",
      "priceToSalesRatio",
      "priceSalesRatioTTM",
    ]) ??
    firstNumber(metricsRow, [
      "priceToSalesRatioTTM",
      "priceToSalesRatio",
    ]);

  const priceToBookRatio =
    firstNumber(ratiosRow, [
      "priceToBookRatioTTM",
      "priceToBookRatio",
      "pbRatioTTM",
    ]) ??
    firstNumber(metricsRow, [
      "pbRatioTTM",
      "pbRatio",
      "priceToBookRatioTTM",
      "priceToBookRatio",
    ]);

  const evToEbitda =
    firstNumber(ratiosRow, [
      "enterpriseValueMultipleTTM",
      "enterpriseValueMultiple",
      "evToEbitda",
      "evToEbitdaTTM",
    ]) ??
    firstNumber(metricsRow, [
      "enterpriseValueOverEBITDATTM",
      "enterpriseValueOverEBITDA",
      "evToEbitda",
      "evToEbitdaTTM",
    ]);

  return NextResponse.json({
    peRatio,
    priceToSalesRatio,
    priceToBookRatio,
    evToEbitda,
    sourceNote: "Valuation multiples from Financial Modeling Prep ratios/key metrics TTM data.",
  } satisfies StockValuationData);
}
