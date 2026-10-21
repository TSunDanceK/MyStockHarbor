// PRICE BASIS DRY RUN (audit r3 item 5) — which earnings pages' TITLE price
// changes basis when the title switches to the valuation card's price.
//
//   before   the title printed the newest completed EOD close
//   after    the title prints earningsPrice: on Tiingo, pickSurfacePrice (the
//            newer of that close and today's session IEX print)
//
// For every symbol in the Tiingo quote pool or the EOD-last hash: the old and
// new title price, the new label, and the move. A page changes basis when the
// new price is a session trade rather than the close; the result depends on
// the time it runs (during or after the session, before the nightly EOD job).
//
// CREDENTIALLED, READ-ONLY: two HGETALLs (the quote pool and the EOD-last
// hash), nothing written, no meter. relay task: write-price-basis-dry-run
import { register } from "node:module";
import "./lib/register-ts-app.mjs";

// tiingoSurfacePrice imports the Data Cache reader, which imports next/cache;
// nothing here calls it (the two hashes are read directly, unmetered).
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);

const { Redis } = await import("@upstash/redis");
const K = await import("../lib/server/marketData/keys.ts");
const { parseEodLast } = await import("../lib/server/marketData/eodLast.ts");
const { pickSurfacePrice } = await import("../lib/server/tiingoSurfacePrice.ts");
const { earningsPrice } = await import("../lib/server/earningsPrice.ts");
const { priceBasisLabel } = await import("../lib/priceBasis.ts");

const redis = Redis.fromEnv();
const [poolRaw, lastRaw] = await Promise.all([
  redis.hgetall(K.TIINGO_QUOTES_KEY),
  redis.hgetall(K.TIINGO_EOD_LAST_KEY),
]);
const parse = (v) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return null; } };
const pool = {};
for (const [f, v] of Object.entries(poolRaw ?? {})) {
  if (f === K.TIINGO_QUOTES_META_FIELD) continue;
  const q = parse(v);
  if (q && typeof q.price === "number" && q.price > 0) pool[f] = q;
}
const last = {};
for (const [f, v] of Object.entries(lastRaw ?? {})) { const r = parseEodLast(v); if (r) last[f] = r; }

const now = Date.now();
const symbols = [...new Set([...Object.keys(pool), ...Object.keys(last)])].sort();
console.log(`run at ${new Date(now).toISOString()}; symbols: ${symbols.length} (pool ${Object.keys(pool).length}, eod-last ${Object.keys(last).length})\n`);

const n = { same: 0, basis: 0, gained: 0, lost: 0, none: 0 };
const moves = [];
for (const sym of symbols) {
  const l = last[sym];
  const bars = l ? [[l.d, l.o, l.h, l.l, l.c, l.v]] : null;
  const before = l ? { price: l.c, words: `close, ${l.d}` } : null;
  const after = earningsPrice(true, pickSurfacePrice(pool[sym] ?? null, bars, now), null);
  if (!before && !after) { n.none++; continue; }
  if (!before) { n.gained++; console.log(`GAIN\t${sym}\t— -> $${after.price.toFixed(2)} ${priceBasisLabel(after.basis)}`); continue; }
  if (!after) { n.lost++; console.log(`LOST\t${sym}\t$${before.price.toFixed(2)} ${before.words} -> —`); continue; }
  if (after.basis.kind === "close" && after.price === before.price) { n.same++; continue; }
  n.basis++;
  const pct = ((after.price - before.price) / before.price) * 100;
  moves.push(Math.abs(pct));
  console.log(`BASIS\t${sym}\t$${before.price.toFixed(2)} ${before.words} -> $${after.price.toFixed(2)} ${priceBasisLabel(after.basis)}\t${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`);
}
moves.sort((a, b) => a - b);
const q = (p) => (moves.length ? moves[Math.min(moves.length - 1, Math.floor(p * moves.length))].toFixed(2) : "—");
console.log(`\nunchanged (close both ways): ${n.same}`);
console.log(`title changes basis to the session trade: ${n.basis} (|move| median ${q(0.5)}%, p90 ${q(0.9)}%, max ${q(1)}%)`);
console.log(`title gains a price (no EOD bar, a session print): ${n.gained}`);
console.log(`title loses a price (EOD bar, no usable pick): ${n.lost}`);
console.log(`neither: ${n.none}`);
