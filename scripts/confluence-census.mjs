// THE CONFLUENCE LADDER, MEASURED BEFORE IT IS BUILT (#563 COWORK #83 §4).
//
// Over the Pickers universe, on the Tiingo daily bars the stock page draws
// (msh:tiingo:eod:v2), runs lib/ta/confluence.ts as the page would (out of
// session: the last completed session) for each band k and swing N:
//   - the median number of independent levels within ±10% of the price
//   - the share of stocks with ≥1 zone above and ≥1 below
//   - how often round numbers and projections would be a zone's only members
//     (the rule drops those; this is how many it drops)
// plus the median zone width, members per zone, and projections omitted.
//
// MA50 and MA200 are the page's (simple averages of the closes); the macro
// support zone is the page's own computeMacroSupport, lifted from
// StockSymbolPageClient.tsx, not re-derived.
//
// READ-ONLY, ENFORCED: any Upstash command outside READ_VERBS is refused
// before it is sent. PUBLIC LOG (#553): counts, percentages and parameters
// only. No price, bar or other Tiingo value is printed.
//
//   node scripts/confluence-census.mjs      (relay: write-confluence-census)
import fs from "node:fs";
import { register } from "node:module";
import ts from "typescript";
import { grabFunction } from "./lib/earnings-plan.mjs";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

// FIXTURE=1: synthetic bars, no Redis (a local dry run of everything but the read).
const FIXTURE = process.env.FIXTURE === "1";
if (!FIXTURE && (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)) {
  console.error("FATAL: needs the Upstash credentials (write- relay job).");
  process.exit(2);
}
const READ_VERBS = new Set(["GET", "MGET"]);
const UPSTASH = (process.env.UPSTASH_REDIS_REST_URL ?? "https://fixture.invalid").replace(/\/$/, "");
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

const redis = FIXTURE ? null : (await import("@upstash/redis")).Redis.fromEnv();
const C = await import("../lib/ta/confluence.ts");
const { tiingoEodKey } = await import("../lib/server/marketData/keys.ts");
const { eodBarsToPoints } = await import("../lib/server/marketData/pickerHistory.ts");
const { PICKERS_SYMBOLS_KEY } = await import("../lib/server/pickersBuilder.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");

