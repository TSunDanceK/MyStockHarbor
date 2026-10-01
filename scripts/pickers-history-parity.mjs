// PICKERS' SIGNALS, FMP HISTORY VS TIINGO HISTORY (#553 step 2, COWORK #71:
// "signals before and after, on the full universe, changed flags per screen").
//
// Runs the REAL build (buildPickersPayloadDryRun) twice over the same universe:
// once on the FMP bars in msh:history:v7, once on the Tiingo bars in
// msh:tiingo:eod:v2. Everything else the build reads (market state, dynamic
// universe, earnings, fundamentals) is the same live store both times, so the
// differences are the history's.
//
// READ-ONLY, ENFORCED: every Upstash request is inspected before it is sent,
// and any command outside READ_VERBS is refused (the build then fails loudly
// rather than writing). FMP is never called: FMP_API_KEY is removed from this
// process, and the build is handed its history rather than fetching it.
//
// PUBLIC LOG (#553): counts, symbols and flag names only. No price, bar or
// other Tiingo value is printed.
//
//   node scripts/pickers-history-parity.mjs
import { register } from "node:module";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

delete process.env.FMP_API_KEY;
delete process.env.PRICE_PROVIDER_PICKERS;

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error("FATAL: needs the Upstash credentials (write- relay job).");
  process.exit(2);
}

// ── the read-only gate and the command meter ────────────────────────────────
const READ_VERBS = new Set([
  "GET", "MGET", "HGET", "HMGET", "HGETALL", "HKEYS", "HLEN", "HEXISTS", "SMEMBERS", "SISMEMBER", "SCARD",
  "ZRANGE", "ZREVRANGE", "ZRANGEBYSCORE", "ZREVRANGEBYSCORE", "ZSCORE", "ZCARD", "EXISTS", "TTL", "PTTL", "STRLEN", "TYPE", "LRANGE", "LLEN",
]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
const meter = { commands: 0, refused: new Map() };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    for (const c of cmds) {
      const verb = String(c?.[0] ?? "").toUpperCase();
      if (!READ_VERBS.has(verb)) {
        meter.refused.set(verb, (meter.refused.get(verb) ?? 0) + 1);
        throw new Error(`parity is read-only: refused ${verb}`);
      }
    }
    meter.commands += cmds.length || 1;
  }
  return realFetch(input, init);
};

const { Redis } = await import("@upstash/redis");
const redis = Redis.fromEnv();
const { buildPickersPayloadDryRun, PICKERS_SYMBOLS_KEY } = await import("../lib/server/pickersBuilder.ts");
const { tiingoEodKey } = await import("../lib/server/marketData/keys.ts");
const { eodBarsToPoints } = await import("../lib/server/marketData/pickerHistory.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");

const MGET_CHUNK = 25;
async function mgetAll(keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += MGET_CHUNK) out.push(...(await redis.mget(...keys.slice(i, i + MGET_CHUNK))));
  return out;
}
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

// ── the universe: the last build's own symbol list ──────────────────────────
const listed = parse(await redis.get(PICKERS_SYMBOLS_KEY));
const universe = Array.isArray(listed) ? listed.map((s) => String(s).trim().toUpperCase()).filter(Boolean) : [];
if (!universe.length) {
  console.error("FATAL: no Pickers symbol list in the store; nothing to compare.");
  process.exit(1);
}

// ── both histories, read once ───────────────────────────────────────────────
const fmpRaw = await mgetAll(universe.map((s) => `msh:history:v7:${s}`));
const fmp = new Map();
universe.forEach((s, i) => {
  const e = parse(fmpRaw[i]);
  if (e && e.symbol === s && e.source === "fmp" && e.status === "qualified" && Array.isArray(e.daily) && e.daily.length) fmp.set(s, e.daily);
});
const tiRaw = await mgetAll(universe.map((s) => tiingoEodKey(toDashed(s))));
const tiingo = new Map();
universe.forEach((s, i) => {
  const e = parse(tiRaw[i]);
  const pts = e && Array.isArray(e.bars) ? eodBarsToPoints(e.bars) : [];
  if (pts.length) tiingo.set(s, pts);
});
const lastDates = (m) => {
  const c = new Map();
  for (const pts of m.values()) { const d = pts[pts.length - 1]?.date?.slice(0, 10); c.set(d, (c.get(d) ?? 0) + 1); }
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d, n]) => `${d} ×${n}`).join(", ");
};
console.log(`universe (last build's list): ${universe.length}`);
console.log(`history present — FMP: ${fmp.size}, Tiingo: ${tiingo.size}; in FMP only: ${[...fmp.keys()].filter((s) => !tiingo.has(s)).length}, in Tiingo only: ${[...tiingo.keys()].filter((s) => !fmp.has(s)).length}`);
console.log(`newest bar — FMP: ${lastDates(fmp)} | Tiingo: ${lastDates(tiingo)}`);
const missingT = universe.filter((s) => !tiingo.has(s));
if (missingT.length) console.log(`no Tiingo history (${missingT.length}): ${missingT.slice(0, 30).join(", ")}`);

