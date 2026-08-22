import { NextResponse } from "next/server";

import { fmpFetch } from "@/lib/server/fmpUsage";
type Props = {
  params: Promise<{ symbol: string }>;
};

const FMP_API_KEY = process.env.FMP_API_KEY;

async function fetchJson(url: string) {
  const response = await fmpFetch(url, {
    next: { revalidate: 0 },
  });

  const text = await response.text();

  try {
    return {
      ok: response.ok,
      status: response.status,
      json: JSON.parse(text),
    };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      json: null,
      rawText: text.slice(0, 1000),
    };
  }
}

export async function GET(_request: Request, { params }: Props) {
  const { symbol } = await params;
  const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, "");

  if (!FMP_API_KEY) {
    return NextResponse.json(
      {
        error: "Missing FMP_API_KEY environment variable.",
      },
      { status: 500 }
    );
  }

  const stableBase = "https://financialmodelingprep.com/stable";
  const legacyBase = "https://financialmodelingprep.com/api/v3";

  const urls = {
    stableEarnings: `${stableBase}/earnings?symbol=${encodeURIComponent(
      cleanSymbol
    )}&apikey=${FMP_API_KEY}`,

    stableEarningsCalendar: `${stableBase}/earnings-calendar?symbol=${encodeURIComponent(
      cleanSymbol
    )}&apikey=${FMP_API_KEY}`,

    stableIncomeStatement: `${stableBase}/income-statement?symbol=${encodeURIComponent(
      cleanSymbol
    )}&period=quarter&limit=4&apikey=${FMP_API_KEY}`,

    legacyHistoricalEarningsCalendar: `${legacyBase}/historical/earning_calendar/${encodeURIComponent(
      cleanSymbol
    )}?apikey=${FMP_API_KEY}`,
  };

  const [
    stableEarnings,
    stableEarningsCalendar,
    stableIncomeStatement,
    legacyHistoricalEarningsCalendar,
  ] = await Promise.all([
    fetchJson(urls.stableEarnings),
    fetchJson(urls.stableEarningsCalendar),
    fetchJson(urls.stableIncomeStatement),
    fetchJson(urls.legacyHistoricalEarningsCalendar),
  ]);

  return NextResponse.json({
    symbol: cleanSymbol,
    checkedEndpoints: [
      "/stable/earnings",
      "/stable/earnings-calendar",
      "/stable/income-statement?period=quarter&limit=4",
      "/api/v3/historical/earning_calendar/[symbol]",
    ],
    stableEarnings,
    stableEarningsCalendar,
    stableIncomeStatement,
    legacyHistoricalEarningsCalendar,
    note: "API key is not returned by this debug route.",
  });
}
