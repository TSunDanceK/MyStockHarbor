"use server";

// THE STOCK PAGE'S TIINGO COLD FILL (#553 COWORK #121/#122/#123). The only
// non-job importer of lib/server/marketData/coldFill.ts
// (scripts/check-tiingo-callers.mjs). A server action, not a route: no public
// JSON, and the reply is an outcome word, never a figure -- the client
// refreshes and the page re-renders from the store with the Tiingo credit.
//
// The gate and its order: see coldFill.ts. BotID is DEEP ANALYSIS here because
// /stock/* POST is registered at that level in instrumentation-client.ts (A's
// SEC cold fill shares the path); a mismatched level fails verification.
import { headers } from "next/headers";
import { revalidatePath, revalidateTag } from "next/cache";
import { checkBotId } from "botid/server";
import { verifyQuoteToken } from "@/lib/server/quoteToken";
import { clientIpFrom } from "@/lib/server/secColdFill";
import { admitColdVisitor } from "@/lib/server/coldVisitorCap";
import { coldFillGate, fillTiingoColdSymbol, QUEUEING_REFUSALS, type ColdGateInput, type ColdRefusal } from "@/lib/server/marketData/coldFill";
import {
  COLD_SYMBOL,
  coldFillsPerDay,
  coldSettled,
  coldSymbol,
  countColdAttempt,
  countColdFill,
  queueColdSymbol,
  releaseColdLock,
  supportedState,
  takeColdLock,
  touchRequested,
} from "@/lib/server/tiingoColdState";
import { eodSymbolTag, tiingoEodKey } from "@/lib/server/marketData/keys";

export type TiingoColdReply =
  | { ok: true; outcome: "filled" | "already" | "no-data" | "queued" | "busy" }
  | { ok: false; refused: ColdRefusal | "timeout" | "error" };

function revalidateSymbol(sym: string) {
  revalidateTag(eodSymbolTag(sym), "max");
  revalidatePath(`/stock/${sym}`);
}

export async function requestTiingoColdFill(symbol: unknown, token: unknown): Promise<TiingoColdReply> {
  const sym = typeof symbol === "string" ? coldSymbol(symbol) : "";
  const g: ColdGateInput = {
    tokenOk: typeof token === "string" && verifyQuoteToken(token).ok,
    symbolOk: COLD_SYMBOL.test(sym),
    supported: "yes",
    visitorOk: true,
    attempts: 0,
  };
  // 1. Free refusals first.
  let refusal = coldFillGate(g);
  if (refusal) return { ok: false, refused: refusal };

  // 2. Already stored (another visitor, or the queue job): just refresh.
  if (await coldSettled(sym, tiingoEodKey(sym))) return { ok: true, outcome: "already" };

  const end = async (r: ColdRefusal): Promise<TiingoColdReply> => {
    const queued = QUEUEING_REFUSALS.has(r) ? await queueColdSymbol(sym) : false;
    console.log("[tiingo-cold-fill]", JSON.stringify({ symbol: sym, refused: r, queued }));
    return queued ? { ok: true, outcome: "queued" } : { ok: false, refused: r };
  };

  // 3. A real ticker, by Tiingo's own list. Junk ends here: no counter, no call.
  g.supported = await supportedState(sym);
  if ((refusal = coldFillGate(g))) return end(refusal);

  // 4. The visitor's 20 new tickers a day (shared with A's SEC fill). Fails closed.
  const ip = clientIpFrom(await headers());
  g.visitorOk = (await admitColdVisitor(ip, sym)).ok;
  // 5. The site's BotID attempts today, before the paid check.
  if (!(refusal = coldFillGate(g))) {
    g.attempts = await countColdAttempt();
    refusal = coldFillGate(g);
  }
  if (refusal) return end(refusal);

  // 6. BotID deep analysis. Any bot, a verified crawler included, is refused and queued.
  try {
    const v = await checkBotId({ advancedOptions: { checkLevel: "deepAnalysis" } });
    g.bot = { isBot: Boolean(v.isBot), isVerifiedBot: Boolean(v.isVerifiedBot) };
  } catch {
    g.bot = null;
  }
  if ((refusal = coldFillGate(g))) return end(refusal);

  // 7. The site's fills this hour and today.
  g.fills = await countColdFill();
  g.dayCap = coldFillsPerDay();
  if ((refusal = coldFillGate(g))) return end(refusal);

  // 8. One fetch per symbol, however many visitors arrive together.
  if (!(await takeColdLock(sym))) return { ok: true, outcome: "busy" };
  try {
    const r = await fillTiingoColdSymbol(sym, { path: "cold-fill" });
    console.log("[tiingo-cold-fill]", JSON.stringify({ symbol: sym, outcome: r }));
    if (r === "filled" || r === "no-data") {
      revalidateSymbol(sym);
      return { ok: true, outcome: r };
    }
    // A timeout, a limiter refusal or an error: the queue job tries again.
    const queued = await queueColdSymbol(sym);
    if (queued) return { ok: true, outcome: "queued" };
    return { ok: false, refused: r === "timeout" ? "timeout" : "error" };
  } finally {
    await releaseColdLock(sym);
  }
}

/**
 * IS IT STORED YET? The client's poll: a POST (never a CDN or ISR copy), reads
 * only -- no BotID, no counter, no Tiingo. 1 pipeline of 2.
 */
export async function tiingoColdFillStatus(symbol: unknown, token: unknown): Promise<{ ready: boolean }> {
  const sym = typeof symbol === "string" ? coldSymbol(symbol) : "";
  if (typeof token !== "string" || !verifyQuoteToken(token).ok || !COLD_SYMBOL.test(sym)) return { ready: false };
  return { ready: await coldSettled(sym, tiingoEodKey(sym)) };
}

/**
 * A view of a symbol outside the committed universe keeps it in the requested
 * set (30 days without one and it drops out). 1 ZADD XX GT; a no-op for any
 * symbol not in the set. No figure returned.
 */
export async function touchTiingoRequested(symbol: unknown, token: unknown): Promise<void> {
  const sym = typeof symbol === "string" ? coldSymbol(symbol) : "";
  if (typeof token !== "string" || !verifyQuoteToken(token).ok || !COLD_SYMBOL.test(sym)) return;
  await touchRequested(sym);
}
