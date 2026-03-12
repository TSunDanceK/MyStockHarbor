import { permanentRedirect } from "next/navigation";
import { NextRequest } from "next/server";

const affiliateLinks: Record<string, string> = {
  tradingview: "https://www.tradingview.com/partner-program/",
  trading212:
    "https://helpcentre.trading212.com/hc/en-us/articles/360008095077-How-to-become-a-Trading-212-Affiliate",
  etoro: "https://www.etoro.com/partners/",
  interactivebrokers:
    "https://www.interactivebrokers.com/en/general/about/affiliate-programs.php",
  saxo: "https://www.home.saxo/en-gb/campaigns/affiliate",
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ platform: string }> }
) {
  const { platform } = await context.params;
  const key = platform.toLowerCase();

  const target = affiliateLinks[key] ?? "/platforms";

  // Track clicks (for now just logs)
  console.log("Affiliate click:", key);

  permanentRedirect(target);
}
