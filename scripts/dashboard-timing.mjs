// WHICH /dashboard SERVER READ WAITS? (#553 COWORK #145, read-only diagnosis)
//
// Runs the five reads app/dashboard/page.tsx awaits in its Promise.all, for
// each symbol in SYMBOLS, with FMP_API_KEY unset (as production now is), and
// times each one. A read still pending after LIMIT_MS is reported as such and
// abandoned (the run moves on). Per read: "ok <ms>", "threw <ms> <message>" or
// "PENDING after <ms>".
//
// READ-ONLY, ENFORCED: any Upstash command outside READ_VERBS is refused (and
// the code under test sees an error, as it would on a Redis blip). PUBLIC LOG:
// timings, outcomes and counts only, never a price or a bar.
//
//   SYMBOLS=COP,ODFL node scripts/dashboard-timing.mjs    (relay: write-dashboard-timing)
import { register } from "node:module";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

delete process.env.FMP_API_KEY;
const LIMIT_MS = Number(process.env.LIMIT_MS || 60_000);
const READ_VERBS = new Set(["GET", "MGET", "HGET", "HMGET", "HGETALL", "EXISTS", "SISMEMBER", "SMISMEMBER", "SMEMBERS", "SCARD", "TTL", "PTTL", "ZRANGE", "ZSCORE", "ZCARD", "HKEYS", "HLEN", "STRLEN", "TYPE"]);
const UPSTASH = (process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/$/, "");
const hosts = new Map();
let refused = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (UPSTASH && url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) { refused++; throw new Error(`read-only diagnosis: refused ${c?.[0]}`); }
  } else {
    try { const h = new URL(url).host; hosts.set(h, (hosts.get(h) ?? 0) + 1); } catch {}
  }
  return realFetch(input, init);
};

const { historyForSurface } = await import("../lib/server/tiingoHistory.ts");
const { getDailyHistory } = await import("../lib/server/historyCache.ts");
const { fetchQuoteSnapshot } = await import("../lib/server/quoteData.ts");
const { getBenchmarksData } = await import("../lib/server/benchmarksBuilder.ts");
const { getInternalNewsPayload } = await import("../lib/server/internalNews.ts");
const { secEarningsSummary } = await import("../lib/server/secEarningsSummary.ts");

async function timed(label, fn) {
  const t0 = Date.now();
  let timer;
  const limit = new Promise((r) => { timer = setTimeout(() => r({ pending: true }), LIMIT_MS); });
  const run = fn().then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
  const out = await Promise.race([run, limit]);
  clearTimeout(timer);
  const ms = Date.now() - t0;
  if (out.pending) return `${label}: PENDING after ${ms} ms`;
  if (!out.ok) return `${label}: threw after ${ms} ms (${String(out.e?.message ?? out.e).slice(0, 80)})`;
  return `${label}: ok ${ms} ms`;
}

const symbols = (process.env.SYMBOLS || "COP,ODFL,ATHS,SUN,SPY").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
console.log(`dashboard reads, FMP_API_KEY unset, limit ${LIMIT_MS} ms, symbols ${symbols.join(",")}`);
for (const s of symbols) {
  console.log(`\n== ${s}`);
  // One at a time first (which read is slow), then all five together as the page does.
  console.log("  " + await timed("history", () => historyForSurface("HISTORY", s, () => getDailyHistory(s, { caller: "dashboard" })).then((h) => `${h.provider}`)));
  console.log("  " + await timed("quote", () => fetchQuoteSnapshot(s)));
  console.log("  " + await timed("benchmarks", () => getBenchmarksData("stock")));
  console.log("  " + await timed("news", () => getInternalNewsPayload(s)));
  console.log("  " + await timed("sec-earnings", () => secEarningsSummary(s)));
}
console.log(`\noutbound hosts (non-Redis) and request counts: ${[...hosts].map(([h, n]) => `${h} ${n}`).join("; ") || "none"}`);
console.log(`Redis writes refused: ${refused}`);
// Abandoned reads may hold the event loop open; the verdicts are already printed.
process.exit(0);
