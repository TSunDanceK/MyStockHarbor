// WHY IS A STOCK PAGE NOINDEX? (#553 COWORK #143 item 2)
//
// /stock/[symbol] sets index = hasData && !awaitingSecRead(symbol). For each
// symbol this reports both inputs as production holds them:
//   SEC     CIK, the extraction admit, the seed gate, and whether a fact set
//           is stored (awaitingSecRead = admitted, not refused, none stored)
//   prices  Tiingo universe membership, the stored daily bars (count and the
//           last bar's DATE), the supported list and the cold no-data set
//
// READ-ONLY, ENFORCED: any Upstash command outside READ_VERBS is refused before
// it is sent. PUBLIC LOG: dates and counts only, no price.
//
//   SYMBOLS=IMOS,IART,MXL node scripts/noindex-diagnosis.mjs   (relay: write-noindex-diagnosis)
import { register } from "node:module";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error("FATAL: needs the Upstash credentials (write- relay job).");
  process.exit(2);
}
const READ_VERBS = new Set(["GET", "MGET", "EXISTS", "SISMEMBER", "SMISMEMBER", "HMGET"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`diagnosis is read-only: refused ${c?.[0]}`);
    commands += cmds.length || 1;
  }
  return realFetch(input, init);
};

const { Redis } = await import("@upstash/redis");
const redis = Redis.fromEnv();
const S = await import("../lib/server/secColdFetch.ts");
const { admitSymbolForExtraction } = await import("../lib/server/securityKind.ts");
const { secSeedRefusal } = await import("../lib/server/secSeedGate.ts");
const { factSetPresence } = await import("../lib/server/secFactStore.ts");
const K = await import("../lib/server/marketData/keys.ts");
const { parseTiingoUniverse } = await import("../lib/server/tiingoUniverse.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");

const symbols = (process.env.SYMBOLS || "IMOS,IART,MXL").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const universe = new Set(parseTiingoUniverse(await redis.get(K.TIINGO_UNIVERSE_KEY))?.symbols ?? []);
const presence = await factSetPresence(symbols);

for (const s of symbols) {
  const cik = S.cikForSymbol(s);
  const admit = cik ? admitSymbolForExtraction(s, cik) : null;
  const refusal = cik ? secSeedRefusal(s, cik) : null;
  const stored = presence?.exists.get(s) ?? null;
  const awaiting = Boolean(cik && admit?.admit && !refusal) && stored === false;
  const d = toDashed(s);
  const eod = await redis.get(K.tiingoEodKey(d));
  const bars = eod && Array.isArray((typeof eod === "string" ? JSON.parse(eod) : eod).bars) ? (typeof eod === "string" ? JSON.parse(eod) : eod).bars : [];
  const supported = await redis.sismember(K.TIINGO_SUPPORTED_KEY, d);
  const noData = await redis.sismember(K.TIINGO_COLD_NODATA_KEY, d);
  console.log(`${s}: SEC cik ${cik ?? "none"} · admit ${admit ? `${admit.admit}${admit.admit ? "" : ` (${admit.reason ?? admit.kind ?? "?"})`}` : "-"} · seed refusal ${refusal ? JSON.stringify(refusal) : "none"} · fact set stored ${stored} · awaitingSecRead ${awaiting}`);
  console.log(`   prices: in Tiingo universe ${universe.has(d) || universe.has(s)} · stored daily bars ${bars.length}${bars.length ? ` (last ${bars[bars.length - 1][0]})` : ""} · on supported list ${Boolean(supported)} · cold no-data ${Boolean(noData)}`);
  console.log(`   => page robots: ${!awaiting && bars.length ? "index (if the page also reads its bars)" : `noindex because ${[awaiting ? "SEC set not yet read (awaitingSecRead)" : null, bars.length ? null : "no stored price data (hasData false)"].filter(Boolean).join(" and ")}`}`);
}
console.log(`\nRedis commands ${commands} (read-only: ${[...READ_VERBS].join(", ")})`);
