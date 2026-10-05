// WHY THE DIVIDEND PICKERS RENDER EMPTY, MEASURED (#553 COWORK #149 item 1).
//
// For the pickers universe, reads the two SEC picker hashes (production and
// the preview-only copy) and the FMP stock-data rows, and runs the page's own
// read (applySecPickerRow) against each symbol's last stored close, to count:
//   - rows present / fresh (inside the 3-day TTL) / in dollars, per hash;
//   - rows with a twelve-month declared dividend per share, and with growth;
//   - how many symbols each hash would put on /high-dividend-yield-stocks
//     (yield >= 4) and /dividend-growth-stocks (yield >= 2 and growth >= 5);
//   - FMP stock-data rows still present, and with a dividend yield.
//
// READ-ONLY, ENFORCED: any Upstash command outside READ_VERBS is refused
// before it is sent. PUBLIC LOG (#553): counts only. No price, bar, dividend
// or other per-symbol value is printed; tickers are printed only as counts.
//
//   node scripts/dividend-census.mjs     (relay: write-dividend-census)
import { register } from "node:module";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error("FATAL: needs the Upstash credentials (write- relay job).");
  process.exit(2);
}
const READ_VERBS = new Set(["GET", "MGET", "HMGET", "HLEN", "TTL"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`census is read-only: refused ${c?.[0]}`);
    commands += cmds.length || 1;
  }
  return realFetch(input, init);
};

const redis = (await import("@upstash/redis")).Redis.fromEnv();
const S = await import("../lib/server/pickersSecFundamentals.ts");
const { tiingoEodKey, TIINGO_UNIVERSE_KEY } = await import("../lib/server/marketData/keys.ts");
const { eodBarsToPoints } = await import("../lib/server/marketData/pickerHistory.ts");
const { parseTiingoUniverse } = await import("../lib/server/tiingoUniverse.ts");
const { PICKERS_SYMBOLS_KEY } = await import("../lib/server/pickersBuilder.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");

