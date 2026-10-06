// THE DIVIDEND SHAPES BEHIND COWORK #184 ITEM 1 (#553). READ-ONLY, ENFORCED.
//
// For the named payers (BKNG FMC PGR NSC KHC LYB MO ...): each stored quarter's
// and year's declared DPS and diluted EPS, as filed (and split-adjusted by A's
// splitAdjusted), plus the pickers row's payout result. Then, over every
// picker SEC symbol: how many have a Q4 with no DPS beside a fiscal year that
// has one, and how many each candidate cut / special rule would flag.
//
// PUBLIC LOG: filed per-share figures only (DPS, EPS), period labels, counts.
// No price, no bar, no market cap.
//
//   node scripts/dividend-shape-census.mjs   (relay: write-dividend-shape-census)
import { register } from "node:module";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET", "MGET", "HGET", "HMGET", "HKEYS", "HGETALL"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    if (!cmds.length) throw new Error("census is read-only: refused a request with no readable command");
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`census is read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};
const { readFactSet } = await import("../lib/server/secFactStore.ts");
const { valueOf, periodLabel } = await import("../lib/server/secFactCodec.ts");
const { splitAdjusted } = await import("../lib/server/secSplitAdjust.ts");
const { samePeriodPayout } = await import("../lib/server/pickersSecFundamentals.ts");
const { valuationInputs } = await import("../lib/server/secValuation.ts");
const redis = (await import("@upstash/redis")).Redis.fromEnv();

const NAMED = (process.env.NAMED || "BKNG FMC PGR NSC KHC LYB WTRG MAA MO BWA KO O").split(/\s+/);
const today = new Date().toISOString().slice(0, 10);
const f = (v) => (v === null || v === undefined ? "–" : Number(v).toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));

for (const sym of NAMED) {
  const raw = await readFactSet(sym);
  if (!raw) { console.log(`\n${sym}: no fact set`); continue; }
  const set = splitAdjusted(raw);
  console.log(`\n${sym}  cur ${raw.cur ?? "USD"}${set.spa ? `  splits ${JSON.stringify(set.spa.splits)}` : ""}`);
  console.log("  quarters (newest first): label end | DPS | EPS dil");
  for (const q of set.quarters.slice(0, 9)) console.log(`    ${periodLabel(q).padEnd(10)} ${q.e} | ${f(valueOf(q, "dividendsDeclaredPerShare"))} | ${f(valueOf(q, "epsDiluted"))}`);
  console.log("  years: label end | DPS | EPS dil");
  for (const y of set.years.slice(0, 3)) console.log(`    ${periodLabel(y).padEnd(10)} ${y.e} | ${f(valueOf(y, "dividendsDeclaredPerShare"))} | ${f(valueOf(y, "epsDiluted"))}`);
  const inputs = valuationInputs(raw, today, {});
  const pay = samePeriodPayout(set, inputs.eps);
  console.log(`  eps basis ${inputs.eps ? `${inputs.eps.basis} to ${inputs.eps.periodEnd} = ${f(inputs.eps.val)}` : "none"} · payout ${pay ? `${pay.basis} to ${pay.periodEnd} = ${pay.val.toFixed(1)}%` : "none"}`);
}

// ── the universe: shapes, counts only ──
const fields = await redis.hkeys("msh:pickers:sec-fundamentals:v1");
let sets = 0, payers = 0, q4Gap = 0, cut10 = 0, cut25 = 0, special3 = 0;
const cutNames = [], specialNames = [], gapNames = [];
for (const sym of fields) {
  const raw = await readFactSet(sym);
  if (!raw) continue;
  sets++;
  const set = splitAdjusted(raw);
  const q = set.quarters.slice(0, 8).map((p) => ({ p, d: valueOf(p, "dividendsDeclaredPerShare") }));
  const y = set.years[0];
  const yd = y ? valueOf(y, "dividendsDeclaredPerShare") : null;
  if (!(yd > 0) && !q.some((x) => x.d > 0)) continue;
  payers++;
  // A Q4 ending with the fiscal year but carrying no DPS.
  if (y && q.some((x) => x.p.e === y.e && x.d === null) && yd !== null) { q4Gap++; if (gapNames.length < 25) gapNames.push(sym); }
  const ds = q.slice(0, 4).map((x) => x.d).filter((d) => d !== null && d > 0);
  if (ds.length >= 3) {
    const latest = q.find((x) => x.d !== null && x.d > 0).d;
    const ttm = ds.reduce((a, b) => a + b, 0) * (4 / ds.length);
    if (latest * 4 < ttm * 0.9) { cut10++; if (cutNames.length < 30) cutNames.push(sym); }
    if (latest * 4 < ttm * 0.75) cut25++;
    const sorted = [...ds].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    if (Math.max(...ds) > 3 * med) { special3++; if (specialNames.length < 30) specialNames.push(sym); }
  }
}
console.log(`\nUNIVERSE: fact sets ${sets} · payers ${payers} · Q4 with no DPS beside a FY that has one ${q4Gap}`);
console.log(`  e.g. ${gapNames.join(" ")}`);
console.log(`latest quarter x4 under the 4-quarter run rate: by >10% ${cut10}, by >25% ${cut25}`);
console.log(`  >10%: ${cutNames.join(" ")}`);
console.log(`a quarter over 3x the median of the last 4 (special-shaped): ${special3}`);
console.log(`  ${specialNames.join(" ")}`);
console.log(`\nRedis commands ${commands} (read-only)`);
