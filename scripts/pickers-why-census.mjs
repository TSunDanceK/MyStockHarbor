// PICKERS "–" CENSUS, READ-ONLY (#553 COWORK #87a, before the purge).
//
// Over the Pickers universe (the last build's own symbol list):
//   1. NAMES: how many rows the live exchange directory names, how many only
//      under the dotted spelling (MKC.V for MKC-V), how many only the committed
//      floor names (snapshot, else SEC's registrant name), and how many have
//      no name at all -- with the symbols.
//   2. REASONS: for each filings column, how many rows are empty and under
//      which reason code, from A's refusals at read time (secPickerWhy), with
//      the pool price the page divides by and A's industry label.
//
// READ-ONLY, ENFORCED: every Upstash request is inspected and any non-read
// verb is refused before it is sent. FMP is never called.
// PUBLIC LOG (#553): counts, symbols and reason codes only; no prices or
// figures.
//
//   node scripts/pickers-why-census.mjs
import { register } from "node:module";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

delete process.env.FMP_API_KEY;

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error("FATAL: needs the Upstash credentials (write- relay job).");
  process.exit(2);
}

const READ_VERBS = new Set(["GET", "MGET", "HGET", "HMGET", "HGETALL", "HKEYS", "HLEN", "EXISTS", "TTL", "PTTL", "STRLEN", "TYPE", "SMEMBERS", "SCARD"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
const meter = { commands: 0, refused: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    for (const c of cmds) {
      const verb = String(c?.[0] ?? "").toUpperCase();
      if (!READ_VERBS.has(verb)) { meter.refused++; throw new Error(`census is read-only: refused ${verb}`); }
    }
    meter.commands += cmds.length || 1;
  }
  return realFetch(input, init);
};

const { Redis } = await import("@upstash/redis");
const redis = Redis.fromEnv();
const { PICKERS_SYMBOLS_KEY } = await import("../lib/server/pickersBuilder.ts");
const S = await import("../lib/server/pickersSecFundamentals.ts");
const { readPricePoolBulk } = await import("../lib/server/pricePool.ts");
const { resolveProfileBulk } = await import("../lib/server/staticProfile.ts");
const { getCompanyNameMap } = await import("../lib/server/companyNames.ts");
const { gridCompanyName } = await import("../lib/server/secTickerNames.ts");
const { toDotted } = await import("../lib/symbolSpellings.mjs");
const { CELL_WHY_COLUMNS } = await import("../lib/pickerCellWhy.ts");

const raw = await redis.get(PICKERS_SYMBOLS_KEY);
const listed = typeof raw === "string" ? JSON.parse(raw) : raw;
const universe = Array.isArray(listed) ? listed.map((s) => String(s).trim().toUpperCase()).filter(Boolean) : [];
if (!universe.length) { console.error("FATAL: no Pickers symbol list in the store."); process.exit(1); }
console.log(`universe (last build's list): ${universe.length}`);

// ── 1. names ────────────────────────────────────────────────────────────────
const live = await getCompanyNameMap();
console.log(`live directory: ${live.size} names`);
const names = { exact: [], dotted: [], floor: [], none: [] };
for (const s of universe) {
  if (live.get(s)) names.exact.push(s);
  else if (live.get(toDotted(s))) names.dotted.push(s);
  else if (gridCompanyName(s)) names.floor.push(s);
  else names.none.push(s);
}
const list = (a, n = 40) => (a.length ? ` [${a.slice(0, n).join(" ")}${a.length > n ? ` +${a.length - n}` : ""}]` : "");
console.log("\nNAMES (today the page uses the live exact spelling only):");
console.log(`  named by the live directory, exact: ${names.exact.length}`);
console.log(`  named only under the dotted spelling (fixed by the PR): ${names.dotted.length}${list(names.dotted)}`);
console.log(`  named only by the committed floor (fixed by the PR): ${names.floor.length}${list(names.floor)}`);
console.log(`  no name anywhere: ${names.none.length}${list(names.none)}`);
console.log(`  => no name on the page today: ${names.dotted.length + names.floor.length + names.none.length}; after the PR: ${names.none.length}`);

// ── 2. reasons ──────────────────────────────────────────────────────────────
const rows = await S.readSecPickerRows(universe);
const pool = await readPricePoolBulk(universe);
const taxonomy = resolveProfileBulk(universe.map((s) => ({ symbol: s, cached: null })), "why census");
const tally = Object.fromEntries(CELL_WHY_COLUMNS.map((c) => [c, new Map()]));
let withRow = 0, noRow = 0;
for (const s of universe) {
  const row = rows.get(s);
  if (!row) { noRow++; continue; }
  withRow++;
  const p = pool.get(s)?.price;
  const price = typeof p === "number" && Number.isFinite(p) ? p : null;
  const f = S.applySecPickerRow(row, price);
  const e = S.applySecEarnings(row, price);
  const why = S.secPickerWhy(row, price, f, e, taxonomy.get(s)?.industry ?? null);
  for (const [col, code] of Object.entries(why)) {
    const m = tally[col];
    if (!m.has(code)) m.set(code, []);
    m.get(code).push(s);
  }
}
console.log(`\nREASONS (rows with a filings row: ${withRow}; without one: ${noRow}, which keep their stored values)`);
for (const col of CELL_WHY_COLUMNS) {
  const m = tally[col];
  const total = [...m.values()].reduce((a, v) => a + v.length, 0);
  const parts = [...m.entries()].sort((a, b) => b[1].length - a[1].length).map(([c, v]) => `${c} ${v.length}${v.length <= 6 ? ` (${v.join(" ")})` : ""}`);
  console.log(`  ${col}: ${total} empty${parts.length ? ` — ${parts.join(", ")}` : ""}`);
}
console.log(`\nRedis commands: ${meter.commands} (read-only, ${meter.refused} refused)`);
process.exit(meter.refused ? 1 : 0);
