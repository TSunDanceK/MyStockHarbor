import { NextResponse } from "next/server";

const affiliateLinks: Record<string, string> = {
  tradingview: "https://www.tradingview.com/",
  etoro: "https://www.etoro.com/",
  interactivebrokers: "https://www.interactivebrokers.com/",
};

export async function GET(
  request: Request,
  { params }: { params: { platform: string } }
) {
  const key = params.platform.toLowerCase();

  const target = affiliateLinks[key];

  if (!target) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.redirect(target);
}
