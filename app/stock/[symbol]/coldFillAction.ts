"use server";

// THE ONLY CALLER OF fillColdSymbol. A server action, not a route: there is no
// public JSON endpoint, and it returns an outcome word rather than figures —
// the client refreshes and the page re-renders from the store.
// Gates and their order: see lib/server/secColdFill.ts.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { checkBotId } from "botid/server";
import { verifyQuoteToken } from "@/lib/server/quoteToken";
import { cikForSymbol, fillColdSymbol, type ColdFillOutcome } from "@/lib/server/secColdFetch";
import {
  COLD_FILL_SYMBOL,
  clientIpFrom,
  coldFillBotGate,
  coldFillDayGate,
  coldFillPreGate,
  countColdFillAttempt,
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
    ipCount: 0,
    attemptCount: 0,
  });
  if (early) return { ok: false, refused: early };

  // Every refusal past the attempt counter is counted by reason and logged.
  const refuse = async (reason: ColdFillRefusal): Promise<ColdFillReply> => {
    await countColdFillOutcome(reason);
    console.log("[cold-fill]", JSON.stringify({ symbol: clean, refused: reason }));
    return { ok: false, refused: reason };
  };

  const ip = clientIpFrom(await headers());
  const counts = await countColdFillAttempt(ip);
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
  if (botRefusal) return refuse(botRefusal);

  // THE DAY'S FILLS, counted only for a request BotID called human.
  const dayRefusal = coldFillDayGate(await countColdFillDay());
  if (dayRefusal) return refuse(dayRefusal);

  if (!(await takeColdFillLock(clean))) return refuse("in-flight");
  try {
    const outcome = await fillColdSymbol(clean);
    if (outcome === "filled" || outcome === "no-data") {
      // Permitted here, unlike in a render's after(): see secColdFetch's history.
      revalidatePath(`/stock/${clean}`);
      revalidatePath(`/stock/${clean}/earnings`);
    }
    await countColdFillOutcome(outcome);
    console.log("[cold-fill]", JSON.stringify({ symbol: clean, outcome }));
    return { ok: true, outcome };
  } finally {
    await releaseColdFillLock(clean);
  }
}
