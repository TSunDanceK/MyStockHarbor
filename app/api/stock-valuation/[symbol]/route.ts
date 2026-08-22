import { NextResponse } from "next/server";
import { fmpFetch } from "@/lib/server/fmpUsage";
import { isUnwantedBot } from "@/lib/botid-guard";

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

type FmpQuoteRow = {
  price?: number | string | null;
  marketCap?: number | string | null;
};

type FmpIncomeRow = {
  date?: string;
  netIncome?: number | string | null;
  eps?: number | string | null;
  epsDiluted?: number | string | null;
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

function normaliseRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    );
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return ((value as { data: unknown[] }).data).filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    );
  }

  return [];
}

async function fetchFmpJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fmpFetch(url, {
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

function computePeFallback(args: {
  quoteRows: Record<string, unknown>[];
  incomeRows: Record<string, unknown>[];
  metricsRow: Record<string, unknown> | null;
}) {
  const quote = args.quoteRows[0] as FmpQuoteRow | undefined;

  const price = safeNumber(quote?.price);
  const marketCap = safeNumber(quote?.marketCap);

  const epsTtm =
    firstNumber(args.metricsRow, [
      "netIncomePerShareTTM",
      "epsTTM",
      "epsDilutedTTM",
      "epsdilutedTTM",
    ]) ??
    (() => {
      const quarterlyEps = args.incomeRows
        .slice(0, 4)
        .map((row) => {
          const incomeRow = row as FmpIncomeRow;
          return safeNumber(incomeRow.epsDiluted) ?? safeNumber(incomeRow.eps);
        })
        .filter((value): value is number => typeof value === "number");

      if (quarterlyEps.length < 4) return null;

      return quarterlyEps.reduce((sum, value) => sum + value, 0);
    })();

  if (
    typeof price === "number" &&
    price > 0 &&
    typeof epsTtm === "number" &&
    epsTtm > 0
  ) {
    return price / epsTtm;
  }

  const netIncomeTtm = args.incomeRows
    .slice(0, 4)
    .map((row) => safeNumber((row as FmpIncomeRow).netIncome))
    .filter((value): value is number => typeof value === "number")
    .reduce((sum, value) => sum + value, 0);

  if (
    typeof marketCap === "number" &&
    marketCap > 0 &&
    typeof netIncomeTtm === "number" &&
    netIncomeTtm > 0
  ) {
    return marketCap / netIncomeTtm;
  }

  return null;
}

export async function GET(_request: Request, { params }: Props) {
  const { symbol } = await params;
  const clean = cleanSymbol(symbol);

  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const apiKey = process.env.FMP_API_KEY;

  if (!clean || !apiKey) {
    return NextResponse.json(emptyPayload());
  }

  const encoded = encodeURIComponent(clean);
  const key = encodeURIComponent(apiKey);

  const [
    stableRatiosRaw,
    stableMetricsRaw,
    legacyRatiosRaw,
    legacyMetricsRaw,
    stableQuoteRaw,
    legacyQuoteRaw,
    stableIncomeRaw,
    legacyIncomeRaw,
  ] = await Promise.all([
    fetchFmpJson<unknown>(
      `https://financialmodelingprep.com/stable/ratios-ttm?symbol=${encoded}&apikey=${key}`,
    ),
    fetchFmpJson<unknown>(
      `https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${encoded}&apikey=${key}`,
    ),
    fetchFmpJson<unknown>(
      `https://financialmodelingprep.com/api/v3/ratios-ttm/${encoded}?apikey=${key}`,
    ),
    fetchFmpJson<unknown>(
      `https://financialmodelingprep.com/api/v3/key-metrics-ttm/${encoded}?apikey=${key}`,
    ),
    fetchFmpJson<unknown>(
      `https://financialmodelingprep.com/stable/quote?symbol=${encoded}&apikey=${key}`,
    ),
    fetchFmpJson<unknown>(
      `https://financialmodelingprep.com/api/v3/quote/${encoded}?apikey=${key}`,
    ),
    fetchFmpJson<unknown>(
      `https://financialmodelingprep.com/stable/income-statement?symbol=${encoded}&period=quarter&limit=4&apikey=${key}`,
    ),
    fetchFmpJson<unknown>(
      `https://financialmodelingprep.com/api/v3/income-statement/${encoded}?period=quarter&limit=4&apikey=${key}`,
    ),
  ]);

  const stableRatiosRows = normaliseRows(stableRatiosRaw);
  const stableMetricsRows = normaliseRows(stableMetricsRaw);
  const legacyRatiosRows = normaliseRows(legacyRatiosRaw);
  const legacyMetricsRows = normaliseRows(legacyMetricsRaw);
  const stableQuoteRows = normaliseRows(stableQuoteRaw);
  const legacyQuoteRows = normaliseRows(legacyQuoteRaw);
  const stableIncomeRows = normaliseRows(stableIncomeRaw);
  const legacyIncomeRows = normaliseRows(legacyIncomeRaw);

  const ratiosRow = (
    stableRatiosRows.length
      ? stableRatiosRows[0]
      : legacyRatiosRows.length
        ? legacyRatiosRows[0]
        : null
  ) as Record<string, unknown> | null;

  const metricsRow = (
    stableMetricsRows.length
      ? stableMetricsRows[0]
      : legacyMetricsRows.length
        ? legacyMetricsRows[0]
        : null
  ) as Record<string, unknown> | null;

  const quoteRows = stableQuoteRows.length ? stableQuoteRows : legacyQuoteRows;
  const incomeRows = stableIncomeRows.length ? stableIncomeRows : legacyIncomeRows;

  const peFromEndpoint =
    firstNumber(ratiosRow, [
      "priceEarningsRatioTTM",
      "priceEarningsRatio",
      "peRatioTTM",
      "peRatio",
      "p/eRatioTTM",
    ]) ??
    firstNumber(metricsRow, [
      "peRatioTTM",
      "peRatio",
      "priceEarningsRatioTTM",
      "priceEarningsRatio",
    ]);

  const peRatio =
    peFromEndpoint ??
    computePeFallback({
      quoteRows,
      incomeRows,
      metricsRow,
    });

  const priceToSalesRatio =
    firstNumber(ratiosRow, [
      "priceToSalesRatioTTM",
      "priceToSalesRatio",
      "priceSalesRatioTTM",
      "psRatioTTM",
      "psRatio",
    ]) ??
    firstNumber(metricsRow, [
      "priceToSalesRatioTTM",
      "priceToSalesRatio",
      "revenuePerShareTTM",
    ]);

  const priceToBookRatio =
    firstNumber(ratiosRow, [
      "priceToBookRatioTTM",
      "priceToBookRatio",
      "pbRatioTTM",
      "pbRatio",
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
    sourceNote:
      "Valuation multiples from Financial Modeling Prep ratios/key metrics TTM data, with P/E fallback from quote and recent income statement data when needed.",
  } satisfies StockValuationData);
}
