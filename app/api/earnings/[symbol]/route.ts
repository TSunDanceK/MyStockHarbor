import { NextResponse } from "next/server";

type Props = {
  params: Promise<{ symbol: string }>;
};

const FMP_API_KEY = process.env.FMP_API_KEY;

async function fetchJson(url: string) {
  const response = await fetch(url, {
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

  const base = "https://financialmodelingprep.com/stable";

  const urls = {
    earnings: `${base}/earnings?symbol=${encodeURIComponent(
      cleanSymbol
    )}&apikey=${FMP_API_KEY}`,

    earningsCalendar: `${base}/earnings-calendar?symbol=${encodeURIComponent(
      cleanSymbol
    )}&apikey=${FMP_API_KEY}`,

    incomeStatement: `${base}/income-statement?symbol=${encodeURIComponent(
      cleanSymbol
    )}&period=quarter&limit=4&apikey=${FMP_API_KEY}`,
  };

  const [earnings, earningsCalendar, incomeStatement] = await Promise.all([
    fetchJson(urls.earnings),
    fetchJson(urls.earningsCalendar),
    fetchJson(urls.incomeStatement),
  ]);

  return NextResponse.json({
    symbol: cleanSymbol,
    checkedEndpoints: [
      "/stable/earnings",
      "/stable/earnings-calendar",
      "/stable/income-statement?period=quarter&limit=4",
    ],
    earnings,
    earningsCalendar,
    incomeStatement,
    note: "API key is not returned by this debug route.",
  });
}
