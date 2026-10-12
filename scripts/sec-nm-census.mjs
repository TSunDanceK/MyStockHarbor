// "NOT MEANINGFUL" GROWTH AND MARGINS ON A TINY BASE (#552 COWORK #212 §1). READ-ONLY.
// JOBY's Q2 read "+257,493% revenue" and "operating margin ▲1,118,418 pt";
// ACHR "operating margin −5,584%". Over every stored set, through the SHIPPED
// buildSecEarningsView (the numbers the four surfaces print), the latest
// period's:
//   A  year-ago revenue under $1M (positive)
//   B  |revenue growth y/y| over 1,000%
//   C  current revenue under $1M (positive)
//   D  any margin (gross / operating / net) beyond ±1,000%
//   E  a margin's y/y move (gross or operating) beyond ±100 pt
// and the overlaps, so a threshold can be chosen from the data.
// Store: SCAN + MGET only. No SEC requests.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);
const READS = new Set(["scan", "mget"]);
const counts = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (process.env.UPSTASH_REDIS_REST_URL && url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const body = JSON.parse(init.body ?? "null");
    for (const c of Array.isArray(body?.[0]) ? body : [body]) {
      const op = String(c?.[0]).toLowerCase();
      if (!READS.has(op)) throw new Error(`read guard: ${op} refused`);
      counts[op] = (counts[op] ?? 0) + 1;
    }
  } else if (!url.startsWith("data:")) throw new Error("read guard: only the store may be reached");
  return realFetch(input, init);
};
const { buildSecEarningsView, isPct } = await import("../lib/server/secEarningsView.ts");
const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
if (!FACTS) { console.error("FATAL: the facts prefix moved"); process.exit(2); }
const CUT = new Set(JSON.parse(fs.readFileSync("data/due-strip.json", "utf8")).symbols);
const redis = Redis.fromEnv();
const keys = [];
let cursor = "0";
do { const [next, batch] = await redis.scan(cursor, { match: `${FACTS}:*`, count: 1000 }); cursor = String(next); keys.push(...batch); } while (cursor !== "0");

const M = (v) => (typeof v !== "number" ? "—" : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}k`);
const P = (v) => (typeof v === "number" ? `${v.toFixed(1)}%` : String(v));
const rows = [];
let sets = 0, views = 0, errors = 0;
for (let i = 0; i < keys.length; i += 20) {
  const chunk = keys.slice(i, i + 20);
  const raw = await redis.mget(...chunk);
  chunk.forEach((k, j) => {
    const set = raw[j];
    if (!set?.quarters && !set?.years) return;
    sets++;
    const sym = k.slice(FACTS.length + 1);
    let view;
    try { view = buildSecEarningsView(set); } catch { errors++; return; }
    if (!view) return;
    views++;
    const s = view.snapshot;
    const rev = s.revenue?.val ?? null;
    const yoyR = s.revenueYoY;
    const base = isPct(yoyR) && typeof rev === "number" ? rev / (1 + yoyR / 100) : null;
    const m = view.margins.at(-1) ?? null;
    const ya = m ? view.margins.find((r) => r.label === s.comparedWith && !r.marginsRefused) ?? null : null;
    const gPts = m && ya && typeof m.gross === "number" && typeof ya.gross === "number" ? m.gross - ya.gross : null;
    const oPts = m && ya && typeof m.operating === "number" && typeof ya.operating === "number" ? m.operating - ya.operating : null;
    const margins = m ? [m.gross, m.operating, m.net].filter((x) => typeof x === "number") : [];
    const f = {
      A: typeof base === "number" && base > 0 && base < 1e6,
      B: isPct(yoyR) && Math.abs(yoyR) > 1000,
      C: typeof rev === "number" && rev > 0 && rev < 1e6,
      D: margins.some((x) => Math.abs(x) > 1000),
      E: [gPts, oPts].some((x) => typeof x === "number" && Math.abs(x) > 100),
    };
    if (!Object.values(f).some(Boolean)) return;
    rows.push({ sym, cut: CUT.has(sym), label: view.latestLabel, basis: view.basis, rev, base, yoyR, m, gPts, oPts, f });
  });
}
const has = (r, ks) => ks.every((k) => r.f[k]);
console.log(`stored sets ${sets} · views built ${views} · view errors ${errors}`);
console.log(`flagged on any condition: ${rows.length}`);
for (const k of "ABCDE") console.log(`  ${k}: ${rows.filter((r) => r.f[k]).length}`);
console.log(`overlaps: B without A (growth >1,000% on a base ≥ $1M): ${rows.filter((r) => r.f.B && !r.f.A).length} · D without C (margin beyond ±1,000% on revenue ≥ $1M): ${rows.filter((r) => r.f.D && !r.f.C).length} · E with neither margin beyond ±1,000% nor a sub-$1M revenue either year: ${rows.filter((r) => r.f.E && !r.f.D && !r.f.C && !r.f.A).length}`);
console.log(`\nEVERY FLAGGED NAME (sym* = top-200 cut): period · revenue (year-ago) · growth · gross/op/net · gross pt / op pt · flags`);
for (const r of rows.sort((a, b) => (a.sym < b.sym ? -1 : 1))) {
  const mm = r.m ? `${P(r.m.gross)}/${P(r.m.operating)}/${P(r.m.net)}${r.m.marginsRefused ? " (refused)" : ""}` : "—";
  console.log(`  ${r.sym}${r.cut ? "*" : ""} ${r.label}${r.basis === "year" ? " (annual)" : ""} · ${M(r.rev)} (${M(r.base)}) · ${P(r.yoyR)} · ${mm} · ${r.gPts == null ? "—" : r.gPts.toFixed(1)}/${r.oPts == null ? "—" : r.oPts.toFixed(1)} · ${Object.keys(r.f).filter((k) => r.f[k]).join("")}`);
}
for (const s of ["JOBY", "ACHR", "KO", "TSLA", "JPM"]) if (!rows.some((r) => r.sym === s)) console.log(`  (${s}: not flagged)`);
console.log(`\nStore commands: ${JSON.stringify(counts)}`);
