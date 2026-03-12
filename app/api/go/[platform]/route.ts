import { NextRequest, NextResponse } from "next/server";

const affiliateLinks: Record<string, string> = {
  tradingview: "https://www.tradingview.com/",
  trading212: "https://www.trading212.com/",
  etoro: "https://www.etoro.com/",
  interactivebrokers: "https://www.interactivebrokers.com/",
  ig: "https://www.ig.com/",
  plus500: "https://www.plus500.com/",
  capitalcom: "https://capital.com/",
  tradestation: "https://www.tradestation.com/",
  binance: "https://www.binance.com/",
  bybit: "https://www.bybit.com/",
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> }
) {
  const { platform } = await context.params;
  const key = platform.toLowerCase();

  const target = affiliateLinks[key];

  if (!target) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.redirect(target);
}
