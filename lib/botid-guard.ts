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
 */
export async function isUnwantedBot(): Promise<boolean> {
  const verification = await checkBotId();
  // Block bots, but never block a Vercel-verified crawler.
  return verification.isBot && !verification.isVerifiedBot;
}
