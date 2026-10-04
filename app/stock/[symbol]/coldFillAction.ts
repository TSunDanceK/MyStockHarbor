"use server";

// THE ONLY CALLER OF fillColdSymbol. A server action, not a route: there is no
// public JSON endpoint, and it returns an outcome word rather than figures —
// the client refreshes and the page re-renders from the store.
// Gates and their order: see lib/server/secColdFill.ts.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { checkBotId } from "botid/server";
import { verifyQuoteToken } from "@/lib/server/quoteToken";
import { cikForSymbol, coldSecConfigured, fetchColdSubmissions, fillColdSymbol, queueColdSymbol, type ColdFillOutcome } from "@/lib/server/secColdFetch";
import { admitColdVisitor } from "@/lib/server/coldVisitorCap";
import { factSetExists } from "@/lib/server/secFactStore";
import { seedColdReportDates } from "@/lib/server/secColdReportDates";
import {
  COLD_FILL_SYMBOL,
  clientIpFrom,
  coldFillBotGate,
  coldFillDayGate,
  coldFillPreGate,
  coldFillVisitorGate,
  countColdFillAttempt,
  countColdFillIpAttempt,
  countColdFillDay,
  countColdFillOutcome,
  releaseColdFillLock,
  takeColdFillLock,
  type ColdFillRefusal,
} from "@/lib/server/secColdFill";

export type ColdFillReply =
  | { ok: true; outcome: ColdFillOutcome }
  | { ok: false; refused: ColdFillRefusal };

export async function requestColdFill(symbol: unknown, token: unknown): Promise<ColdFillReply> {
  const clean = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
  const tokenOk = typeof token === "string" && verifyQuoteToken(token).ok;
  const symbolOk = COLD_FILL_SYMBOL.test(clean);

  // THE FREE REFUSALS FIRST — no counter is spent on a request that fails them.
  const early = coldFillPreGate({
    tokenOk,
    symbolOk,
    hasCik: symbolOk && cikForSymbol(clean) !== null,
    attemptCount: 0,
  });
  if (early) return { ok: false, refused: early };

  // Every refusal past the attempt counter is counted by reason and logged.
  const refuse = async (reason: ColdFillRefusal): Promise<ColdFillReply> => {
    await countColdFillOutcome(reason);
    console.log("[cold-fill]", JSON.stringify({ symbol: clean, refused: reason }));
    return { ok: false, refused: reason };
  };

  // THE ADDRESS FIRST (#552 COWORK #147): one noisy client is refused here,
  // before it can spend the site's daily attempts. Nothing is queued.
  const ip = clientIpFrom(await headers());
  const ipLimited = coldFillPreGate({ tokenOk, symbolOk, hasCik: true, ipAttemptCount: await countColdFillIpAttempt(ip), attemptCount: 0 });
  if (ipLimited) return refuse(ipLimited);

  const counts = await countColdFillAttempt();
  const limited = coldFillPreGate({ tokenOk, symbolOk, hasCik: true, ...counts });
  if (limited) return refuse(limited);

  // THE PAID CHECK, only for a request every free gate has let through.
  let bot: { isBot: boolean; isVerifiedBot: boolean } | null = null;
  try {
    const v = await checkBotId({ advancedOptions: { checkLevel: "deepAnalysis" } });
    bot = { isBot: Boolean(v.isBot), isVerifiedBot: Boolean(v.isVerifiedBot) };
  } catch {
    bot = null;
  }
  const botRefusal = coldFillBotGate(bot);
  // A VERIFIED CRAWLER QUEUES, BEHIND PEOPLE; any other bot queues nothing.
  if (botRefusal === "crawler") await queueColdSymbol(clean, "crawler");
  if (botRefusal) return refuse(botRefusal);

  // THE SHARED VISITOR CAP (B's coldVisitorCap, #552 COWORK #132): 20 new
  // tickers a person a UTC day, Tiingo and SEC together. Over it, QUEUE only.
  // Fails closed: an uncountable visitor fetches nothing and queues nothing.
  const visitorRefusal = coldFillVisitorGate(await admitColdVisitor(ip, clean));
  if (visitorRefusal === "visitor-cap") await queueColdSymbol(clean, "person");
  if (visitorRefusal) return refuse(visitorRefusal);

  // THE DAY'S FILLS, counted only for a request BotID called human.
  const dayRefusal = coldFillDayGate(await countColdFillDay());
  if (dayRefusal) return refuse(dayRefusal);

  if (!(await takeColdFillLock(clean))) return refuse("in-flight");
  try {
    const outcome = await fillColdSymbol(clean);
    // THE REPORT-DATES RECORD RIDES ALONG (#552 COWORK #78, WDFC), before the
    // revalidation so the page it rebuilds has both. Bounded, best effort.
    // Through the cold path's own SEC fetch and rate bucket; skipped, and said
    // so in the log line, when no User-Agent is configured.
    const dates = outcome !== "filled" ? null
      : !coldSecConfigured() ? "skipped-no-user-agent"
        : await seedColdReportDates(clean, cikForSymbol(clean) as string, fetchColdSubmissions, new Date().toISOString().slice(0, 10));
    if (outcome === "filled" || outcome === "no-data") {
      // Permitted here, unlike in a render's after(): see secColdFetch's history.
      revalidatePath(`/stock/${clean}`);
      revalidatePath(`/stock/${clean}/earnings`);
    }
    await countColdFillOutcome(outcome);
    console.log("[cold-fill]", JSON.stringify({ symbol: clean, outcome, ...(dates ? { dates } : {}) }));
    return { ok: true, outcome };
  } finally {
    await releaseColdFillLock(clean);
  }
}

/**
 * IS THE SET STORED YET? The cold-fill client's poll (#552 COWORK #46).
 *
 * A server action, so a POST: never served from the CDN or an ISR copy, which
 * is the "no-store" the poll needs. It reads, never fills: no BotID, no
 * counter, no lock. ONE Redis EXISTS per call; the free gates (token, symbol,
 * CIK) refuse before it. Null Redis reads as "not yet" — the poll gives up on
 * its own ceiling rather than refreshing into a page that is still cold.
 */
export async function coldFillStatus(symbol: unknown, token: unknown): Promise<{ ready: boolean }> {
  const clean = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
  if (typeof token !== "string" || !verifyQuoteToken(token).ok) return { ready: false };
  if (!COLD_FILL_SYMBOL.test(clean) || cikForSymbol(clean) === null) return { ready: false };
  return { ready: (await factSetExists(clean)) === true };
}
