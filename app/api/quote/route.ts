import { NextResponse } from "next/server";
import { isUnwantedBot } from "@/lib/botid-guard";
import { fetchQuoteSnapshot, emptyQuote } from "@/lib/server/quoteData";
import {
  QUOTE_TOKEN_HEADER,
  verifyQuoteToken,
  isQuoteTokenEnforced,
} from "@/lib/server/quoteToken";
import { isKnownGoodBot } from "@/lib/server/knownGoodBots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sanitise anything user- or client-controlled before it goes into a log line.
 *
 * Strips CR/LF/tab and truncates. Without this, a caller could pass a header
 * (or ?symbol=) containing a newline and forge a second, fake "[quote-token]"
 * line in the logs -- classic log injection, and it would quietly poison the
 * exact data we're collecting to make the enforcement decision.
 */
function logSafe(value: string | null | undefined, max = 120): string {
  if (!value) return "none";
  const cleaned = value.replace(/[\r\n\t]+/g, " ").trim();
  if (!cleaned) return "none";
  return cleaned.length > max ? `${cleaned.slice(0, max)}...` : cleaned;
}

/**
 * Client IP. Vercel populates x-forwarded-for at the edge (the client is the
 * first entry; anything after it is proxy hops). The Vercel Logs UI does not
 * surface the IP in its request panel, which is precisely why it's worth
 * putting into the message itself.
 */
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return logSafe(xff.split(",")[0], 45);
  return logSafe(req.headers.get("x-real-ip"), 45);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "AAPL").toUpperCase();

  // Deep Analysis: fetchQuoteSnapshot() (lib/server/quoteData.ts) now sits
  // behind a short (60s) Redis cache + in-flight request dedupe -- see that
  // module's comment for why -- but this route is still the primary public
  // entry point for quote data and any cache miss is still a real, billed
  // FMP hit, so it stays on the deeper check. checkLevel here MUST match the
  // advancedOptions set for "/api/quote" in instrumentation-client.ts, or
  // verification fails outright.
  if (await isUnwantedBot("deepAnalysis")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // Page-token gate. BotID above answers "is this a real browser?"; this
  // answers "did this request come from someone who actually loaded one of
  // our pages?" -- the gap the 2026-07-21 audit's scripted ticker-walk sat in.
  //
  // LOG-ONLY BY DEFAULT. verifyQuoteToken() returns ok for everyone until
  // QUOTE_TOKEN_SECRET is set, and even then nothing is blocked until
  // QUOTE_TOKEN_ENFORCE=1. Deploying this with no env vars set changes
  // nothing. Read these log lines first: a steady trickle of "expired" means
  // QUOTE_TOKEN_TTL_SECONDS is too short for real sessions, and "missing"
  // from real visitors means a call site was left unwired -- either would
  // become a visible outage if enforcement were switched on blind. This is
  // the same staged rollout BotID and the AI Bots rule got.
  const tokenResult = verifyQuoteToken(req.headers.get(QUOTE_TOKEN_HEADER));
  if (!tokenResult.ok) {
    const userAgent = req.headers.get("user-agent");

    // Found 2026-08-01: Meta's own link-preview crawler (meta-externalagent
    // -- the biggest source of legitimate traffic on this site, generating
    // every Facebook/WhatsApp preview) calls this route directly with no
    // token every time it renders a /stock/[symbol] page, so it was showing
    // up as "missing" alongside genuine scrapers. Harmless today (log-only),
    // but it would 403 Meta's own crawler the moment QUOTE_TOKEN_ENFORCE is
    // ever set. isKnownGoodBot() (lib/server/knownGoodBots.ts, shared with
    // the honeypot trap) exempts these UAs from being blocked OR counted
    // toward the would-block log this gate's enforce/no-enforce decision is
    // based on -- logged separately at info level purely so an unexpected
    // volume from one of these is still visible without polluting the
    // missing/expired tallies.
    if (isKnownGoodBot(userAgent)) {
      console.info(
        `[quote-token] allowlisted-bot symbol=${logSafe(symbol, 12)} reason=${tokenResult.reason}` +
          ` ua="${logSafe(userAgent, 160)}"`
      );
    } else if (isQuoteTokenEnforced()) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    } else {
      // Identity fields are here rather than left to the Vercel Logs request
      // panel for two reasons: the panel does not show the client IP at all, and
      // more importantly a per-request panel can't be aggregated -- with the
      // details inline you can eyeball every offender in one filtered search
      // instead of clicking rows one at a time.
      //
      // ja4 lets a repeat offender be cross-referenced straight against the
      // Firewall JA4 rules (see claude/firewall-ja4-repeat-offenders-selfblock-
      // 2026-07-21.md). It is only populated on plans that expose it; "none" here
      // simply means unavailable, not that the client lacked a fingerprint.
      //
      // Note this logs visitor IPs into Vercel's runtime logs. That's ordinary
      // security telemetry for an abuse-detection gate, and it's bounded: it only
      // fires for requests that FAILED the token check, never for normal traffic.
      console.warn(
        `[quote-token] would-block symbol=${logSafe(symbol, 12)} reason=${tokenResult.reason}` +
          ` ip=${clientIp(req)}` +
          ` country=${logSafe(req.headers.get("x-vercel-ip-country"), 8)}` +
          ` ja4=${logSafe(req.headers.get("x-vercel-ja4-digest"), 64)}` +
          ` ref=${logSafe(req.headers.get("referer"), 100)}` +
          ` ua="${logSafe(userAgent, 160)}"` +
          ` (log-only; set QUOTE_TOKEN_ENFORCE=1 to enforce)`
      );
    }
  }

  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) {
    return NextResponse.json(emptyQuote(symbol), { status: 500 });
  }

  // Fetch/parse logic lives in lib/server/quoteData.ts so it can also be
  // called in-process (no HTTP self-fetch, no BotID header needed) by
  // server-rendered callers like lib/insightSnapshots.ts. See that module's
  // fetchQuoteSnapshot doc comment for the full reasoning.
  const payload = await fetchQuoteSnapshot(symbol);

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
