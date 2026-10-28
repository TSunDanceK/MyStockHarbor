// PRICE BASIS DRY RUN (audit r3 item 5): what the valuation card and the page
// title show, against main.
//
//   title   main and this branch: the newest completed EOD close (owner ruling:
//           unchanged, so it changes once a day for crawlers)
//   card    main and this branch: pickSurfacePrice, the newer of that close and
//           today's session IEX print. Same price; this branch changes only its
//           label to "Price: close, <day>" / "Price: last trade HH:MM ET".
//
// For every symbol in the Tiingo quote pool or the EOD-last hash: whether the
// card is on the close or a session trade (and its move from the title's
// close), and whether the title or the card PRICE changes against main. The
// split depends on when it runs: in or after the session, before the EOD job.
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

const n = { cardClose: 0, cardTrade: 0, titleChanged: 0, cardPriceChanged: 0, noCard: 0, noTitle: 0 };
const moves = [];
for (const sym of symbols) {
  const l = last[sym];
  const bars = l ? [[l.d, l.o, l.h, l.l, l.c, l.v]] : null;
  // The title, on main and here: the last completed close (no partial bar).
  const titleMain = l ? l.c : null, titleHere = l ? l.c : null;
  if (titleMain !== titleHere) n.titleChanged++;
  if (titleHere === null) n.noTitle++;
  // The card, on main and here: the same pick; here it is labelled by its basis.
  const pick = pickSurfacePrice(pool[sym] ?? null, bars, now);
  const card = earningsPrice(true, pick, null);
  if (!card) { n.noCard++; continue; }
  if (pick.price !== card.price) n.cardPriceChanged++;
  if (card.basis.kind === "close") { n.cardClose++; continue; }
  n.cardTrade++;
  const pct = titleHere ? ((card.price - titleHere) / titleHere) * 100 : null;
  if (pct !== null) moves.push(Math.abs(pct));
  console.log(`TRADE\t${sym}\ttitle $${titleHere?.toFixed(2) ?? "—"} close ${l?.d ?? "—"}\tcard $${card.price.toFixed(2)} ${priceBasisLabel(card.basis)} (main: "${pick.label}")\t${pct === null ? "" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`}`);
}
moves.sort((a, b) => a - b);
const q = (p) => (moves.length ? moves[Math.min(moves.length - 1, Math.floor(p * moves.length))].toFixed(2) : "—");
console.log(`\ntitles unchanged against main: ${symbols.length - n.titleChanged} of ${symbols.length} (changed: ${n.titleChanged}; no close to show: ${n.noTitle})`);
console.log(`card price changed against main: ${n.cardPriceChanged}`);
console.log(`cards labelled "last trade" (price differs from the title's close): ${n.cardTrade} (|card - title| median ${q(0.5)}%, p90 ${q(0.9)}%, max ${q(1)}%)`);
console.log(`cards labelled "close" (same price as the title): ${n.cardClose}`);
console.log(`no card price: ${n.noCard}`);
