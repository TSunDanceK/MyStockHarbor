// SEC CACHE SIZES, UPSTASH METER, DAILY-INDEX FILING VOLUME AND PER-FILER TIMING
//
// ── WHY (#535 COWORK #9 and #10, MEASURE BEFORE PROPOSING) ─────────────────
// COWORK #9 asks what the SEC stores hold (keys, TTL, bytes per set and in
// total) and what they cost per day; COWORK #10 asks how many tracked filers
// file a 10-Q/10-K/20-F/40-F per day at peak and on average, how long one
// filing read takes end to end, and what can never be filled. One probe, four
// parts, all read-only:
//
//   A. Redis: STRLEN/TTL of every msh:sec:* key family, ff/lg presence, the
//      manifest's filingLag census, and the msh:redis-units:v1 meter hashes.
//   B. SEC daily index (master.YYYYMMDD.idx), every weekday 2026-01-02 to
//      yesterday, intersected with the manifest's CIKs.
//   C. Timing: a sample of peak-day tracked 10-Q/10-K filings run through the
//      shipped filing path (submissions, companyfacts, folder index, instance,
//      instanceToFacts, mergeFillOnly, extractCompanyFacts), timed per step.
//   D. Residue: tracked filers whose periodic forms are annual-only (their
//      quarters arrive only as 6-K) and the manifest's notice-only lags.
//
// No Redis writes, no SEC writes (there are none). Runs on a runner via the
// stateful relay job for the read-only Upstash token; the sandbox cannot reach
// SEC.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; cache budget probe)";
const SAMPLE = Number(process.env.SAMPLE ?? 24);

const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (src, n) => (src.match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const SEC_MANIFEST_KEY = pick(manifestSrc, "SEC_MANIFEST_KEY");
const SEC_FACTS_PREFIX = pick(manifestSrc, "SEC_FACTS_PREFIX");
const DATES_PREFIX = pick(fs.readFileSync("lib/server/secReportDatesStore.ts", "utf8"), "SEC_REPORT_DATES_PREFIX");

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
  const sum = s.reduce((a, b) => a + b, 0);
  return { n: s.length, sum, mean: s.length ? Math.round(sum / s.length) : 0, p50: q(0.5), p90: q(0.9), max: s.at(-1) ?? 0 };
};
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;

async function scanKeys(match) {
  const keys = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, { match, count: 1000 });
    keys.push(...batch);
    cursor = String(next);
  } while (cursor !== "0");
  return keys;
}
async function strlens(keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 200) {
    const p = redis.pipeline();
    for (const k of keys.slice(i, i + 200)) p.strlen(k);
    out.push(...(await p.exec()));
  }
  return out.map(Number);
}

// ── A. REDIS ────────────────────────────────────────────────────────────────
console.log("== A. Redis stores");
const manifestLen = await redis.strlen(SEC_MANIFEST_KEY);
const manifest = await redis.get(SEC_MANIFEST_KEY);
const entries = Object.entries(manifest?.symbols ?? {});
console.log(`manifest ${SEC_MANIFEST_KEY}: ${kb(manifestLen)}, ${entries.length} entries, TTL ${await redis.ttl(SEC_MANIFEST_KEY)}`);
const lagKinds = {};
for (const [, e] of entries) if (e.filingLag) lagKinds[e.filingLag.kind] = (lagKinds[e.filingLag.kind] ?? 0) + 1;
const checked = entries.filter(([, e]) => e.filingCheckAt).length;
console.log(`filing phase: checked-ever ${checked}/${entries.length}, filingLag ${JSON.stringify(lagKinds)}`);

