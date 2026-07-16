import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ symbol: string }>;
};

type AnalystRatingData = {
  consensusRating: string | null;
  strongBuy: number | null;
  buy: number | null;
  hold: number | null;
  sell: number | null;
  strongSell: number | null;
  totalAnalysts: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  targetMedian: number | null;
  targetConsensus: number | null;
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

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value) && value.length && typeof value[0] === "object" && value[0] !== null) {
    return value[0] as Record<string, unknown>;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

async function fetchFmpJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { next: { revalidate: 60 * 60 * 12 } });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function emptyPayload(note: string): AnalystRatingData {
  return {
    consensusRating: null,
    strongBuy: null,
    buy: null,
    hold: null,
    sell: null,
    strongSell: null,
    totalAnalysts: null,
    targetHigh: null,
    targetLow: null,
    targetMedian: null,
    targetConsensus: null,
    sourceNote: note,
  };
}

// Derives a Strong Buy/Buy/Hold/Sell/Strong Sell label from the individual
// counts when FMP doesn't return an explicit `consensus` string on the
// grades-consensus row.
function deriveConsensusLabel(args: {
  strongBuy: number | null;
  buy: number | null;
  hold: number | null;
  sell: number | null;
  strongSell: number | null;
}): string | null {
  const strongBuy = args.strongBuy ?? 0;
  const buy = args.buy ?? 0;
  const hold = args.hold ?? 0;
  const sell = args.sell ?? 0;
  const strongSell = args.strongSell ?? 0;
  const total = strongBuy + buy + hold + sell + strongSell;
  if (total <= 0) return null;
  // Weighted score: strong buy=2, buy=1, hold=0, sell=-1, strong sell=-2.
  const score = (strongBuy * 2 + buy * 1 - sell * 1 - strongSell * 2) / total;
  if (score >= 1.5) return "Strong Buy";
  if (score >= 0.5) return "Buy";
  if (score >= -0.5) return "Hold";
  if (score >= -1.5) return "Sell";
  return "Strong Sell";
}

export async function GET(_request: Request, { params }: Props) {
  const { symbol } = await params;
  const clean = cleanSymbol(symbol);
  const apiKey = process.env.FMP_API_KEY;

  if (!clean || !apiKey) {
    return NextResponse.json(emptyPayload("Analyst rating data is unavailable right now."));
  }

  const encoded = encodeURIComponent(clean);
  const key = encodeURIComponent(apiKey);

  const [targetConsensusRaw, gradesConsensusRaw] = await Promise.all([
    fetchFmpJson<unknown>(
      `https://financialmodelingprep.com/stable/price-target-consensus?symbol=${encoded}&apikey=${key}`,
    ),
    fetchFmpJson<unknown>(
      `https://financialmodelingprep.com/stable/grades-consensus?symbol=${encoded}&apikey=${key}`,
    ),
  ]);

  const targetRow = firstRow(targetConsensusRaw);
  const gradesRow = firstRow(gradesConsensusRaw);

  if (!targetRow && !gradesRow) {
    return NextResponse.json(
      emptyPayload("Analyst rating data is not available for this symbol on the current plan."),
    );
  }

  const strongBuy = safeNumber(gradesRow?.strongBuy);
  const buy = safeNumber(gradesRow?.buy);
  const hold = safeNumber(gradesRow?.hold);
  const sell = safeNumber(gradesRow?.sell);
  const strongSell = safeNumber(gradesRow?.strongSell);

  const totalAnalysts =
    [strongBuy, buy, hold, sell, strongSell].some((v) => v != null)
      ? (strongBuy ?? 0) + (buy ?? 0) + (hold ?? 0) + (sell ?? 0) + (strongSell ?? 0)
      : null;

  const consensusRating =
    safeString(gradesRow?.consensus) ??
    deriveConsensusLabel({ strongBuy, buy, hold, sell, strongSell });

  const payload: AnalystRatingData = {
    consensusRating,
    strongBuy,
    buy,
    hold,
    sell,
    strongSell,
    totalAnalysts,
    targetHigh: safeNumber(targetRow?.targetHigh),
    targetLow: safeNumber(targetRow?.targetLow),
    targetMedian: safeNumber(targetRow?.targetMedian),
    targetConsensus: safeNumber(targetRow?.targetConsensus),
    sourceNote:
      "Analyst price targets and ratings consensus from Financial Modeling Prep, aggregated across covering analysts.",
  };

  return NextResponse.json(payload);
}
