// RETICKERS IN THE PRICE PATH, READ-ONLY (#553 COWORK #70): BK -> BNY, EQR -> VMRK.
// For each of the four: Pickers universe, price pool, the Tiingo universes (the
// pool less debt listings and PRICE_EXCLUDED, as jobs.ts builds them), the
// stored Tiingo history (row count, first and last date) and IEX quote
// (present or not), and whether the production Pickers row is valued.
// Prints presence, counts and dates only: no prices, no Tiingo values (the
// Actions log is public).
//
//   relay task: write-retick-census   (SYMBOLS="A,B" to override)
//   Redis: 1 GET + 1 HMGET (pool) + 1 GET per symbol (history) + 1 HMGET
//   (quotes) + 1 HMGET (Pickers rows) = 8 for the four, once.
import "./lib/register-ts-here.mjs";
import { Redis } from "@upstash/redis";
import { toDashed } from "../lib/symbolSpellings.mjs";
import { isPriceExcluded } from "../lib/priceExcluded.mjs";

const K = await import("../lib/server/marketData/keys.ts");
const U = await import("../lib/server/marketData/universe.ts");
const P = await import("../lib/server/pickersSecFundamentals.ts");
const redis = Redis.fromEnv();
const symbols = (process.env.SYMBOLS || "BNY,VMRK,BK,EQR").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

const rawUni = await redis.get("msh:pickers:v10:symbols");
const list = Array.isArray(rawUni) ? rawUni : Array.isArray(rawUni?.symbols) ? rawUni.symbols : [];
const pickers = new Set(list.map((x) => String(typeof x === "string" ? x : x?.symbol ?? "").toUpperCase()));
const parse = (v) => { if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } } return v ?? null; };
const at = (res, i, key) => (Array.isArray(res) ? res[i] : res?.[key]);
const pool = await redis.hmget("msh:price-pool:v1", ...symbols.map(toDashed));
const quotes = await redis.hmget(K.TIINGO_QUOTES_KEY, ...symbols);
const rows = await redis.hmget(P.PICKERS_SEC_KEY, ...symbols);

for (const [i, s] of symbols.entries()) {
  const poolRow = parse(at(pool, i, toDashed(s)));
  const inPool = poolRow !== null;
  const tiingoUniverse = inPool && !U.isDebtListing(s) && !isPriceExcluded(s);
  const eod = parse(await redis.get(K.tiingoEodKey(s)));
  const bars = Array.isArray(eod?.bars) ? eod.bars : [];
  const quote = parse(at(quotes, i, s));
  const row = parse(at(rows, i, s));
  const price = typeof poolRow?.price === "number" ? poolRow.price : null;
  const e = row ? P.applySecEarnings(row, price) : null;
  const f = row ? P.applySecPickerRow(row, price) : null;
  console.log(JSON.stringify({
    symbol: s,
    pickersUniverse: pickers.has(s),
    pricePool: inPool,
    priceExcluded: isPriceExcluded(s),
    tiingoEodAndQuoteUniverse: tiingoUniverse,
    tiingoHistory: bars.length ? { rows: bars.length, first: bars[0][0], last: bars[bars.length - 1][0], basis: eod?.basis ?? null } : null,
    iexQuoteStored: quote !== null,
    pickersRow: row ? { pe: e?.peRatio != null, eps: e?.epsTtm != null, cap: f?.marketCap != null } : null,
  }));
}
console.log(`Pickers universe ${pickers.size}; Redis commands: ${4 + symbols.length} (read-only)`);
process.exit(0);
