// READ-ONLY MEASUREMENT (#552 COWORK #88 §2): how often the dilution chart's
// first-vs-last trend disagrees with the last 3 years, and how many series
// start before the filer's first periodic report (pre-listing points).
//
// Series: buildShareHistory (the page's own builder) on every stored Layer 2
// set (Upstash SMEMBERS + MGET, reads only). First periodic report: the
// earliest 10-K/10-Q/20-F/40-F in the archived submissions (R2, incl. older
// pages), over the CIK and its predecessor. SEC values and tickers only; no
// FMP data. No SEC request.
//   workflow: sec-archive.yml task "dilution-trend" (probe branch only)
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import zlib from "node:zlib";
import { r2Client } from "../lib/secArchive.mjs";

const { buildShareHistory } = await import("../lib/server/secShareHistory.ts");
const { predecessorCikFor } = await import("../lib/server/secSuccession.ts");
const keyOf = (n) => (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(new RegExp(`export const ${n} = "([^"]+)"`)) ?? [])[1];
const PREFIX = keyOf("SEC_FACTS_PREFIX"), INDEX = keyOf("SEC_FACTS_INDEX_KEY"), MANIFEST = keyOf("SEC_MANIFEST_KEY");
const URL_ = process.env.UPSTASH_REDIS_REST_URL, TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
let cmds = 0, r2reads = 0;
async function redis(cmd) {
  cmds++;
  const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await res.json(); if (j.error) throw new Error("Upstash error"); return j.result;
}
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const r2 = r2Client();
const PERIODIC = /^(10-K|10-Q|20-F|40-F|10-KT|10-QT)$/;
const firstPeriodicCache = new Map();
async function firstPeriodic(cik) {
  if (firstPeriodicCache.has(cik)) return firstPeriodicCache.get(cik);
  let best = null;
  const buf = await r2.get(`submissions/${cik}.json.gz`); r2reads++;
  if (buf) {
    const { main, pages } = JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
    for (const t of [main?.filings?.recent, ...(pages ?? [])]) {
      if (!t?.form) continue;
      t.form.forEach((f, i) => {
        if (!PERIODIC.test(f)) return;
        const filed = t.filingDate?.[i], rep = t.reportDate?.[i];
        if (filed && (!best || filed < best.filed)) best = { filed, report: rep || null, form: f };
      });
    }
  }
  firstPeriodicCache.set(cik, best);
  return best;
}

const BAND = 0.05; // percent: the chart's own "Roughly flat" band
const dir = (a, b, band = BAND) => { const p = ((b - a) / a) * 100; return p > band ? "up" : p < -band ? "down" : "flat"; };
const minusYears = (iso, n) => new Date(Date.parse(iso) - n * 365.25 * 86400000).toISOString().slice(0, 10);