const factKeys = await scanKeys(`${SEC_FACTS_PREFIX}:*`);
const factLens = await strlens(factKeys);
const inManifest = new Set(entries.map(([s]) => `${SEC_FACTS_PREFIX}:${s}`));
const fs1 = stats(factLens);
const fsM = stats(factLens.filter((_, i) => inManifest.has(factKeys[i])));
const fsC = stats(factLens.filter((_, i) => !inManifest.has(factKeys[i])));
console.log(`fact sets ${SEC_FACTS_PREFIX}:*  n=${fs1.n} total ${mb(fs1.sum)} mean ${kb(fs1.mean)} p50 ${kb(fs1.p50)} p90 ${kb(fs1.p90)} max ${kb(fs1.max)}`);
console.log(`  of which manifest n=${fsM.n} total ${mb(fsM.sum)} mean ${kb(fsM.mean)}; cold-only n=${fsC.n} total ${mb(fsC.sum)}`);
const ttls = await Promise.all(factKeys.slice(0, 20).map((k) => redis.ttl(k)));
console.log(`  TTL sample (20): ${[...new Set(ttls)].join(",")}`);
// ff / lg presence and their size: read the sets that the manifest says were touched.
const touched = entries.filter(([, e]) => e.filingLag).map(([s]) => s);
let ffN = 0, lgN = 0;
const ffLens = [];
for (const s of touched) {
  const set = await redis.get(`${SEC_FACTS_PREFIX}:${s}`);
  if (set?.ff) { ffN++; ffLens.push(JSON.stringify(set).length); }
  if (set?.lg) lgN++;
}
console.log(`  ff (filing-filled) sets ${ffN}, lg (notice) sets ${lgN}; filled-set size ${JSON.stringify(stats(ffLens))}`);

const dateKeys = await scanKeys(`${DATES_PREFIX}:*`);
const dateLens = stats(await strlens(dateKeys));
console.log(`report dates ${DATES_PREFIX}:*  n=${dateLens.n} total ${mb(dateLens.sum)} mean ${kb(dateLens.mean)} max ${kb(dateLens.max)} TTL ${dateKeys[0] ? await redis.ttl(dateKeys[0]) : "-"}`);

for (const k of ["msh:sec:tickers:v2", "msh:sec:cold-cik:v1", "msh:sec:cold-queue:v1"]) {
  const t = await redis.type(k);
  const size = t === "string" ? kb(await redis.strlen(k)) : t === "hash" ? `${await redis.hlen(k)} fields` : t === "zset" ? `${await redis.zcard(k)} members` : "-";
  console.log(`${k}: type ${t}, ${size}, TTL ${await redis.ttl(k)}`);
}
const otherSec = (await scanKeys("msh:sec:*")).filter((k) => !k.startsWith(`${SEC_FACTS_PREFIX}:`) && !k.startsWith(`${DATES_PREFIX}:`));
const byFamily = {};
for (const k of otherSec) { const f = k.split(":").slice(0, 3).join(":"); byFamily[f] = (byFamily[f] ?? 0) + 1; }
console.log(`other msh:sec:* keys by family: ${JSON.stringify(byFamily)}`);

// THE METER. Raw per-source unit counts per day; bytes-per-unit are applied in the report.
console.log("== A2. msh:redis-units:v1 meter (units per source, by day)");
for (let d = 1; d <= 8; d++) {
  const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
  const h = (await redis.hgetall(`msh:redis-units:v1:${day}`)) ?? {};
  const bySource = {};
  for (const [f, v] of Object.entries(h)) {
    const src = f.split("|")[0];
    bySource[src] = (bySource[src] ?? 0) + Number(v);
  }
  console.log(`${day} ${JSON.stringify(bySource)}`);
}

// ── B. DAILY INDEX VOLUME ───────────────────────────────────────────────────
console.log("== B. Daily index volume (tracked CIKs)");
const tracked = new Map();
for (const [s, e] of entries) if (e.cik && !e.delisted) tracked.set(String(Number(e.cik)), s);
console.log(`tracked CIKs ${tracked.size}`);

