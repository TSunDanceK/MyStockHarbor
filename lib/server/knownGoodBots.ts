/**
 * Shared allowlist of user-agent substrings for crawlers whose entire
 * business model depends on being let through. Used by both the honeypot
 * trap (app/api/internal/feed-index/route.ts) and the quote-token gate
 * (app/api/quote/route.ts) so the two lists can't drift apart -- before
 * this file existed, each guard kept its own copy, and it's exactly the
 * kind of thing that gets updated in one place and silently forgotten in
 * the other.
 *
 * Google/Bing indexing, Meta's link-preview fetcher (meta-externalagent --
 * this site's single largest source of legitimate traffic, generating every
 * Facebook/WhatsApp link preview), Apple's, DuckDuckGo's. None of these
 * should ever be blocked by either guard: the trap link is invisible to
 * anything that respects CSS/ARIA, and the quote-token gate exists to catch
 * scripted callers that never render a page at all -- a hit from one of
 * these UAs is a signal to double-check the guard, not a bot to punish.
 * Getting this list wrong in the blocking direction risks silently killing
 * social-preview rendering or search visibility, a far worse outcome than
 * under-blocking a scraper.
 */
export const KNOWN_GOOD_UA_MARKERS = [
  "googlebot",
  "bingbot",
  "adsbot-google",
  "mediapartners-google",
  "meta-externalagent",
  "facebookexternalhit",
  "applebot",
  "duckduckbot",
  "bingpreview",

  // Google agents that do NOT contain the substring "googlebot" and so were
  // silently missed by the list above (found in the 2026-08-15 Search Console
  // audit -- see claude/seo-recovery-plan-2026-08-15.md):
  //
  //   Google-InspectionTool -- the fetcher behind Search Console's "Test Live
  //     URL" / URL Inspection. Blocking it makes the single most useful
  //     debugging tool in GSC report failures that don't exist on the live
  //     site, which is a genuinely painful way to lose an afternoon.
  //   GoogleOther -- Google's general-purpose crawler, used for discovery
  //     work that isn't core Search indexing.
  //   Storebot-Google -- product/shopping crawler.
  //   Google-Extended -- the Gemini/Vertex AI training agent.
  //
  // Google-Extended is listed here deliberately even though many sites choose
  // NOT to let AI training crawlers read their content. That choice belongs in
  // robots.txt (app/robots.ts), which is a polite "please don't read this".
  // This list is different: it decides who is exempt from an IP + JA4
  // *block*. Punishing a Google-owned crawler at the network layer risks
  // collateral damage to shared Google infrastructure that also serves
  // Googlebot itself -- so the two decisions should stay separate.
  "google-inspectiontool",
  "googleother",
  "storebot-google",
  "google-extended",
];

export function isKnownGoodBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const lower = userAgent.toLowerCase();
  return KNOWN_GOOD_UA_MARKERS.some((marker) => lower.includes(marker));
}