// FMP CUT TO TIINGO'S SPAN. The stored Tiingo series may be shorter than FMP's
// (until 30 Sep the nightly window was 1,400 calendar days, ~960 bars, against
// FMP's 1,400 bars). Cutting FMP to start where each symbol's Tiingo series
// starts splits the difference in two: FMP full vs FMP cut is the LENGTH
// effect, FMP cut vs Tiingo is the PROVIDER effect.
const fmpCut = new Map();
for (const [s, pts] of fmp) {
  const first = tiingo.get(s)?.[0]?.date;
  fmpCut.set(s, first ? pts.filter((p) => String(p.date) >= first) : pts);
}
// SAME LAST DATE TOO. The nightly Tiingo job lands the session that FMP's 07:02
// refresh only picks up the next morning, so between 00:45 and 07:02 UTC Tiingo
// is one bar ahead. Comparing different days measures the day, not the
// provider: (b) compares FMP cut against Tiingo cut to the same last date.
const tiingoCut = new Map();
for (const [s, pts] of tiingo) {
  const last = fmp.get(s)?.at(-1)?.date;
  tiingoCut.set(s, last ? pts.filter((p) => String(p.date) <= String(last)) : pts);
}
const barsMedian = (m) => { const n = [...m.values()].map((p) => p.length).sort((a, b) => a - b); return n.length ? n[Math.floor(n.length / 2)] : 0; };
console.log(`bars per symbol (median) — FMP: ${barsMedian(fmp)}, FMP cut: ${barsMedian(fmpCut)}, Tiingo: ${barsMedian(tiingo)}`);

// ── three builds ────────────────────────────────────────────────────────────
const builds = {};
for (const [name, hist] of [["FMP", fmp], ["FMP cut", fmpCut], ["Tiingo", tiingo], ["Tiingo cut", tiingoCut]]) {
  const t = Date.now();
  builds[name] = await buildPickersPayloadDryRun(hist);
  console.log(`build ${name}: universe ${builds[name].universeSize}, failed ${builds[name].degradedSymbolCount ?? 0} (${Date.now() - t} ms)`);
}

const LIST = 12;
const fmt = (arr) => (arr.length ? ` [${arr.slice(0, LIST).join(" ")}${arr.length > LIST ? ` +${arr.length - LIST}` : ""}]` : "");
function compare(label, before, after) {
  console.log(`\n==== ${label} ====`);
  console.log("SECTIONS (members shown on the page): before → after, joined, left");
  const secB = new Map(before.sections.map((s) => [s.title, s]));
  const secA = new Map(after.sections.map((s) => [s.title, s]));
  let sectionsChanged = 0;
  for (const title of new Set([...secB.keys(), ...secA.keys()])) {
    const b = new Set((secB.get(title)?.items ?? []).map((i) => i.symbol));
    const a = new Set((secA.get(title)?.items ?? []).map((i) => i.symbol));
    const joined = [...a].filter((s) => !b.has(s));
    const left = [...b].filter((s) => !a.has(s));
    if (joined.length || left.length) sectionsChanged++;
    const fb = secB.get(title)?.foundCount, fa = secA.get(title)?.foundCount;
    console.log(`  ${title}: ${b.size} → ${a.size}${fb != null || fa != null ? ` (found ${fb ?? "–"} → ${fa ?? "–"})` : ""}; +${joined.length}${fmt(joined)} −${left.length}${fmt(left)}`);
  }
  console.log("FLAGS (signal records, whole universe): true before → after; turned on / turned off");
  const recB = new Map(before.signalRecords.map((r) => [r.symbol, r]));
  const recA = new Map(after.signalRecords.map((r) => [r.symbol, r]));
  const flags = new Set();
  for (const r of [...recB.values(), ...recA.values()]) for (const [k, v] of Object.entries(r)) if (typeof v === "boolean") flags.add(k);
  let flagChanges = 0;
  for (const f of [...flags].sort()) {
    let tb = 0, ta = 0;
    const on = [], off = [];
    for (const s of new Set([...recB.keys(), ...recA.keys()])) {
      const vb = recB.get(s)?.[f] === true, va = recA.get(s)?.[f] === true;
      if (vb) tb++;
      if (va) ta++;
      if (va && !vb) on.push(s);
      if (vb && !va) off.push(s);
    }
    flagChanges += on.length + off.length;
    if (on.length || off.length) console.log(`  ${f}: ${tb} → ${ta}; on ${on.length}${fmt(on)} off ${off.length}${fmt(off)}`);
  }
  const onlyB = [...recB.keys()].filter((s) => !recA.has(s));
  const onlyA = [...recA.keys()].filter((s) => !recB.has(s));
  console.log(`records: ${recB.size} → ${recA.size}; only before ${onlyB.length}${fmt(onlyB)}; only after ${onlyA.length}${fmt(onlyA)}`);
  console.log(`summary: ${sectionsChanged} section(s) changed; ${flagChanges} flag change(s) (unchanged flags not listed)`);
}
compare("(a) LENGTH: FMP full → FMP cut to Tiingo's span", builds["FMP"], builds["FMP cut"]);
compare("(b) PROVIDER: FMP cut → Tiingo cut, same first AND last date", builds["FMP cut"], builds["Tiingo cut"]);
compare("(c) OVERALL: FMP full → Tiingo as stored", builds["FMP"], builds["Tiingo"]);
console.log(`Redis commands: ${meter.commands} (read-only${meter.refused.size ? `; REFUSED ${JSON.stringify(Object.fromEntries(meter.refused))}` : ", 0 refused"})`);
process.exit(meter.refused.size ? 1 : 0);
