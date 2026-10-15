// PROBE FOR #552 COWORK #247 (reads only). For the 21 sets the #246 census
// called still mixed: is any EPS cell on TODAY'S PAGE truly pre-split, judged
// against the newest filing that states it, not the stored filed date? And why
// does the split proof's share-count step miss?
//   relay task: write-split-probe-247   SYMBOLS (default: the 21; CONFIRM: prints live EPS only)
// Page value  = splitAdjusted(live stored set), exactly what the page renders.
// Today basis = the newest filed EPS fact for that period, moved by every
//               stated whole split dated after that filing, oriented by the
//               cover share count (dei) either side of the split date.
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; split probe)";
const keyOf = (f, n) => (fs.readFileSync(f, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const imp = (rel) => import(pathToFileURL(path.join(process.cwd(), rel)).href);
const SA = await imp("lib/server/secSplitAdjust.ts");
const F = await imp("lib/server/secFields.ts");
const K = F.SEC_FIELD_KEYS;
const IX = { epsDiluted: K.indexOf("epsDiluted"), epsBasic: K.indexOf("epsBasic") };
const TAG = { epsDiluted: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"], epsBasic: ["EarningsPerShareBasic", "EarningsPerShareBasicAndDiluted"] };
const DEFAULT = "APH,DAVE,DNTH,GOOG,OCSL,ORLY,Q,TSLA,APLD,CENT,CSGP,GOOGL,HTHT,KLAC,EOSE,PGY,CNI,FRO,ONDS,SIRI,WGS";
const raw = process.env.SYMBOLS || DEFAULT;
const CONFIRM = raw.startsWith("CONFIRM:");
const symbols = (CONFIRM ? raw.slice(8) : raw).split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

const PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const manifest = await redis.get(keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"));
const sets = await redis.mget(...symbols.map((s) => `${PREFIX}:${s}`));
const fmt = (v) => (v == null ? "—" : Number(Number(v).toFixed(4)).toString());

if (CONFIRM) {
  symbols.forEach((sym, i) => {
    const page = SA.splitAdjusted(sets[i]);
    const qs = [...page.quarters].sort((a, b) => b.e.localeCompare(a.e)).slice(0, 8);
    console.log(`${sym} ssf ${JSON.stringify(sets[i]?.ssf ?? null)} · adjusted ${JSON.stringify(page.spa?.adjusted ?? [])}`);
    console.log(`  ${qs.map((p) => `${p.fp} FY${p.fy} (${p.e}) dil ${fmt(p.v[IX.epsDiluted])} bas ${fmt(p.v[IX.epsBasic])}`).join("\n  ")}`);
  });
  console.log(`Redis commands: 2`);
  process.exit(0);
}

let lastAt = 0;
const gated = async (url) => {
  for (let a = 0; a < 3; a++) {
    const wait = Math.max(0, lastAt + 150 - Date.now()); if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    try { const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(30000) }); if (res.ok) return res; } catch {}
    await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
  }
  return null;
};
const whole = (r) => { const k = r >= 1 ? r : 1 / r; return k >= 1.9 && Math.abs(k - Math.round(k)) <= 0.02 * k ? Math.round(k) : null; };
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const sharesOf = (p) => { const i = K.indexOf("sharesDiluted"), j = K.indexOf("sharesBasic"); return p.v[i] ?? p.v[j] ?? null; };

const totals = { truly: 0, ok: 0, unverifiable: 0, cells: 0 };
const truly = new Map();
for (let i = 0; i < symbols.length; i++) {
  const sym = symbols[i], set = sets[i];
  const cik = manifest.symbols[sym]?.cik;
  if (!set?.quarters || !cik) { console.log(`${sym}: no stored set`); continue; }
  const res = await gated(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`);
  if (!res) { console.log(`${sym}: companyfacts failed`); continue; }
  const facts = await res.json();
  const g = facts.facts?.["us-gaap"] ?? {};
  // stated whole-ratio splits, one per (month, ratio)
  const stated = [];
  for (const r of g.StockholdersEquityNoteStockSplitConversionRatio1?.units ? Object.values(g.StockholdersEquityNoteStockSplitConversionRatio1.units).flat() : []) {
    const d = r.end ?? r.start, w = whole(r.val);
    if (!d || !w) continue;
    // ONE SPLIT PER RATIO WITHIN TWO YEARS: later filings restate the same
    // split at their own period ends; the earliest date is the split.
    const near = stated.find((s) => s.w === w && Math.abs(days(s.d, d)) < 730);
    if (!near) stated.push({ d, w, filed: r.filed });
    else if (d < near.d) near.d = d;
  }
  // orientation from the cover share count either side of each date
  const cover = (facts.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? []).filter((r) => r.end && r.val > 0).sort((a, b) => a.end.localeCompare(b.end));
  for (const s of stated) {
    const before = [...cover].reverse().find((r) => r.end < s.d && days(r.end, s.d) < 200);
    const after = cover.find((r) => r.end >= s.d && days(s.d, r.end) < 200);
    s.m = null; s.how = "unknown";
    // (a) THE FILER'S OWN RESTATEMENT: one period's EPS filed before the date and again after it.
    let votes = { up: 0, down: 0 };
    for (const t of ["EarningsPerShareDiluted", "EarningsPerShareBasic"]) {
      const rows = Object.values(g[t]?.units ?? {}).flat().filter((r) => r.start && r.end && r.end < s.d && Math.abs(r.val) >= 0.02);
      const byPeriod = new Map();
      for (const r of rows) { const k = `${r.start}|${r.end}`; (byPeriod.get(k) ?? byPeriod.set(k, []).get(k)).push(r); }
      for (const list of byPeriod.values()) {
        const pre = list.filter((r) => r.filed < s.d).sort((a, b) => b.filed.localeCompare(a.filed))[0];
        const post = list.filter((r) => r.filed > s.d).sort((a, b) => b.filed.localeCompare(a.filed))[0];
        if (!pre || !post) continue;
        const x = post.val / pre.val;
        if (Math.abs(x * s.w - 1) <= 0.06) votes.up++; else if (Math.abs(x / s.w - 1) <= 0.06) votes.down++;
      }
    }
    if (votes.up > votes.down) { s.m = s.w; s.how = `restated ${votes.up}`; }
    else if (votes.down > votes.up) { s.m = 1 / s.w; s.how = `restated ${votes.down}`; }
    // (b) the cover share count either side of the date
    if (before && after) {
      const x = after.val / before.val; s.coverStep = x;
      if (s.m == null) { if (Math.abs(x / s.w - 1) <= 0.25) { s.m = s.w; s.how = "cover"; } else if (Math.abs(x * s.w - 1) <= 0.25) { s.m = 1 / s.w; s.how = "cover"; } }
    }
  }
  // WHAT THE MERGED CODE MAKES OF IT once re-read: the stored set plus the
  // filer's split facts (same read as secExtract's readSplitFacts).
  const ssfMap = new Map();
  for (const r of Object.values(g.StockholdersEquityNoteStockSplitConversionRatio1?.units ?? {}).flat()) { const d = r.end ?? r.start; if (d && r.val > 0) ssfMap.set(`${d}|${r.val}`, [d, r.val]); }
  const ssf = [...ssfMap.values()].sort((a, b) => a[0].localeCompare(b[0]));
  const proven = SA.provenSplits({ ...set, ssf });
  const facts1 = SA.splitFactors({ ...set, ssf });
  console.log(`${sym} DIAG asr ${JSON.stringify(set.asr ?? [])} · proven(with ssf) ${JSON.stringify(proven.map((x) => [x.k, x.date ?? null, x.refs.slice(0, 3)]))} · factors ${facts1.size}`);
  const page = SA.splitAdjusted(set);
  const all = [...page.quarters.map((p) => ["q", p]), ...page.years.map((p) => ["y", p])];
  const allStored = [...set.quarters, ...set.years];
  const lines = [];
  // why the proof's share step misses, per stated split
  const why = stated.map((s) => {
    const after = allStored.filter((p) => p.e > s.d && sharesOf(p)).sort((a, b) => b.e.localeCompare(a.e))[0];
    const pre = allStored.filter((p) => p.e < s.d && p.f && p.f < s.d && sharesOf(p));
    if (!after) return `${s.d} ×${s.w}: no post-split period with shares`;
    if (!pre.length) return `${s.d} ×${s.w}: no pre-split period (filed before) with shares`;
    let best = null;
    for (const p of pre) for (const k of [s.w, 1 / s.w]) { const r = (sharesOf(p) * k) / sharesOf(after); if (!best || Math.abs(Math.log(r)) < Math.abs(Math.log(best.r))) best = { r, p: p.e, k }; }
    return `${s.d} ×${s.w}: best pre×K/post ${best.r.toFixed(3)} (${best.p} vs ${after.e}) cover step ${s.coverStep ? s.coverStep.toFixed(3) : "n/a"}`;
  });
  for (const s of stated) {
    if (!all.some(([, p]) => p.e >= s.d)) continue;
    for (const [kind, p] of all) {
      if (!(p.e < s.d && p.f && p.f < s.d)) continue;
      for (const key of ["epsDiluted", "epsBasic"]) {
        const v = p.v[IX[key]];
        if (v == null) continue;
        totals.cells++;
        // newest filed fact for this exact period
        const rows = TAG[key].flatMap((t) => Object.values(g[t]?.units ?? {}).flat()).filter((r) => r.end === p.e && r.start && (p.s ? Math.abs(days(r.start, p.s)) <= 4 : kind === "q" ? Math.abs(days(r.start, r.end) - 91) <= 15 : Math.abs(days(r.start, r.end) - 365) <= 20));
        const newest = rows.sort((a, b) => b.filed.localeCompare(a.filed))[0];
        if (!newest) { totals.unverifiable++; lines.push(`  ${kind}${p.e} ${key} page ${fmt(v)} · no filed fact`); continue; }
        const later = stated.filter((x) => x.d > newest.filed);
        if (later.some((x) => x.m == null)) { totals.unverifiable++; lines.push(`  ${kind}${p.e} ${key} page ${fmt(v)} · newest ${fmt(newest.val)} (${newest.form} ${newest.filed}) · orientation unknown`); continue; }
        const today = later.reduce((acc, x) => acc / x.m, newest.val);
        const off = Math.abs(today) > 1e-9 ? Math.abs(v / today - 1) : Math.abs(v);
        if (off <= 0.03 || Math.abs(v - today) < 0.006) { totals.ok++; continue; }
        totals.truly++; truly.set(sym, (truly.get(sym) ?? 0) + 1);
        lines.push(`  PRE ${kind}${p.e} ${key} page ${fmt(v)} vs today ${fmt(today)} (newest ${fmt(newest.val)} ${newest.form} ${newest.filed})`);
      }
    }
  }
  console.log(`${sym} splits ${stated.map((s) => `${s.d}×${s.w}${s.m ? (s.m > 1 ? "↑" : "↓") : "?"}(${s.how})`).join(",")}\n  why: ${why.join(" | ")}`);
  lines.slice(0, 30).forEach((l) => console.log(l)); if (lines.length > 30) console.log(`  … ${lines.length - 30} more`);
}
console.log(`\n== cells checked ${totals.cells} · truly pre-split on the page ${totals.truly} · on today's basis ${totals.ok} · unverifiable ${totals.unverifiable}`);
console.log(`TRULY ${[...truly].map(([s, n]) => `${s} ${n}`).join(", ")}`);
console.log(`Redis commands: 2`);
