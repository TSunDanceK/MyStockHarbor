import { permanentRedirect } from "next/navigation";
import { NextRequest } from "next/server";

const affiliateLinks: Record<string, string> = {
  tradingview: "https://www.tradingview.com/?aff_id=164495",
  trading212:
    "https://helpcentre.trading212.com/hc/en-us/articles/360008095077-How-to-become-a-Trading-212-Affiliate",
  etoro: "https://www.etoro.com/partners/",
  interactivebrokers:
    "https://www.interactivebrokers.com/en/general/about/affiliate-programs.php",
  saxo: "https://www.home.saxo/en-gb/campaigns/affiliate",
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> }
) {
  const { platform } = await context.params;
  const key = platform.toLowerCase();

  let target = affiliateLinks[key] ?? "/platforms";

  if (key === "tradingview") {
    const rawSymbol = request.nextUrl.searchParams.get("symbol")?.trim();

    if (rawSymbol) {
      target = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(
        rawSymbol.toUpperCase()
      )}&aff_id=164495`;
    }
  }

  console.log("Affiliate click:", key);

  permanentRedirect(target);
}