const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
let universe = parse(await redis.get(PICKERS_SYMBOLS_KEY));
let source = "pickers-symbols";
if (!Array.isArray(universe) || !universe.length) {
  universe = parseTiingoUniverse(await redis.get(TIINGO_UNIVERSE_KEY))?.symbols ?? [];
  source = "tiingo-universe";
}
universe = [...new Set(universe.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
if (!universe.length) { console.error("FATAL: no universe."); process.exit(1); }

// Last stored close per symbol (never printed).
const close = new Map();
for (let i = 0; i < universe.length; i += 10) {
  const chunk = universe.slice(i, i + 10);
  const vals = await redis.mget(...chunk.map((s) => tiingoEodKey(toDashed(s))));
  chunk.forEach((s, k) => {
    const e = parse(vals[k]);
    const bars = e && Array.isArray(e.bars) ? eodBarsToPoints(e.bars).filter((b) => b.close > 0) : [];
    if (bars.length) close.set(s, bars[bars.length - 1].close);
  });
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
const staleBefore = Date.now() - S.PICKERS_SEC_TTL_SECONDS * 1000;
async function census(label, key) {
  const len = await redis.hlen(key);
  const ttl = await redis.ttl(key);
  const rows = new Map();
  for (let i = 0; i < universe.length; i += 200) {
    const chunk = universe.slice(i, i + 200);
    const raw = await redis.hmget(key, ...chunk);
    chunk.forEach((s, k) => {
      const v = Array.isArray(raw) ? raw[k] : raw && typeof raw === "object" ? raw[s] : null;
      const row = parse(v);
      if (row && typeof row === "object" && row.v === 1) rows.set(s, row);
    });
  }
  let fresh = 0, usd = 0, dps = 0, growth = 0, yieldShown = 0, hy = 0, dg = 0;
  let newest = 0, oldest = Infinity;
  for (const [s, row] of rows) {
    newest = Math.max(newest, row.at); oldest = Math.min(oldest, row.at);
    if (row.at < staleBefore) continue;
    fresh++;
    const f = S.applySecPickerRow(row, close.get(s) ?? null);
    if (row.unit == null || row.unit === "USD" || f.revenue !== null || f.marketCap !== null) usd++;
    if (f.divPerShare !== null) dps++;
    if (f.divGrowth !== null) growth++;
    if (f.divYield !== null) yieldShown++;
    if (f.divYield !== null && f.divYield >= 4) hy++;
    if (f.divYield !== null && f.divYield >= 2 && f.divGrowth !== null && f.divGrowth >= 5) dg++;
  }
  const day = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "—");
  console.log(`\n── ${label} (${key})`);
  console.log(`  hash fields ${len ?? 0} · key TTL ${ttl ?? "?"} s · universe rows present ${rows.size}/${universe.length} · inside the 3-day TTL ${fresh} · written ${day(oldest)} → ${day(newest)} UTC`);
  console.log(`  twelve-month declared dividend per share: ${dps} (${pct(dps, fresh)} of fresh rows) · dividend growth: ${growth} · a yield (with a stored close): ${yieldShown}`);
  console.log(`  would list: /high-dividend-yield-stocks (yield ≥ 4) ${hy} · /dividend-growth-stocks (yield ≥ 2, growth ≥ 5) ${dg}`);
  return { rows, fresh, dps, hy, dg };
}

console.log(`universe ${universe.length} (${source}) · with a stored close ${close.size}`);
const prod = await census("PRODUCTION hash", S.PICKERS_SEC_KEY);
const prev = await census("PREVIEW hash", S.PICKERS_SEC_PREVIEW_KEY);

// FMP stock-data rows (the lapsed source).
let sd = 0, sdYield = 0, sdGrowth = 0;
for (let i = 0; i < universe.length; i += 50) {
  const chunk = universe.slice(i, i + 50);
  const vals = await redis.mget(...chunk.map((s) => `msh:stockdata:v1:${s}`));
  for (const v of vals) {
    const row = parse(v);
    if (!row || typeof row !== "object") continue;
    sd++;
    if (row.divYield != null) sdYield++;
    if (row.divGrowth != null) sdGrowth++;
  }
}
console.log(`\n── FMP stock-data rows (msh:stockdata:v1:*) still present: ${sd}/${universe.length} · with a dividend yield ${sdYield} · with growth ${sdGrowth}`);

// THE OTHER FUNDAMENTAL SCREENS (#553 COWORK #151 item 2), on the production
// hash: P/E through applySecEarnings, FCF through applySecPickerRow, sector and
// industry through A's committed resolver -- the page's own reads.
{
  const { resolveProfileBulk } = await import("../lib/server/staticProfile.ts");
  const tax = resolveProfileBulk(universe.map((s) => ({ symbol: s, cached: null })), "census");
  let lowPe = 0, cashRich = 0, cheapTech = 0, semis = 0, pe = 0, fcf = 0, sector = 0, industry = 0;
  for (const s of universe) {
    const t = tax.get(s.toUpperCase());
    if (t?.sector) sector++;
    if (t?.industry) industry++;
    if (t?.industry === "Semiconductors") semis++;
    const row = prod.rows.get(s);
    if (!row || row.at < staleBefore) continue;
    const px = close.get(s) ?? null;
    const f = S.applySecPickerRow(row, px);
    const e = S.applySecEarnings(row, px);
    const peRatio = e?.peRatio ?? null;
    if (peRatio !== null) pe++;
    if (f.freeCashFlow !== null) fcf++;
    if (peRatio !== null && peRatio <= 15) lowPe++;
    if (f.freeCashFlow !== null && f.freeCashFlow >= 10_000_000_000 && peRatio !== null && peRatio <= 20) cashRich++;
    if (t?.sector === "Technology" && peRatio !== null && peRatio <= 25) cheapTech++;
  }
  console.log(`\n── other fundamental screens (production hash; P/E ${pe}, FCF ${fcf}, sector ${sector}, industry ${industry} of ${universe.length})`);
  console.log(`  would list: /low-pe-stocks (P/E ≤ 15) ${lowPe} · /cash-rich-value-stocks (FCF ≥ $10B, P/E ≤ 20) ${cashRich} · /cheap-tech-stocks (Technology, P/E ≤ 25) ${cheapTech} · /semiconductor-stocks ${semis}`);
}

// Symbols with no fresh production row keep only what stock data gives them, which is now nothing.
const noProdRow = universe.filter((s) => { const r = prod.rows.get(s); return !r || r.at < staleBefore; }).length;
console.log(`\nno fresh PRODUCTION row: ${noProdRow} symbols (their dividend cells now come from nowhere)`);
console.log(`\nRedis commands ${commands} (read-only: ${[...READ_VERBS].join(", ")})`);
