// TWO READ-ONLY COUNTS FOR #552 #86b (CODE-A #93), before the purge.
//
// (a) 40-F / 20-F CITED COVERS: for the Pickers names refused a cap for "no
//     cover count" or "stale" that file a 40-F or 20-F, read the filer's
//     latest annual report's cover sentence ("number of outstanding shares of
//     each of the issuer's classes ... as of the close of the period") and
//     classify: one count / several classes / no parse. "Would fill" = one
//     count, current under coverIsCurrent, newer than the stored cover.
//     SEC: 1 submissions + 1 document per name, at <=4/s, our User-Agent.
// (b) PICKERS BANKS SHOWING P/S: SIC 6000-6299 rows whose stored row carries
//     a twelve-month revenue that is not marked incomplete, and a share count.
//     Price-free; no FMP data. Redis: universe GET + rows HMGET + set MGETs.
//   relay task: write-foreign-cover-bank-ps
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const P = await import("../lib/server/pickersSecFundamentals.ts");
const V = await import("../lib/server/secValuation.ts");
const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; foreign cover probe)";
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const reg = (s) => REG[s] ?? REG[s.replace(".", "-")] ?? REG[s.replace("-", ".")];
const TODAY = new Date().toISOString().slice(0, 10);
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
let commands = 0, secRequests = 0;
const GAP = 250;
const get = async (url) => {
  secRequests++;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  await new Promise((x) => setTimeout(x, GAP));
  if (r.status === 429 || r.status === 403) { console.log(`SEC ${r.status}: stopping, nothing more requested`); process.exit(2); }
  return r.ok ? r.text() : null;
};

const raw = await redis.get("msh:pickers:v10:symbols"); commands++;
const list = Array.isArray(raw) ? raw : Array.isArray(raw?.symbols) ? raw.symbols : [];
const universe = [...new Set(list.map((x) => String(typeof x === "string" ? x : x?.symbol ?? "").toUpperCase()).filter(Boolean))];
const rows = await P.readSecPickerRows(universe); commands++;

// ── (b) banks ─────────────────────────────────────────────────────────────
const banks = universe.filter((s) => { const sic = reg(s)?.sic; return sic && sic >= "6000" && sic <= "6299"; });
const showsPs = [], incomplete = [], noRev = [], noShares = [];
for (const s of banks) {
  const row = rows.get(s);
  if (!row) continue;
  if (!row.inputs.shares) { noShares.push(s); continue; }
  if (row.m.revenueIncomplete) incomplete.push(s);
  else if (row.m.revenue == null) noRev.push(s);
  else showsPs.push(s);
}
console.log(`(b) Pickers rows with SIC 6000-6299: ${banks.length}`);
console.log(`  P/S shown (revenue present, not marked incomplete, share count present): ${showsPs.length}: ${showsPs.join(" ")}`);
console.log(`  P/S refused, revenue marked incomplete: ${incomplete.length}: ${incomplete.join(" ")}`);
console.log(`  no twelve-month revenue: ${noRev.length}: ${noRev.join(" ")}`);
console.log(`  no share count (cap refused first): ${noShares.length}: ${noShares.join(" ")}`);

// ── (a) foreign covers ────────────────────────────────────────────────────
const targets = [];
for (const s of universe) {
  const row = rows.get(s);
  const form = reg(s)?.annualForm;
  if (!row || !(form === "20-F" || form === "40-F")) continue;
  const why = V.marketCap({ shares: row.inputs.shares, eps: null, refusals: row.inputs.refusals }, null);
  if (why && !why.ok && (why.why === "no-cover-share-count" || why.why === "share-count-is-stale")) targets.push({ s, form, why: why.why });
}
const sets = new Map();
for (let i = 0; i < targets.length; i += 25) {
  const c = targets.slice(i, i + 25).map((t) => t.s); commands++;
  const v = await redis.mget(...c.map((s) => `${FACTS}:${s}`));
  c.forEach((s, j) => sets.set(s, v[j] ?? null));
}
const numRe = /(\d{1,3}(?:,\d{3}){2,})/g;
const out = { fill: [], notNewer: [], stale: [], multi: [], noParse: [], noFiling: [] };
const lines = [];
for (const t of targets) {
  const cik = String(reg(t.s).cik).padStart(10, "0");
  const subTxt = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const rec = subTxt ? JSON.parse(subTxt).filings?.recent : null;
  const i = rec ? rec.form.findIndex((f) => f === "20-F" || f === "40-F") : -1;
  if (i < 0) { out.noFiling.push(t.s); lines.push(`  ${t.s} ${t.form}: no 20-F/40-F in the recent list`); continue; }
  const acc = rec.accessionNumber[i], doc = rec.primaryDocument[i], filed = rec.filingDate[i], period = rec.reportDate[i];
  const html = await get(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}/${doc}`);
  const text = (html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const at = text.search(/number of outstanding shares of each of the issuer/i);
  const tail = at >= 0 ? text.slice(at, at + 700) : "";
  const cut = tail.search(/Indicate by check mark|Yes\s*☐|Yes\s*☒/i);
  const zone = cut > 0 ? tail.slice(0, cut) : tail.slice(0, 500);
  const nums = [...zone.matchAll(numRe)].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => n >= 1e6);
  const stored = sets.get(t.s)?.cover?.asOf ?? null;
  let cls;
  if (at < 0 || !nums.length) cls = "noParse";
  else if (nums.length > 1) cls = "multi";
  else if (!V.coverIsCurrent(period, TODAY)) cls = "stale";
  else if (stored && period <= stored) cls = "notNewer";
  else cls = "fill";
  out[cls].push(t.s);
  lines.push(`  ${t.s} ${rec.form[i]} filed ${filed} period ${period} · ${cls}${nums.length ? ` · ${nums.length === 1 ? nums[0] : nums.join(" / ")}` : ""} · stored cover ${stored ?? "none"} · today's reason ${t.why}`);
}
console.log(`\n(a) 20-F/40-F names refused for no-cover or stale: ${targets.length}`);
for (const l of lines) console.log(l);
console.log(`  would fill (one count, current, newer than stored): ${out.fill.length}: ${out.fill.join(" ")}`);
console.log(`  several classes on the cover: ${out.multi.length}: ${out.multi.join(" ")}`);
console.log(`  count found but the period is itself stale: ${out.stale.length}: ${out.stale.join(" ")}`);
console.log(`  count found, not newer than stored: ${out.notNewer.length}: ${out.notNewer.join(" ")}`);
console.log(`  cover sentence not parsed: ${out.noParse.length}: ${out.noParse.join(" ")}`);
console.log(`  no 20-F/40-F in the recent list: ${out.noFiling.length}: ${out.noFiling.join(" ")}`);
console.log(`\nRedis commands ${commands + 0} (+1 HMGET in readSecPickerRows), read-only · SEC requests ${secRequests} at <=4/s`);
