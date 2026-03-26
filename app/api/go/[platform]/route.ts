import { permanentRedirect } from "next/navigation";
import { NextRequest } from "next/server";

const affiliateLinks: Record<string, string> = {
  tradingview: "https://www.tradingview.com/?aff_id=164495",
  trading212: "https://www.trading212.com/",
  etoro: "https://www.etoro.com/",
  interactivebrokers:
    "https://www.interactivebrokers.com/en/trading/trading-platforms.php",
  saxo: "https://www.home.saxo/",
  webull: "https://www.webull.com/",
  robinhood: "https://robinhood.com/us/en/",
  moomoo: "https://www.moomoo.com/us",
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
