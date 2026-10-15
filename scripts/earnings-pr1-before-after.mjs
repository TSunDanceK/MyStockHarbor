// BEFORE / AFTER FOR #552 COWORK #240 PR 1 (a) EPS ratio gate, (b) last-resort
// bank revenue, (c) 16-week calendar bands. Reads only.
//   relay task: write-earnings-pr1-before-after
//
// BEFORE is main's extractor (git show FETCH_HEAD after a depth-1 fetch), AFTER
// is this checkout's; both run on the same live companyfacts payload.
//
// WHO IS READ: the named symbols (SYMBOLS, default the six COWORK named), then
// every stored set that any of the three changes could move -- a computed EPS
// cell (C), a quarter or year with no revenue, or two stored quarters more than
// 105 days apart. A cell outside those three cannot change: (a) only removes C
// cells, (b) only fills null revenue, (c) only admits frames a gap left out.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { Redis } from "@upstash/redis";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; earnings pr1 before-after)";
const keyOf = (f, n) => (fs.readFileSync(f, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];

execSync("git fetch --depth=1 origin main", { stdio: "ignore" });
const mainSrc = (p) => execSync(`git show FETCH_HEAD:${p}`, { encoding: "utf8", maxBuffer: 64 << 20 });
const build = (read) => {
  const fields = read("lib/server/secFields.ts");
  const fx = read("lib/server/fxRates.ts");
  const cur = read("lib/server/secCurrency.ts").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
  const ex = read("lib/server/secExtract.ts")
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "")
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
  return lift(`${fields}\n${fx}\n${cur}\n${ex}`);
};
const BEFORE = await build(mainSrc);
const AFTER = await build((p) => fs.readFileSync(p, "utf8"));
const K = AFTER.SEC_FIELD_KEYS;
if (JSON.stringify(K) !== JSON.stringify(BEFORE.SEC_FIELD_KEYS)) { console.error("FATAL: field order differs"); process.exit(2); }
const IX = Object.fromEntries(["revenue", "netIncome", "epsDiluted", "epsBasic", "sharesDiluted"].map((k) => [k, K.indexOf(k)]));

const PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const manifest = await redis.get(keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"));
let cmds = 1;
const symbols = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();

// ── candidates from the stored sets ──
const H = (await lift(fs.readFileSync("lib/server/secFields.ts", "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
  .replace(/export (const|function|type)/g, "$1") + "\nexport { secFieldsHash };", "", "secFields")).secFieldsHash();
const why = new Map();
const mark = (s, r) => { const l = why.get(s) ?? new Set(); l.add(r); why.set(s, l); };
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
for (let i = 0; i < symbols.length; i += 50) {
  const batch = symbols.slice(i, i + 50);
  const sets = await redis.mget(...batch.map((s) => `${PREFIX}:${s}`)); cmds++;
  sets.forEach((set, j) => {
    if (!set || set.h !== H || !Array.isArray(set.quarters)) return;
    const s = batch[j];
    const all = [...set.quarters, ...set.years];
    if (all.some((p) => p.d[IX.epsDiluted] === "C" || p.d[IX.epsBasic] === "C")) mark(s, "a");
    if (all.some((p) => p.v[IX.revenue] == null && p.v[IX.netIncome] != null)) mark(s, "b");
    const q = [...set.quarters].sort((a, b) => a.e.localeCompare(b.e));
    for (let k = 1; k < q.length; k++) if (days(q[k - 1].e, q[k].e) > 105) { mark(s, "c"); break; }
  });
}
const NAMED = (process.env.SYMBOLS || "CVNA,COST,JPM,AAPL,MSFT,AMZN").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const targets = [...new Set([...NAMED, ...[...why.keys()].sort()])];
const count = (r) => [...why.values()].filter((v) => v.has(r)).length;
console.log(`${symbols.length} manifest symbols · candidates a=${count("a")} b=${count("b")} c=${count("c")} · reading ${targets.length}\n`);

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

const fmt = (v) => v == null ? "—" : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : Number(v.toFixed(4)).toString();
const code = (c) => (c ? ({ "as-filed": "F", differenced: "D", computed: "C", ambiguous: "A", withheld: "W" }[c.derived] ?? "?") : "-");
const byCat = { a: new Set(), b: new Set(), c: new Set(), other: new Set() };
const changeLines = [];
const totals = { fill: new Set(), removal: new Set(), change: new Set() };
const detail = [];
const yearsTouched = new Set();
let failed = 0;

for (const sym of targets) {
  const cik = manifest.symbols[sym]?.cik;
  if (!cik) continue;
  const facts = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`);
  if (!facts) { failed++; continue; }
  let b, a;
  try { b = BEFORE.extractCompanyFacts(sym, facts); a = AFTER.extractCompanyFacts(sym, facts); }
  catch (e) { console.log(`ERROR ${sym} ${e.message}`); failed++; continue; }
  const cal = AFTER.sixteenWeekCalendar(facts);
  const diffs = [];
  for (const kind of ["quarters", "years"]) {
    const bm = new Map(b[kind].map((p) => [p.end, p])), am = new Map(a[kind].map((p) => [p.end, p]));
    for (const end of new Set([...bm.keys(), ...am.keys()])) {
      const pb = bm.get(end), pa = am.get(end);
      if (!pb || !pa) { diffs.push({ kind, end, field: "(period)", b: pb ? "present" : "absent", a: pa ? "present" : "absent" }); continue; }
      K.forEach((f, i) => {
        const vb = pb.values[i]?.val ?? null, va = pa.values[i]?.val ?? null;
        const same = vb === va || (vb != null && va != null && Math.abs(vb - va) <= 1e-9 * Math.max(1, Math.abs(vb)));
        if (!same) diffs.push({ kind, end, field: f, b: `${fmt(vb)}${code(pb.values[i])}`, a: `${fmt(va)}${code(pa.values[i])}`, type: vb == null ? "fill" : va == null ? "removal" : "change" });
      });
    }
  }
  if (NAMED.includes(sym)) {
    console.log(`######## ${sym} sixteenWeek=${cal} changed cells ${diffs.length}`);
    const bm = new Map(b.quarters.map((p) => [p.end, p]));
    const qs = [...a.quarters].sort((x, y) => x.end.localeCompare(y.end)).slice(-8);
    const allEnds = [...new Set([...b.quarters.map((p) => p.end), ...qs.map((p) => p.end)])].sort().slice(-9);
    for (const end of allEnds) {
      const pa = a.quarters.find((p) => p.end === end), pb = bm.get(end);
      const cell = (p, k) => (p ? `${fmt(p.values[IX[k]]?.val ?? null)}${code(p.values[IX[k]])}` : "absent");
      console.log(`  ${end} ${pa?.fp ?? pb?.fp ?? ""}${pa?.fy ?? pb?.fy ?? ""} rev ${cell(pb, "revenue")} -> ${cell(pa, "revenue")} · eps ${cell(pb, "epsDiluted")} -> ${cell(pa, "epsDiluted")} · ni ${cell(pb, "netIncome")} -> ${cell(pa, "netIncome")}`);
    }
    for (const n of a.notes ?? []) if (/not computed|last resort/.test(n)) console.log(`  note: ${n}`);
  }
  if (!diffs.length) continue;
  const cats = new Set();
  for (const d of diffs) {
    if (d.field === "epsDiluted" || d.field === "epsBasic") cats.add(d.a.endsWith("-") && d.b.endsWith("C") ? "a" : "other");
    else if (d.field === "revenue" && d.b.startsWith("—")) cats.add(cal ? "c" : "b");
    else cats.add(cal ? "c" : "other");
  }
  for (const c of cats) byCat[c].add(sym);
  const t = (x) => diffs.filter((d) => d.type === x);
  for (const x of ["fill", "removal", "change"]) if (t(x).length) totals[x].add(sym);
  for (const d of [...t("change"), ...t("removal")]) detail.push(`${d.type.toUpperCase()} ${sym}${cal ? " 16wk" : ""} ${d.kind[0]}${d.end} ${d.field} ${d.b}->${d.a}`);
  if (diffs.some((d) => d.kind === "years")) yearsTouched.add(sym);
  changeLines.push(`CHANGED ${sym} [${[...cats].join(",")}]${cal ? " 16wk" : ""} ${diffs.length} cells: ${diffs.slice(0, 6).map((d) => `${d.kind[0]}${d.end} ${d.field} ${d.b}->${d.a}`).join("; ")}${diffs.length > 6 ? " …" : ""}`);
}

console.log(`\n== summary · read ${targets.length - failed} · failed ${failed}`);
for (const [c, set] of Object.entries(byCat)) console.log(`CAT ${c} ${set.size}: ${[...set].sort().join(" ")}`);
for (const [x, set] of Object.entries(totals)) console.log(`TYPE ${x} ${set.size}: ${[...set].sort().join(" ")}`);
console.log(`YEARS touched ${yearsTouched.size}: ${[...yearsTouched].sort().join(" ")}`);
console.log("");
detail.forEach((l) => console.log(l));
console.log("");
changeLines.forEach((l) => console.log(l));
console.log(`\nRedis commands: ${cmds}`);
