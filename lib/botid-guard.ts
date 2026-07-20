import { checkBotId } from "botid/server";

/**
 * Returns true when the current request should be blocked as an unwanted bot.
 *
 * Verified crawlers (Googlebot, GPTBot, ChatGPT, PerplexityBot, etc.) are
 * allowed through so SEO / AI-citation traffic is NEVER blocked — only
 * unverified automated clients (scrapers) are flagged.
 *
 * Usage inside a protected route handler:
 *
 *   import { isUnwantedBot } from "@/lib/botid-guard";
 *
 *   export async function GET(request: NextRequest) {
 *     if (await isUnwantedBot()) {
 *       return NextResponse.json({ error: "Access denied" }, { status: 403 });
 *     }
 *     // ...normal data response
 *   }
 *
 * The route's path/method must also be listed in instrumentation-client.ts,
 * otherwise checkBotId() has no client header to validate.
 *
 * Pass checkLevel: "deepAnalysis" to run Vercel's paid Deep Analysis model on
 * this route instead of the free Basic check. This MUST match the
 * advancedOptions.checkLevel set for the same path/method in
 * instrumentation-client.ts, or verification fails outright (client/server
 * checkLevel mismatch). Deep Analysis bills per checkBotId() call on that
 * route once Basic passes — real visitor or not — so only opt specific,
 * high-value routes in. /api/quote was the first: it calls FMP live on every
 * request with no caching at all, so every hit is a real, billed upstream
 * call with zero cushion — see
 * claude/firewall-bot-protection-audit-2026-07-19.md for the full reasoning.
 */
export async function isUnwantedBot(
  checkLevel: "basic" | "deepAnalysis" = "basic"
): Promise<boolean> {
  const verification = await checkBotId(
    checkLevel === "deepAnalysis"
      ? { advancedOptions: { checkLevel: "deepAnalysis" } }
      : undefined
  );
  // Block bots, but never block a Vercel-verified crawler.
  return verification.isBot && !verification.isVerifiedBot;
}