let lastAt = 0;
const get = async (url, as = "json") => {
  const wait = Math.max(0, lastAt + 120 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) return { status: res.status, body: null, ms: Date.now() - t0, bytes: 0 };
  const text = await res.text();
  return { status: res.status, body: as === "json" ? JSON.parse(text) : text, ms: Date.now() - t0, bytes: text.length };
};

const PERIODIC = new Set(["10-Q", "10-K", "20-F", "40-F"]);
const days = [];
const formsByCik = new Map();
const periodicRows = [];
let idxBytes = 0;
const end = new Date(Date.now() - 86400000);
for (let d = new Date("2026-01-02T00:00:00Z"); d <= end; d = new Date(d.getTime() + 86400000)) {
  if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  const r = await get(`https://www.sec.gov/Archives/edgar/daily-index/2026/QTR${q}/master.${ymd}.idx`, "text");
  if (!r.body) continue;
  idxBytes += r.bytes;
  const row = { ymd, all: 0, amend: 0, sixK: 0, bytes: r.bytes };
  for (const line of r.body.split("\n")) {
    const p = line.split("|");
    if (p.length < 5 || !/^\d+$/.test(p[0])) continue;
    const sym = tracked.get(String(Number(p[0])));
    if (!sym) continue;
    const form = p[2].trim().toUpperCase();
    const base = form.replace(/\/A$/, "");
    const set = formsByCik.get(sym) ?? new Set();
    set.add(form);
    formsByCik.set(sym, set);
    if (form === "6-K") row.sixK++;
    if (!PERIODIC.has(base)) continue;
    if (form !== base) { row.amend++; continue; }
    row.all++;
    periodicRows.push({ ymd, sym, cik: p[0], form, file: p[4].trim() });
  }
  days.push(row);
}
const perDay = stats(days.map((d) => d.all));
console.log(`index days ${days.length}, index bytes ${mb(idxBytes)} (mean ${kb(idxBytes / Math.max(1, days.length))}/day)`);
console.log(`original periodic filings by tracked filers per day: ${JSON.stringify(perDay)}`);
const top = [...days].sort((a, b) => b.all - a.all).slice(0, 12);
console.log(`busiest days: ${top.map((d) => `${d.ymd}:${d.all}`).join(" ")}`);
const window = (a, b) => days.filter((d) => d.ymd >= a && d.ymd <= b);
for (const [label, a, b] of [
  ["Q4 season 2026-01-20..02-28", "20260120", "20260228"],
  ["Q1 season 2026-04-15..05-15", "20260415", "20260515"],
  ["Q2 season 2026-07-15..08-14", "20260715", "20260814"],
  ["peak window 2026-07-27..08-07", "20260727", "20260807"],
  ["off season 2026-06-01..06-30", "20260601", "20260630"],
  ["off season 2026-08-24..09-22", "20260824", "20260922"],
]) {
  const w = window(a, b);
  console.log(`${label}: days ${w.length}, filings ${w.reduce((s, d) => s + d.all, 0)}, ${JSON.stringify(stats(w.map((d) => d.all)))}`);
}
console.log(`amendments (not filled) total ${days.reduce((s, d) => s + d.amend, 0)}; 6-K by tracked total ${days.reduce((s, d) => s + d.sixK, 0)}`);

// ── C. TIMING: THE SHIPPED FILING PATH, END TO END ─────────────────────────
console.log("== C. Per-filer timing through the shipped filing path");
const strip = (f) =>
  fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");
