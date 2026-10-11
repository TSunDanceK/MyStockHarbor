// THE MISSING-CAP REASON, TRACED THROUGH THE PAGE'S OWN CODE (#553 COWORK
// #191 item 2 / #194 step 4). READ-ONLY, ENFORCED (GET, HGETALL, HMGET).
//
// For the named symbols: the stored picker SEC row, then the exact calls
// PickerResultPage makes on it (applySecPickerRow, applySecEarnings,
// secPickerWhy, secPickerWords) against the stored close, and the tap words
// the grid shows for the Market Cap cell (cellWhyWords). Plus whether the
// symbol is in the pickers universe and on which flag screens it sits today.
//
// PUBLIC LOG: symbols, codes and words only. The close is used, never printed.
//
//   node scripts/cap-reason-trace.mjs   (relay: write-cap-reason-trace)
import { register } from "node:module";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET", "MGET", "HGETALL", "HMGET"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    if (!cmds.length) throw new Error("read-only: refused a request with no readable command");
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const F = await import("../lib/server/pickersSecFundamentals.ts");
const { cellWhyWords } = await import("../lib/pickerCellWhy.ts");
const { TIINGO_EOD_LAST_KEY } = await import("../lib/server/marketData/keys.ts");
const { toDashed, symbolSpellings } = await import("../lib/symbolSpellings.mjs");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

const NAMED = (process.env.NAMED || "BBVA NMR NVMI BABA RIO AFRM HRL TPG ZM MFG MKC-V RCI GFL").split(/\s+/);
const all = (await redis.hgetall("msh:pickers:sec-fundamentals:v1")) ?? {};
const last = await redis.hmget(TIINGO_EOD_LAST_KEY, ...NAMED.map((s) => toDashed(s)));
const universe = new Set((parse(await redis.get("msh:pickers:v10:symbols")) ?? []).map((s) => toDashed(String(s).toUpperCase())));
const manifest = parse(await redis.get("msh:pickers:v10:manifest"));
const records = [];
if (manifest && Array.isArray(manifest.chunkKeys)) {
  for (let i = 0; i < manifest.chunkKeys.length; i += 20) for (const c of await redis.mget(...manifest.chunkKeys.slice(i, i + 20))) records.push(...(parse(c) ?? []));
}
const recBy = new Map(records.map((r) => [toDashed(String(r.symbol).toUpperCase()), r]));

const closeOf = (raw) => {
  const e = parse(raw);
  const bar = Array.isArray(e?.bar) ? e.bar : Array.isArray(e) ? e : null;
  const c = bar ? Number(bar[4]) : Number(e?.c ?? e?.close);
  return Number.isFinite(c) && c > 0 ? c : null;
};
const lastBy = new Map(NAMED.map((s, i) => [s, last ? last[toDashed(s)] ?? last[i] : null]));

console.log("symbol | in universe | record today | row | cap shown | cap code | cell word | tap note");
for (const s of NAMED) {
  const field = [s, ...symbolSpellings(s)].find((x) => all[x] !== undefined);
  const rec = recBy.get(toDashed(s));
  const head = `${s} | ${universe.has(toDashed(s)) ? "yes" : "no"} | ${rec ? "yes" : "no"}`;
  if (!field) { console.log(`${head} | no SEC row | – | – | – | –`); continue; }
  const row = parse(all[field]);
  const price = closeOf(lastBy.get(s));
  const figures = F.applySecPickerRow(row, price);
  const earnings = F.applySecEarnings(row, price);
  const why = F.secPickerWhy(row, price, figures, earnings, rec?.industry ?? null);
  const words = F.secPickerWords(why);
  const code = why.marketCap ?? null;
  // THE DIV CELLS (#553 COWORK #198 item 2): shown or not, and the cut/special/ifrs mark. Figures are filed DPS; the yield needs the close, so only shown/not.
  if (process.env.SHOW_DIV) console.log(`  ${s} div: Div ($) ${figures.divPerShare === null ? "–" : `$${figures.divPerShare.toFixed(2)}`} · yield ${figures.divYield === null ? "–" : "shown"} · growth ${figures.divGrowth === null ? "–" : `${figures.divGrowth.toFixed(1)}%`} · payout ${earnings?.payoutRatio == null ? `– (${earnings?.payoutBasis ?? why.payoutRatio ?? "no basis"})` : `${earnings.payoutRatio.toFixed(1)}% (${earnings.payoutBasis})`} · mark ${row.div ? JSON.stringify(row.div) : "none"} · row built ${new Date(row.at).toISOString()}`);
  if (process.env.SHOW_REVENUE) console.log(`  ${s} revenue: shown ${figures.revenue === null ? "no" : "yes"} · why ${why.revenue ?? "–"} · row has m.revenue ${row.m?.revenue?.vals?.revenue != null} · incomplete ${row.m?.revenueIncomplete === true} · unit ${JSON.stringify(row.unit)}`);
  console.log(`${head} | "${field}" | ${figures.marketCap === null ? "no" : "yes"} | ${code ?? "–"} | ${words.marketCap ?? "–"} | ${code ? cellWhyWords(code) : "–"}${price === null ? " (no stored close)" : ""}`);
}
console.log(`\nRedis commands ${commands} (read-only)`);
