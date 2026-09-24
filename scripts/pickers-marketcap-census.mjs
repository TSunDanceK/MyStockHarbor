// Where Pickers' Market Cap comes from TODAY, over the 700-symbol Pickers
// universe (Relay B, #553 COWORK #16 item 3, Friday prep). READ-ONLY.
//
// The page shows price x SEC cover-page shares (secValuation.marketCap, the
// stock page's function) wherever a SEC row exists; a SEC refusal CLEARS the
// field; a symbol with NO SEC row keeps the price pool's FMP-quote market cap.
// After the price split the pool carries a price and no market cap, so that
// last group is what the Friday change touches.
//
//   relay task: write-pickers-marketcap-census
//   Redis: 1 GET (universe) + 1 HMGET (SEC rows) + 1 HMGET (pool) = 3, once.
import "./lib/register-ts-here.mjs";
import { Redis } from "@upstash/redis";

const P = await import("../lib/server/pickersSecFundamentals.ts");
const V = await import("../lib/server/secValuation.ts");
const redis = Redis.fromEnv();

const raw = await redis.get("msh:pickers:v10:symbols");
const list = Array.isArray(raw) ? raw : Array.isArray(raw?.symbols) ? raw.symbols : [];
const universe = [...new Set(list.map((x) => String(typeof x === "string" ? x : x?.symbol ?? "").toUpperCase()).filter(Boolean))];
const secRows = await P.readSecPickerRows(universe);
const poolRaw = await redis.hmget("msh:price-pool:v1", ...universe);
const pool = new Map();
universe.forEach((s, i) => {
  let r = Array.isArray(poolRaw) ? poolRaw[i] : poolRaw?.[s];
  if (typeof r === "string") try { r = JSON.parse(r); } catch { r = null; }
  if (r && typeof r === "object") pool.set(s, r);
});

const tally = { secCap: 0, secRefused: {}, noSecRowPoolCap: 0, noSecRowNoCap: 0, noPrice: 0 };
const examples = { secRefused: {}, noSecRowPoolCap: [] };
for (const s of universe) {
  const row = secRows.get(s);
  const p = pool.get(s);
  const price = typeof p?.price === "number" ? p.price : null;
  if (row) {
    const fig = V.marketCap({ shares: row.inputs.shares, eps: null, refusals: row.inputs.refusals }, price);
    if (fig?.ok) tally.secCap++;
    else {
      const why = fig ? fig.why : price === null ? "no-price" : "unknown";
      tally.secRefused[why] = (tally.secRefused[why] ?? 0) + 1;
      (examples.secRefused[why] ??= []).length < 8 && examples.secRefused[why].push(s);
    }
  } else if (typeof p?.marketCap === "number") {
    tally.noSecRowPoolCap++;
    if (examples.noSecRowPoolCap.length < 30) examples.noSecRowPoolCap.push(s);
  } else tally.noSecRowNoCap++;
}
console.log(`Pickers universe ${universe.length}; SEC rows ${secRows.size}; pool rows ${pool.size}`);
console.log(`Market Cap today: price x SEC shares ${tally.secCap}`);
console.log(`  SEC refuses (shows "--" today): ${JSON.stringify(tally.secRefused)}`);
for (const [why, xs] of Object.entries(examples.secRefused)) console.log(`    ${why}: ${xs.join(" ")}`);
console.log(`  no SEC row, FMP pool cap shown today (blank after the split unless handled): ${tally.noSecRowPoolCap}: ${examples.noSecRowPoolCap.join(" ")}`);
console.log(`  no SEC row and no cap: ${tally.noSecRowNoCap}`);
console.log("Redis commands: 3 (read-only)");
