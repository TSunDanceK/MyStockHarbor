import { NextRequest, NextResponse } from "next/server";

const affiliateLinks: Record<string, string> = {
  tradingview: "https://www.tradingview.com/",
  etoro: "https://www.etoro.com/",
  interactivebrokers: "https://www.interactivebrokers.com/",
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
