// BEFORE / AFTER FOR #552 COWORK #245 (per-class EPS, filed-split proof, split-aware gate). Reads only.
//   relay task: write-earnings-pr3-before-after
//
// BEFORE: main's extractor (git archive FETCH_HEAD), its split adjustment.
// AFTER:  this checkout's extractor + withClassEps (live 10-Qs) + its split
//         adjustment (now also proven by the filer's own split facts).
// Compared per symbol on what the page prints for EPS: every quarter's and
// year's diluted/basic EPS after split adjustment, plus every other cell of
// the extraction (any non-EPS change is a defect of this PR).
// Read: SYMBOLS (the gated 13 + controls) and every stored set with a blank
// quarterly EPS beside net income, or with a computed EPS cell.
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Redis } from "@upstash/redis";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const ROOT = process.cwd();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; earnings pr3 before-after)";
const keyOf = (f, n) => (fs.readFileSync(f, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
// SHARD:i/n reads the named set (shard 0 only) and every n-th candidate from i.
const SHARD = (process.env.SYMBOLS || "").match(/^SHARD:(\d+)\/(\d+)$/);
const NAMED = (SHARD ? (SHARD[1] === "0" ? "CVNA,GSHD,AIG,AMBP,BB,BCE,BULL,IMTX,MAIN,MKL,PENG,QNME,TRLV,AAPL,MSFT,AMZN" : "") : (process.env.SYMBOLS || "CVNA,GSHD,AIG,AMBP,BB,BCE,BULL,IMTX,MAIN,MKL,PENG,QNME,TRLV,AAPL,MSFT,AMZN")).split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

execSync("git fetch --depth=1 origin main", { stdio: "ignore" });
fs.rmSync(".before", { recursive: true, force: true }); fs.mkdirSync(".before");
execSync("git archive FETCH_HEAD lib | tar -x -C .before");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const SAB = await imp(".before/lib/server/secSplitAdjust.ts");
const SAA = await imp("lib/server/secSplitAdjust.ts");
const CE = await imp("lib/server/secClassEps.ts");
const CODEC = await imp("lib/server/secFactCodec.ts");
const build = (read) => {
  const cur = read("lib/server/secCurrency.ts").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
  const ex = read("lib/server/secExtract.ts").replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "").replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
  return lift(`${read("lib/server/secFields.ts")}\n${read("lib/server/fxRates.ts")}\n${cur}\n${ex}`);
};
const XB = await build((p) => fs.readFileSync(path.join(".before", p), "utf8"));
const XA = await build((p) => fs.readFileSync(p, "utf8"));
const K = XA.SEC_FIELD_KEYS;
const EPS = new Set(["epsDiluted", "epsBasic"]);

const PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const manifest = await redis.get(keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"));
let cmds = 1;
const symbols = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();
const cand = new Set(NAMED);
const IX = (k) => K.indexOf(k);
for (let i = 0; i < symbols.length; i += 50) {
  const batch = symbols.slice(i, i + 50);
  const sets = await redis.mget(...batch.map((s) => `${PREFIX}:${s}`)); cmds++;
  sets.forEach((set, j) => {
    if (!set?.quarters) return;
    const qs = [...set.quarters].sort((a, b) => b.e.localeCompare(a.e)).slice(0, 8);
    if (qs.some((p) => p.v[IX("netIncome")] != null && (p.v[IX("epsDiluted")] == null || p.v[IX("epsBasic")] == null)) || [...set.quarters, ...set.years].some((p) => p.d[IX("epsDiluted")] === "C")) cand.add(batch[j]);
  });
}
if (SHARD) { const [i, n] = [Number(SHARD[1]), Number(SHARD[2])]; const all = [...cand].filter((s) => !NAMED.includes(s)).sort(); cand.clear(); NAMED.forEach((s) => cand.add(s)); all.forEach((s, j) => { if (j % n === i) cand.add(s); }); }
console.log(`${symbols.length} manifest symbols · reading ${cand.size}${SHARD ? ` (shard ${SHARD[1]}/${SHARD[2]})` : ""}\n`);

let lastAt = 0;
const gated = async (url) => {
  for (let a = 0; a < 3; a++) {
    const wait = Math.max(0, lastAt + 130 - Date.now()); if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    try { const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(30000) }); if (res.ok || res.status === 404) return res; } catch {}
    await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
  }
  return new Response("{}", { status: 599 });
};
const fmt = (v) => (v == null ? "—" : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : Number(Number(v).toFixed(4)).toString());
/** What the page prints for EPS: the stored-shape set, split-adjusted. */
const printed = (SA, r, withSsf) => {
  const set = { quarters: r.quarters.map(CODEC.encodePeriod), years: r.years.map(CODEC.encodePeriod), instants: [], asr: r.shareRestated, ...(withSsf && r.splitFacts ? { ssf: r.splitFacts } : {}) };
  const f = SA.splitFactors(set);
  const out = new Map();
  for (const [kind, list] of [["q", set.quarters], ["y", set.years]]) for (const p of list) for (const k of EPS) {
    const v = p.v[IX(k)];
    out.set(`${kind}${p.e} ${k}`, v == null ? null : v / (f.get(p.e) ?? 1));
  }
  return { out, factors: f };
};
const totals = { fill: new Set(), removal: new Set(), change: new Set(), nonEps: new Set(), classFilled: new Set(), splitMoved: new Set() };
const lines = [];
let failed = 0;
for (const sym of cand) {
  const cik = manifest.symbols[sym]?.cik;
  if (!cik) continue;
  const res = await gated(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`);
  if (!res.ok) { failed++; continue; }
  const facts = await res.json();
  let b, a;
  try { b = XB.extractCompanyFacts(sym, facts); a = XA.extractCompanyFacts(sym, facts); } catch (e) { failed++; console.log(`ERROR ${sym} ${e.message}`); continue; }
  // non-EPS cells must not move
  for (const kind of ["quarters", "years"]) {
    const bm = new Map(b[kind].map((p) => [p.end, p]));
    for (const p of a[kind]) { const q = bm.get(p.end); if (!q) { totals.nonEps.add(sym); continue; }
      K.forEach((k, i) => { if (EPS.has(k)) return; const x = q.values[i]?.val ?? null, y = p.values[i]?.val ?? null; if (x !== y && !(x != null && y != null && Math.abs(x - y) <= 1e-9 * Math.abs(x))) { totals.nonEps.add(sym); console.log(`NONEPS ${sym} ${kind[0]}${p.end} ${k} ${fmt(x)}->${fmt(y)}`); } }); }
  }
  const n = await CE.withClassEps(sym, String(cik), a, gated);
  if (n) totals.classFilled.add(sym);
  const pb = printed(SAB, b, false), pa = printed(SAA, a, true);
  if (pa.factors.size !== pb.factors.size || [...pa.factors].some(([e, f]) => pb.factors.get(e) !== f)) totals.splitMoved.add(sym);
  const diffs = [];
  for (const key of new Set([...pb.out.keys(), ...pa.out.keys()])) {
    const x = pb.out.get(key) ?? null, y = pa.out.get(key) ?? null;
    if (x === y || (x != null && y != null && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x)))) continue;
    diffs.push({ key, x, y, type: x == null ? "fill" : y == null ? "removal" : "change" });
  }
  for (const t of ["fill", "removal", "change"]) if (diffs.some((d) => d.type === t)) totals[t].add(sym);
  if (NAMED.includes(sym) || diffs.some((d) => d.type !== "fill")) {
    console.log(`${NAMED.includes(sym) ? "NAMED" : "MOVED"} ${sym} class+${n} factors ${JSON.stringify([...pa.factors])} · ${diffs.length} EPS cells: ${diffs.slice(0, 10).map((d) => `${d.key} ${fmt(d.x)}->${fmt(d.y)}`).join("; ")}${diffs.length > 10 ? " …" : ""}`);
  }
}
console.log(`== summary · read ${cand.size - failed} · failed ${failed}`);
for (const [k, s] of Object.entries(totals)) console.log(`TYPE ${k} ${s.size}: ${[...s].sort().join(" ")}`);
console.log("");
lines.forEach((l) => console.log(l));
fs.rmSync(".before", { recursive: true, force: true });
console.log(`\nRedis commands: ${cmds}`);