// The page's macro support, lifted.
const page = fs.readFileSync("app/stock/[symbol]/StockSymbolPageClient.tsx", "utf8");
const lifted = ["avg", "aggregateWeekly", "computeMacroSupport"].map((n) => grabFunction(page, n)).join("\n") + "\nexport { computeMacroSupport };\n";
const tmp = `scripts/.confluence-census-${process.pid}.mjs`;
fs.writeFileSync(tmp, ts.transpileModule(lifted, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
let computeMacroSupport;
try { ({ computeMacroSupport } = await import(`${process.cwd()}/${tmp}`)); } finally { fs.rmSync(tmp, { force: true }); }

const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
function fixtureBars(seed) {
  const out = [];
  for (let t = Date.parse("2024-10-01T00:00:00Z"), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const b = (20 + seed * 7) * (1 + 0.2 * Math.sin(i / (11 + seed)) + 0.07 * Math.sin(i / 4.1) + i * 0.0004);
    out.push([d.toISOString().slice(0, 10), b, b * 1.015, b * 0.985, b * 1.004, 1e6]);
    i++;
  }
  return { bars: out };
}
const listed = FIXTURE ? ["F1", "F2", "F3", "F4", "F5"] : parse(await redis.get(PICKERS_SYMBOLS_KEY));
const universe = Array.isArray(listed) ? listed.map((s) => String(s).trim().toUpperCase()).filter(Boolean) : [];
if (!universe.length) { console.error("FATAL: no Pickers symbol list."); process.exit(1); }
const raw = [];
if (FIXTURE) universe.forEach((_, i) => raw.push(fixtureBars(i + 1)));
else for (let i = 0; i < universe.length; i += 25) raw.push(...(await redis.mget(...universe.slice(i, i + 25).map((s) => tiingoEodKey(toDashed(s))))));

const sma = (v, n) => (v.length >= n ? v.slice(-n).reduce((s, x) => s + x, 0) / n : null);
const median = (v) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (n, d) => (d ? `${(n / d * 100).toFixed(1)}%` : "—");

const stocks = [];
universe.forEach((s, i) => {
  const e = parse(raw[i]);
  const bars = e && Array.isArray(e.bars) ? eodBarsToPoints(e.bars) : [];
  if (bars.length >= 60) stocks.push({ s, bars });
});
console.log(`universe ${universe.length} · with ≥60 daily bars ${stocks.length} · Redis commands ${commands}`);

const prep = stocks.map(({ s, bars }) => {
  const closes = bars.map((b) => b.close);
  const m = computeMacroSupport(bars, closes[closes.length - 1]);
  return { s, inp: { bars, ma50: sma(closes, 50), ma200: sma(closes, 200), macro: m ? { lower: m.lower, upper: m.upper } : null } };
});

for (const swingN of [3, 5]) {
  for (const k of [0.25, 0.35, 0.5]) {
    let both = 0, any = 0, inside = 0, wouldAlone = 0, wouldZones = 0, shownZones = 0, withProj = 0, withRound = 0, noAtr = 0;
    const within10 = [], widths = [], members = [], omittedN = [];
    for (const { inp } of prep) {
      const c = C.confluence({ ...inp, swingN }, { k });
      if (c.atr === null) { noAtr++; continue; }
      const price = c.price;
      within10.push(c.levels.filter((m) => m.tier !== "round" && Math.abs(m.value - price) / price <= 0.10).length);
      omittedN.push(c.omitted.length);
      // Would-be zones without the not-alone rule: clusters of ≥2 among the levels in the window, round numbers added.
      const win = c.levels.filter((m) => Math.abs(m.value - price) / price * 100 <= C.WINDOW_PCT);
      // Every round number in the window as a member of its own, as if they could stand alone.
      const step = C.roundStep(price), w = price * C.WINDOW_PCT / 100;
      for (let r = Math.ceil((price - w) / step) * step; r <= price + w; r += step) if (r > 0) win.push({ labels: ["round"], value: r, tier: "round", date: null, rank: 3 });
      win.sort((x, y) => x.value - y.value);
      for (const cl of C.bandMerge(win, c.band)) {
        if (cl.length < C.ZONE_MIN) continue;
        wouldZones++;
        if (!cl.some((m) => m.tier === "structural")) wouldAlone++;
      }
      if (c.above.length && c.below.length) both++;
      if (c.above.length || c.below.length || c.inside) any++;
      if (c.inside) inside++;
      for (const z of [...c.above, ...c.below, ...(c.inside ? [c.inside] : [])]) {
        shownZones++;
        widths.push((z.hi - z.lo) / price * 100);
        members.push(z.count);
        if (z.members.some((m) => m.tier === "projection")) withProj++;
        if (z.members.some((m) => m.tier === "round")) withRound++;
      }
    }
    const n = prep.length - noAtr;
    console.log(`\nswing N=${swingN} · k=${k} × ATR(14) · stocks measured ${n} (no ATR ${noAtr})`);
    console.log(`  independent levels within ±10% of the price: median ${median(within10)}, p25 ${median(within10.filter((x) => x <= median(within10)))}, p75 ${median(within10.filter((x) => x >= median(within10)))}`);
    console.log(`  ≥1 zone above and ≥1 below: ${pct(both, n)} · any zone shown: ${pct(any, n)} · price inside a zone: ${pct(inside, n)}`);
    console.log(`  would-be zones made only of round numbers / projections (dropped by the rule): ${wouldAlone} of ${wouldZones} (${pct(wouldAlone, wouldZones)})`);
    console.log(`  shown zones ${shownZones} · median width ${median(widths)?.toFixed(2)}% of price · median members ${median(members)} · with a projection ${pct(withProj, shownZones)} · with a round number ${pct(withRound, shownZones)}`);
    console.log(`  projections omitted per stock (unreachable or >${C.MAX_PROJECTION_PCT}%): median ${median(omittedN)}`);
  }
}