const sec = await lift([
  fs.readFileSync("lib/server/secFields.ts", "utf8"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  strip("lib/server/secFactCodec.ts"),
  strip("lib/server/secFilingFill.ts"),
].join("\n"));
const { extractCompanyFacts, newestPeriodicFiling, pickInstanceName, instanceToFacts, mergeFillOnly, reportingCurrency } = sec;

const peakDay = top[0]?.ymd;
const sample = periodicRows.filter((r) => r.ymd === peakDay).slice(0, SAMPLE);
const steps = { submissions: [], companyfacts: [], folder: [], instance: [], parse: [], extract: [], total: [] };
const sizes = { submissions: [], companyfacts: [], instance: [] };
let noInstance = 0, failures = 0, requests = 0;
for (const r of sample) {
  const t0 = Date.now();
  try {
    const cik10 = String(r.cik).padStart(10, "0");
    const subs = await get(`https://data.sec.gov/submissions/CIK${cik10}.json`); requests++;
    steps.submissions.push(subs.ms); sizes.submissions.push(subs.bytes);
    const f = newestPeriodicFiling(subs.body);
    const cf = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`); requests++;
    steps.companyfacts.push(cf.ms); sizes.companyfacts.push(cf.bytes);
    if (!f || !cf.body) { failures++; continue; }
    const dir = `https://www.sec.gov/Archives/edgar/data/${Number(r.cik)}/${f.accn.replace(/-/g, "")}`;
    const idx = await get(`${dir}/index.json`); requests++;
    steps.folder.push(idx.ms);
    const name = pickInstanceName((idx.body?.directory?.item ?? []).map((i) => i.name));
    if (!name) { noInstance++; console.log(`  ${r.sym} ${f.form} ${f.accn}: no instance in folder`); continue; }
    const inst = await get(`${dir}/${name}`, "text"); requests++;
    steps.instance.push(inst.ms); sizes.instance.push(inst.bytes);
    const tp = Date.now();
    const { facts, rows } = instanceToFacts(inst.body, f);
    const cur = reportingCurrency ? reportingCurrency(cf.body) : "USD";
    const { merged, added } = mergeFillOnly(cf.body, facts, cur ?? "USD");
    steps.parse.push(Date.now() - tp);
    const te = Date.now();
    extractCompanyFacts(r.sym, added ? merged : cf.body);
    steps.extract.push(Date.now() - te);
    steps.total.push(Date.now() - t0);
    console.log(`  ${r.sym} ${f.form} ${f.reportDate}: instance ${mb(inst.bytes)} rows ${rows} added ${added} total ${Date.now() - t0}ms`);
  } catch (err) {
    failures++;
    console.log(`  ${r.sym}: ${String(err?.message ?? err).slice(0, 120)}`);
  }
}
console.log(`sample ${sample.length} on ${peakDay}, requests ${requests}, noInstance ${noInstance}, failures ${failures}`);
for (const [k, v] of Object.entries(steps)) console.log(`  ms ${k}: ${JSON.stringify(stats(v))}`);
for (const [k, v] of Object.entries(sizes)) console.log(`  bytes ${k}: ${JSON.stringify(stats(v))}`);

// ── D. RESIDUE ──────────────────────────────────────────────────────────────
console.log("== D. What the filing path cannot fill");
const annualOnly = [];
const sixKOnly = [];
for (const [sym, forms] of formsByCik) {
  const periodic = [...forms].filter((f) => PERIODIC.has(f.replace(/\/A$/, "")));
  if (forms.has("6-K") && periodic.every((f) => /^(20-F|40-F)/.test(f))) {
    (periodic.length ? annualOnly : sixKOnly).push(sym);
  }
}
console.log(`tracked filers whose interim quarters arrive only as 6-K: annual 20-F/40-F in window ${annualOnly.length}: ${annualOnly.sort().join(",")}`);
console.log(`tracked filers with 6-K and no periodic form in window ${sixKOnly.length}: ${sixKOnly.sort().join(",")}`);
const notice = entries.filter(([, e]) => e.filingLag?.kind === "notice").map(([s, e]) => `${s}(${e.filingLag.reportDate})`);
console.log(`notice-only lags now ${notice.length}: ${notice.join(",")}`);
const neverFiled = [...tracked.values()].filter((s) => !formsByCik.has(s));
console.log(`tracked filers with no filing of any kind in the window: ${neverFiled.length}`);
