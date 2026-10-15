// BEFORE / AFTER FOR #552 COWORK #241 PR 2: (d) derived Q4 EPS on the earnings
// view, and the bank revenue rule (net interest + noninterest income). Reads only.
//   relay task: write-earnings-pr2-before-after
//
// BEFORE is main (git archive FETCH_HEAD into .before/), AFTER is this checkout.
// PART 1, EXTRACTOR: live companyfacts for the named symbols and every stored
//   set with a quarter carrying net income and no revenue; main's extractor vs
//   this one, every cell of every period: fills, removals, value changes.
// PART 2, VIEW: every stored set through buildSecEarningsView -- main's, vs
//   this one with the page's deriveQ4Eps -- comparing what the page renders:
//   the recent periods, the snapshot, the growth rows, the annual rows and the
//   income statement (value and note per cell).
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Redis } from "@upstash/redis";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const ROOT = process.cwd();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; earnings pr2 before-after)";
const keyOf = (f, n) => (fs.readFileSync(f, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const NAMED = (process.env.SYMBOLS || "AAPL,MSFT,AMZN,COST,CVNA,JPM,BNY,COLB,WSFS,UBSI,AX,FLG,TBBK").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

execSync("git fetch --depth=1 origin main", { stdio: "ignore" });
fs.rmSync(".before", { recursive: true, force: true });
fs.mkdirSync(".before");
execSync("git archive FETCH_HEAD lib | tar -x -C .before");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const VB = await imp(".before/lib/server/secEarningsView.ts");
const VA = await imp("lib/server/secEarningsView.ts");
const { derivedQ4Eps } = await imp("lib/server/secValuation.ts");
const { annualOnlyForm } = await imp("lib/server/annualOnly.ts");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;

const mainSrc = (p) => fs.readFileSync(path.join(".before", p), "utf8");
const build = (read) => {
  const fields = read("lib/server/secFields.ts"), fx = read("lib/server/fxRates.ts");
  const cur = read("lib/server/secCurrency.ts").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
  const ex = read("lib/server/secExtract.ts").replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "").replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
  return lift(`${fields}\n${fx}\n${cur}\n${ex}`);
};
const XB = await build(mainSrc), XA = await build((p) => fs.readFileSync(p, "utf8"));
const K = XA.SEC_FIELD_KEYS;
const IX = Object.fromEntries(["revenue", "netIncome", "epsDiluted"].map((k) => [k, K.indexOf(k)]));

const PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const manifest = await redis.get(keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"));
let cmds = 1;
const symbols = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();
const H = (await lift(fs.readFileSync("lib/server/secFields.ts", "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
  .replace(/export (const|function|type)/g, "$1") + "\nexport { secFieldsHash };", "", "secFields")).secFieldsHash();
const sets = new Map();
for (let i = 0; i < symbols.length; i += 50) {
  const batch = symbols.slice(i, i + 50);
  const got = await redis.mget(...batch.map((s) => `${PREFIX}:${s}`)); cmds++;
  got.forEach((s, j) => { if (s && s.h === H && Array.isArray(s.quarters)) sets.set(batch[j], s); });
}
console.log(`${symbols.length} manifest symbols · ${sets.size} readable sets\n`);

// ── PART 2 first: the view, over every stored set ──
const fmt = (v) => (v == null ? "—" : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : Number(Number(v).toFixed(4)).toString());
const today = new Date().toISOString().slice(0, 10);
const flat = (v) => {
  const out = new Map();
  if (!v) return out;
  const put = (k, c) => { if (c && typeof c === "object" && "val" in c) out.set(k, `${fmt(c.val)}|${c.derivedNote ?? ""}`); else out.set(k, JSON.stringify(c ?? null)); };
  for (const r of v.recentPeriods ?? []) { put(`recent ${r.label} eps`, r.epsDiluted); put(`recent ${r.label} rev`, r.revenue); put(`recent ${r.label} ni`, r.netIncome); }
  const s = v.snapshot ?? {};
  for (const k of ["epsDiluted", "netIncome", "operatingIncome", "revenue"]) put(`snapshot ${k}`, s[k]);
  for (const k of ["epsYoY", "revenueYoY"]) put(`snapshot ${k}`, s[k]);
  for (const g of v.growth ?? []) { put(`growth ${g.label} epsYoY`, g.epsYoY); put(`growth ${g.label} revYoY`, g.revenueYoY); }
  for (const a of v.annual ?? []) { put(`annual ${a.label} eps`, a.epsDiluted); put(`annual ${a.label} rev`, a.revenue); }
  for (const r of v.incomeStatement ?? []) put(`income ${r.key}`, r);
  return out;
};
const viewTypes = { q4fill: new Set(), other: new Set(), noteOnly: new Set() };
const viewLines = [];
let q4Cells = 0, viewErrors = 0;
for (const [sym, set] of sets) {
  const annualForm = annualOnlyForm(REG[sym]?.annualForm, set, today);
  let b, a;
  try { b = VB.buildSecEarningsView(set, { annualForm }); a = VA.buildSecEarningsView(set, { annualForm, deriveQ4Eps: derivedQ4Eps }); }
  catch (e) { viewErrors++; console.log(`VIEWERROR ${sym} ${e.message}`); continue; }
  const fb = flat(b), fa = flat(a);
  const diffs = [];
  for (const k of new Set([...fb.keys(), ...fa.keys()])) if (fb.get(k) !== fa.get(k)) diffs.push([k, fb.get(k), fa.get(k)]);
  if (!diffs.length) { if (NAMED.includes(sym)) console.log(`VIEW ${sym}: unchanged`); continue; }
  const isQ4Fill = ([k, x, y]) => /eps$|epsDiluted$/.test(k) && x?.startsWith("—|") && y?.endsWith("|Derived: fiscal year less Q1–Q3");
  const isNote = ([, x, y]) => x && y && x.split("|")[0] === y.split("|")[0];
  for (const d of diffs) {
    if (isQ4Fill(d)) { viewTypes.q4fill.add(sym); q4Cells++; }
    else if (isNote(d)) { viewTypes.noteOnly.add(sym); viewLines.push(`NOTE ${sym} ${d[0]}: ${d[1]} -> ${d[2]}`); }
    else { viewTypes.other.add(sym); viewLines.push(`OTHER ${sym} ${d[0]}: ${d[1]} -> ${d[2]}`); }
  }
  if (NAMED.includes(sym)) for (const d of diffs) console.log(`VIEW ${sym} ${d[0]}: ${d[1]} -> ${d[2]}`);
}
console.log(`\n== VIEW · ${sets.size} sets · errors ${viewErrors}`);
console.log(`VIEW q4 EPS filled: ${viewTypes.q4fill.size} symbols, ${q4Cells} cells`);
console.log(`VIEW note-only changes: ${viewTypes.noteOnly.size}: ${[...viewTypes.noteOnly].sort().join(" ")}`);
console.log(`VIEW other changes: ${viewTypes.other.size}: ${[...viewTypes.other].sort().join(" ")}`);
viewLines.slice(0, 120).forEach((l) => console.log(l));

// ── PART 1: the extractor's bank rule ──
const cand = new Set(NAMED);
for (const [sym, set] of sets) if ([...set.quarters, ...set.years].some((p) => p.v[IX.revenue] == null && p.v[IX.netIncome] != null)) cand.add(sym);
console.log(`\n== EXTRACT · candidates ${cand.size}`);
let lastAt = 0;
const getJson = async (url) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = Math.max(0, lastAt + 130 - Date.now()); if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    try { const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } }); if (res.ok) return res.json(); if (res.status === 404) return null; } catch {}
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return null;
};
const code = (c) => (c ? ({ "as-filed": "F", differenced: "D", computed: "C", ambiguous: "A", withheld: "W" }[c.derived] ?? "?") : "-");
const totals = { fill: new Set(), removal: new Set(), change: new Set() };
const detail = [], fills = [];
let failed = 0;
for (const sym of cand) {
  const cik = manifest.symbols[sym]?.cik;
  if (!cik) continue;
  const facts = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`);
  if (!facts) { failed++; continue; }
  let b, a;
  try { b = XB.extractCompanyFacts(sym, facts); a = XA.extractCompanyFacts(sym, facts); } catch (e) { failed++; console.log(`ERROR ${sym} ${e.message}`); continue; }
  const diffs = [];
  for (const kind of ["quarters", "years"]) {
    const bm = new Map(b[kind].map((p) => [p.end, p])), am = new Map(a[kind].map((p) => [p.end, p]));
    for (const end of new Set([...bm.keys(), ...am.keys()])) {
      const pb = bm.get(end), pa = am.get(end);
      if (!pb || !pa) { diffs.push({ type: "change", kind, end, field: "(period)", b: pb ? "present" : "absent", a: pa ? "present" : "absent" }); continue; }
      K.forEach((f, i) => {
        const vb = pb.values[i]?.val ?? null, va = pa.values[i]?.val ?? null;
        if (vb === va || (vb != null && va != null && Math.abs(vb - va) <= 1e-9 * Math.max(1, Math.abs(vb)))) return;
        diffs.push({ type: vb == null ? "fill" : va == null ? "removal" : "change", kind, end, field: f, b: `${fmt(vb)}${code(pb.values[i])}`, a: `${fmt(va)}${code(pa.values[i])}` });
      });
    }
  }
  if (NAMED.includes(sym)) {
    const q = [...a.quarters].sort((x, y) => x.end.localeCompare(y.end)).slice(-4);
    console.log(`EXTRACT ${sym} ${diffs.length} cells · newest quarters revenue: ${q.map((p) => `${p.end}=${fmt(p.values[IX.revenue]?.val ?? null)}${code(p.values[IX.revenue])}`).join(" ")}`);
  }
  for (const x of ["fill", "removal", "change"]) if (diffs.some((d) => d.type === x)) totals[x].add(sym);
  for (const d of diffs) if (d.type !== "fill") detail.push(`${d.type.toUpperCase()} ${sym} ${d.kind[0]}${d.end} ${d.field} ${d.b}->${d.a}`);
  const f = diffs.filter((d) => d.type === "fill");
  if (f.length) fills.push(`FILL ${sym} ${f.length} cells (${[...new Set(f.map((d) => d.field))].join(",")}): ${f.slice(0, 3).map((d) => `${d.kind[0]}${d.end}=${d.a}`).join(" ")}`);
}
console.log(`\n== EXTRACT summary · failed ${failed}`);
for (const [x, set] of Object.entries(totals)) console.log(`TYPE ${x} ${set.size}: ${[...set].sort().join(" ")}`);
detail.forEach((l) => console.log(l));
fills.forEach((l) => console.log(l));
fs.rmSync(".before", { recursive: true, force: true });
console.log(`\nRedis commands: ${cmds}`);