const symbols = ((await redis(["SMEMBERS", INDEX])) ?? []).map(String).sort();
const manifest = parse(await redis(["GET", MANIFEST])) ?? { symbols: {} };
const T = { sets: symbols.length, charted: 0, short3y: 0, matrix: {}, material: {}, preListing: 0, preFlip: 0, noSubs: 0, jumps: 0, gap3y: 0, holes: 0, splitLike: 0, scale: 0 };
const ex = { allUpRecentDown: [], allDownRecentUp: [], allUpRecentDownMaterial: [], preFlip: [], jumps: [], gap: [], holes: [], splitLike: [], scale: [] };
const push = (k, s) => ex[k].length < 40 && ex[k].push(s);
const watch = new Set(["GDDY", "AAPL", "PAC", "ONDS"]);
const SHOW = new Set(["GDDY", "PAC", "AMZN", "NVDA", "AVGO", "KO", "MSFT", "PG", "JNJ"]);
for (let i = 0; i < symbols.length; i += 25) {
  const chunk = symbols.slice(i, i + 25);
  const got = await redis(["MGET", ...chunk.map((s) => `${PREFIX}:${s}`)]);
  for (const [j, s] of chunk.entries()) {
    const set = got?.[j] ? parse(got[j]) : null;
    const h = set ? buildShareHistory(set) : null;
    if (!h) continue;
    T.charted++;
    const pts = h.points, first = pts[0], last = pts.at(-1);
    const all = dir(first.shares, last.shares);
    const cut = minusYears(last.date, 3);
    const cand = [...pts].reverse().find((p) => p.date <= cut);
    const base = cand && cand.date >= minusYears(cut, 0.5) ? cand : null;
    const recent = base ? dir(base.shares, last.shares) : cand ? "gap" : "short";
    if (!cand) T.short3y++; else if (!base) { T.gap3y++; push("gap", s); }
    // Interior gaps: consecutive points more than 15 months apart.
    if (pts.some((p, n) => n > 0 && (Date.parse(p.date) - Date.parse(pts[n - 1].date)) / 86400000 > 460)) { T.holes++; push("holes", s); }
    const k = `${all}->${recent}`;
    T.matrix[k] = (T.matrix[k] ?? 0) + 1;
    if (base) {
      const p3 = ((last.shares - base.shares) / base.shares) * 100;
      const mat = Math.abs(p3) >= 2 ? (p3 > 0 ? "up" : "down") : "within ±2%";
      const mk = `${all}->${mat}`;
      T.material[mk] = (T.material[mk] ?? 0) + 1;
      if (all === "up" && recent === "down") push("allUpRecentDown", s);
      if (all === "down" && recent === "up") push("allDownRecentUp", s);
      if (all === "up" && mat === "down") push("allUpRecentDownMaterial", s);
    }
    // Step jumps (> 25% between consecutive points): upper bound on IPO / Up-C / class events.
    const jump = pts.some((p, n) => n > 0 && Math.abs(p.shares / pts[n - 1].shares - 1) > 0.25);
    if (jump) { T.jumps++; push("jumps", s); }
    // A step at a whole split ratio (2,3,4,5,8,10,15,20,25,40,50 within 3%), either way:
    // a split drawn as dilution. A step over 100x: a unit/scale error.
    const RATIOS = [2, 3, 4, 5, 8, 10, 15, 20, 25, 40, 50];
    const steps = pts.slice(1).map((p, n) => p.shares / pts[n].shares);
    if (steps.some((r) => r > 100 || r < 0.01)) { T.scale++; push("scale", s); }
    else if (steps.some((r) => RATIOS.some((k) => Math.abs(r / k - 1) < 0.03 || Math.abs(r * k - 1) < 0.03))) { T.splitLike++; push("splitLike", s); }
    const holeHere = pts.some((p, n) => n > 0 && (Date.parse(p.date) - Date.parse(pts[n - 1].date)) / 86400000 > 460);
    const stepHere = steps.some((r) => r > 100 || r < 0.01 || RATIOS.some((k) => Math.abs(r / k - 1) < 0.03 || Math.abs(r * k - 1) < 0.03));
    if (SHOW.has(s)) console.log(`  ${s} guard: ${holeHere || stepHere ? "WITHHELD" : "clean"}`);
    if (SHOW.has(s)) console.log(`  ${s} series: ${pts.map((p) => `${p.date}=${p.shares}`).join(" ")}`);
    // Pre-listing points: before the first periodic report's own period.
    const cik = String(manifest.symbols?.[s]?.cik ?? set.cik ?? "").padStart(10, "0");
    const pred = predecessorCikFor(cik);
    const fps = [await firstPeriodic(cik), pred ? await firstPeriodic(String(pred).padStart(10, "0")) : null].filter(Boolean);
    const fp = fps.sort((a, b) => (a.filed < b.filed ? -1 : 1))[0] ?? null;
    if (!fp) { T.noSubs++; }
    else {
      const from = fp.report ?? fp.filed;
      const kept = pts.filter((p) => p.date >= from);
      if (kept.length < pts.length) {
        T.preListing++;
        const after = kept.length >= 2 ? dir(kept[0].shares, kept.at(-1).shares) : "too-few";
        if (after !== all) { T.preFlip++; push("preFlip", `${s}(${all}->${after})`); }
      }
      if (watch.has(s)) console.log(`  ${s}: ${pts.length} points ${first.date}..${last.date}; since-first ${all} ${(((last.shares - first.shares) / first.shares) * 100).toFixed(2)}%; 3y ${recent}${base ? ` ${(((last.shares - base.shares) / base.shares) * 100).toFixed(2)}% from ${base.date}` : ""}; first periodic ${fp.form} filed ${fp.filed} for ${fp.report}; points before it ${pts.length - kept.length}; jump>25% ${jump}`);
    }
  }
}
console.log(`\nStored sets ${T.sets}; with a chart (>=3 points) ${T.charted}; history under 3 years ${T.short3y}`);
console.log(`Since-first -> last-3y direction (band ±${BAND}%, the chart's own): ${JSON.stringify(T.matrix)}`);
console.log(`Since-first -> last-3y, material (±2%): ${JSON.stringify(T.material)}`);
console.log(`  up overall, down over 3y: ${ex.allUpRecentDown.join(" ")}`);
console.log(`  of those, down by 2%+ over 3y: ${ex.allUpRecentDownMaterial.join(" ")}`);
console.log(`  down overall, up over 3y: ${ex.allDownRecentUp.join(" ")}`);
console.log(`Series with points before the first periodic report: ${T.preListing}; trend flips when they are dropped: ${T.preFlip}; no archived submissions: ${T.noSubs}`);
console.log(`  flips: ${ex.preFlip.join(" ")}`);
console.log(`3-year base missing because of a gap in the series (no point within 6 months before the cut): ${T.gap3y}: ${ex.gap.join(" ")}`);
console.log(`Series with an interior gap > 15 months between points: ${T.holes}: ${ex.holes.join(" ")}`);
console.log(`Series with a step at a whole split ratio (±3%): ${T.splitLike}: ${ex.splitLike.join(" ")}`);
console.log(`Series with a step over 100x either way (unit/scale): ${T.scale}: ${ex.scale.join(" ")}`);
console.log(`Series with a step jump > 25% between consecutive points: ${T.jumps}`);
console.log(`  e.g. ${ex.jumps.join(" ")}`);
console.log(`\nRedis commands ${cmds} (reads only) · R2 reads ${r2reads} · SEC requests 0`);
