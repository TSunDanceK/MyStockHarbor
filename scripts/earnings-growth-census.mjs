// STRONG EARNINGS GROWTH, IN DETAIL (#553 COWORK #178, with #169). READ-ONLY,
// ENFORCED (GET, HMGET).
//
// For every pickers universe symbol: its picker SEC row, and the LIVE rule
// (secStrongEarningsGrowth). Reports the members' EPS-growth distribution, the
// top of the list in the section's order (EPS growth, highest first, #786),
// counts under stricter cuts, the basis mix (quarter / year), and how many
// rows the "profit in both periods" floor already keeps out: from a loss, and
// from a tiny base (prior EPS between the floor and $0.10).
//
// PUBLIC LOG (#553): symbols, counts, and DERIVED percentages only. Never an
// EPS, a revenue figure or a price.
//
//   node scripts/earnings-growth-census.mjs   (relay: write-earnings-growth-census)
import { register } from "node:module";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET", "HMGET"]);
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
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const { readSecPickerRows, moneyIsUsd } = await import("../lib/server/pickersSecFundamentals.ts");
const { secStrongEarningsGrowth, SEC_GROWTH_MIN_EPS_YOY } = await import("../lib/server/pickersSecEarningsGrowth.ts");
const { PE_MIN_EPS } = await import("../lib/server/secValuation.ts");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

const listed = parse(await redis.get("msh:pickers:v10:symbols"));
const universe = Array.isArray(listed) ? listed.map((s) => String(s).trim().toUpperCase()).filter(Boolean) : [];
const rows = new Map();
for (let i = 0; i < universe.length; i += 100) {
  const got = await readSecPickerRows(universe.slice(i, i + 100));
  for (const [k, v] of got) rows.set(k, v);
}
const pct = (now, then) => ((now - then) / Math.abs(then)) * 100;
const members = [];
const refusals = new Map();
let fromLoss = 0, tinyBase = 0, revDown = 0, belowCut = 0, okFacts = 0;
const lossEx = [], tinyEx = [];
for (const sym of universe) {
  const row = rows.get(sym);
  if (!row) { refusals.set("no row", (refusals.get("no row") ?? 0) + 1); continue; }
  const g = row.growth;
  if (!g) { refusals.set("no growth field", (refusals.get("no growth field") ?? 0) + 1); continue; }
  if (!g.ok) { refusals.set(g.why, (refusals.get(g.why) ?? 0) + 1); continue; }
  okFacts++;
  const c = secStrongEarningsGrowth(row, moneyIsUsd(row.unit));
  if (c) { members.push({ sym, eps: c.epsGrowthPct, rev: c.revenueGrowthPct, basis: g.basis, tinyPrior: g.epsPrior < 0.10 }); continue; }
  // Why a row with facts is out:
  if (!(g.epsPrior >= PE_MIN_EPS) || !(g.eps >= PE_MIN_EPS)) {
    if (g.epsPrior < 0 || g.eps < 0) { fromLoss++; if (lossEx.length < 3 && g.eps > 0 && g.epsPrior < 0) lossEx.push(sym); }
    else { tinyBase++; if (tinyEx.length < 3) tinyEx.push(sym); }
  } else if (!(g.revenue > g.revenuePrior)) revDown++;
  else belowCut++;
}
members.sort((a, b) => b.eps - a.eps || a.sym.localeCompare(b.sym));
const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * (xs.length - 1)))];
const eps = members.map((m) => m.eps).sort((a, b) => a - b);
console.log(`universe ${universe.length} · SEC rows ${rows.size} · growth facts ok ${okFacts} · members ${members.length} (rule: diluted EPS >= +${SEC_GROWTH_MIN_EPS_YOY}%, EPS >= ${PE_MIN_EPS} in both periods, revenue up)`);
console.log(`members' EPS growth: p10 ${q(eps, 0.1)?.toFixed(1)}% · median ${q(eps, 0.5)?.toFixed(1)}% · p90 ${q(eps, 0.9)?.toFixed(1)}% · max ${eps[eps.length - 1]?.toFixed(1)}%`);
for (const cut of [20, 25, 30, 50]) console.log(`  at >= +${cut}%: ${members.filter((m) => m.eps >= cut).length}`);
console.log(`  at >= +20% AND revenue >= +5%: ${members.filter((m) => m.eps >= 20 && m.rev >= 5).length}`);
console.log(`basis: quarter ${members.filter((m) => m.basis === "quarter").length}, year ${members.filter((m) => m.basis === "year").length}`);
console.log(`members whose prior EPS is under $0.10 (tiny base, inside the rule): ${members.filter((m) => m.tinyPrior).length}${members.filter((m) => m.tinyPrior).length ? ` — e.g. ${members.filter((m) => m.tinyPrior).slice(0, 3).map((m) => `${m.sym} ${m.eps.toFixed(0)}%`).join(", ")}` : ""}`);
console.log(`\nkept OUT by the rule (rows with facts): from a loss ${fromLoss} (e.g. turned profitable: ${lossEx.join(", ") || "–"}); EPS under the $${PE_MIN_EPS} floor ${tinyBase} (e.g. ${tinyEx.join(", ") || "–"}); revenue not up ${revDown}; EPS growth under +${SEC_GROWTH_MIN_EPS_YOY}% ${belowCut}`);
console.log(`refusals: ${[...refusals].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
console.log(`\ntop 15 in the section's order (EPS growth, highest first): ${members.slice(0, 15).map((m) => `${m.sym} ${m.eps.toFixed(0)}% (${m.basis === "year" ? "FY" : "Q"})`).join(", ")}`);
const pos = (s) => { const i = members.findIndex((m) => m.sym === s); return i < 0 ? "not a member" : `#${i + 1} at ${members[i].eps.toFixed(0)}%`; };
console.log(`named by the owner: TIGO ${pos("TIGO")} · ABBV ${pos("ABBV")} · DELL ${pos("DELL")}`);
console.log(`\nRedis commands ${commands} (read-only: GET, HMGET)`);
