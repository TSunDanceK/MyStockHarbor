// #535 COWORK #7 ruling 2 — "NO PATTERN" REFUSALS: DOES A SAME-QUARTER LAG FIX
// THEM WITHOUT LOSING PRECISION? MEASURE ONLY.
//
// Today (filerPrecision, shipped): each walk-forward prediction is the median
// of ALL prior lags. A Q4 lag (10-K, ~40 days) sits among ~25-day quarterly
// lags, so a regular filer can fail the 0.70 / 0.80 bar on that mix alone (KO).
//
// Three predictors, same scoring (listing-day overlap over a 31-day window,
// the shipped metric), same admission rule (>= MIN_USABLE_PERIODS lags,
// precision >= 0.70 domestic / 0.80 FPI):
//   CURRENT   median of all prior lags                         (as shipped)
//   SAME_Q    median of prior lags for the SAME calendar-quarter slot
//   Q4_SPLIT  two pools — the fiscal-year-end quarter vs the other three
// A prediction needs >= 2 priors in its pool. Q4 = a period end within 10
// days of one of the filer's stored fiscal year ends.
//
// IN-SAMPLE (admission as shipped: all predictions) and HOLD-OUT (admit on all
// but the newest 2 predictions, score only those 2) are both printed, so a
// predictor that merely fits its own history cannot pass for a better one.
//
// Also: why O (and ARM) have no report-date record — their manifest state.
// Read-only (GETs). relay task: write-outlook-samequarter
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const src = fs.readFileSync("lib/server/expectedToReport.ts", "utf8");
const constOf = (n) => (src.match(new RegExp(`export const ${n} = ([\\d.]+);`)) ?? [])[1];
const K = {
  WINDOW: Number(constOf("EXPECTED_WINDOW_DAYS")), MIN: Number(constOf("MIN_USABLE_PERIODS")),
  SEED: Number(constOf("SEED_PERIODS")), BAR_D: Number(constOf("PRECISION_BAR_DOMESTIC")),
  BAR_F: Number(constOf("PRECISION_BAR_FPI")),
};
if (Object.values(K).some((v) => !Number.isFinite(v))) { console.error("FATAL: constants", K); process.exit(2); }
const X = await lift(
  `const DAY = 86_400_000;
   const parse = (d) => Date.parse(\`\${d}T00:00:00.000Z\`);
   const valid = (d) => typeof d === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(d) && Number.isFinite(parse(d));
   const daysBetween = (from, to) => Math.round((parse(to) - parse(from)) / DAY);
   const EXPECTED_WINDOW_DAYS = ${K.WINDOW}; const MIN_USABLE_PERIODS = ${K.MIN}; const SEED_PERIODS = ${K.SEED};
   ${grabFunction(src, "lagsFrom")}
   ${grabFunction(src, "filerPrecision")}
   export const median = ${(src.match(/export const median = ([\s\S]*?\n};)/) ?? [])[1]}
   export { lagsFrom, filerPrecision };`
);

const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (n) => (manifestSrc.match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const DATES = (fs.readFileSync("lib/server/secReportDatesStore.ts", "utf8")
  .match(/SEC_REPORT_DATES_PREFIX = "([^"]+)"/) ?? [])[1];
const manifest = await redis.get(pick("SEC_MANIFEST_KEY"));
const FACTS = pick("SEC_FACTS_PREFIX");
const all = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();

const parse = (d) => Date.parse(`${d}T00:00:00Z`);
const slot = (d) => { const t = new Date(parse(d)); const doy = (t.getUTCMonth()) * 30.44 + t.getUTCDate(); return Math.round(doy / 91.31) % 4; };
const SPAN = K.WINDOW + 1;
const hit = (pred, actual) => Math.max(0, SPAN - Math.abs(pred - actual)) / SPAN;

// Events -> [{ lag, end }] oldest first, with the SHIPPED lag filter.
function series(rec) {
  const usable = (rec?.events ?? []).filter((e) => e?.periodEnd && e?.announcedOn);
  return usable
    .map((e) => ({ end: e.periodEnd, lag: Math.round((parse(e.announcedOn) - parse(e.periodEnd)) / 86400000) }))
    .filter((x) => x.lag >= 0 && x.lag <= 200)
    .sort((a, b) => parse(a.end) - parse(b.end));
}

function predictions(ser, poolOf) {
  const out = [];
  for (let i = 0; i < ser.length; i++) {
    const pool = poolOf ? ser.slice(0, i).filter((x) => poolOf(x) === poolOf(ser[i])) : ser.slice(0, i);
    if (poolOf ? pool.length < 2 : i < K.SEED) continue;
    out.push(hit(X.median(pool.map((x) => x.lag)), ser[i].lag));
  }
  return out;
}

const variants = { CURRENT: null, SAME_Q: (x) => slot(x.end), Q4_SPLIT: null };
const res = Object.fromEntries(Object.keys(variants).map((v) => [v, { admitted: 0, inHits: [], hoAdmitted: 0, hoHits: [], moved: [] }]));
let scored = 0;
const named = ["KO", "GOOGL", "PEP", "JNJ", "AAPL", "O", "ARM"];
for (let i = 0; i < all.length; i += 50) {
  const b = all.slice(i, i + 50);
  const [rr, ss] = await Promise.all([
    Promise.all(b.map((s) => redis.get(`${DATES}:${s}`))),
    Promise.all(b.map((s) => redis.get(`${FACTS}:${s}`))),
  ]);
  b.forEach((sym, k) => {
    const rec = rr[k];
    if (!rec || !Array.isArray(rec.events)) return;
    const { lags, isFpi } = X.lagsFrom(rec.events);
    if (lags.length < K.MIN) return;
    scored++;
    const bar = isFpi ? K.BAR_F : K.BAR_D;
    const fye = (ss[k]?.years ?? []).map((y) => y.e).filter(Boolean);
    const isQ4 = (x) => fye.some((e) => Math.abs(parse(e) - parse(x.end)) <= 10 * 86400000) ? "Q4" : "Q";
    const ser = series(rec);
    const verdict = {};
    for (const [v, fn] of Object.entries(variants)) {
      const preds = v === "CURRENT" ? predictions(ser, null) : v === "Q4_SPLIT" ? predictions(ser, isQ4) : predictions(ser, fn);
      const r = res[v];
      if (preds.length >= K.MIN - K.SEED) {
        const p = preds.reduce((a, c) => a + c, 0) / preds.length;
        verdict[v] = p >= bar;
        if (p >= bar) { r.admitted++; r.inHits.push(...preds); }
        const head = preds.slice(0, -2), tail = preds.slice(-2);
        if (head.length >= 3 && head.reduce((a, c) => a + c, 0) / head.length >= bar) { r.hoAdmitted++; r.hoHits.push(...tail); }
      } else verdict[v] = null;
    }
    // Shipped cross-check: CURRENT must agree with filerPrecision's own call.
    const shipped = X.filerPrecision(lags);
    if (shipped && (shipped.precision >= bar) !== verdict.CURRENT && verdict.CURRENT !== null) res.CURRENT.moved.push(`${sym}(shipped≠replica)`);
    for (const v of ["SAME_Q", "Q4_SPLIT"]) if (verdict[v] && !verdict.CURRENT) res[v].moved.push(sym);
    if (named.includes(sym)) console.log(`  ${sym.padEnd(6)} lags ${lags.join(",")}  ${Object.entries(verdict).map(([v, a]) => `${v}=${a === null ? "n/a" : a ? "admit" : "refuse"}`).join(" ")}`);
  });
}
const avg = (xs) => (xs.length ? (xs.reduce((a, c) => a + c, 0) / xs.length).toFixed(3) : "—");
console.log(`\n${scored} filers with >= ${K.MIN} usable lags (bars: domestic ${K.BAR_D}, FPI ${K.BAR_F})\n`);
console.log(`${"variant".padEnd(10)} ${"admitted".padStart(9)} ${"in-sample prec".padStart(15)} ${"hold-out admitted".padStart(18)} ${"hold-out prec".padStart(14)}`);
for (const [v, r] of Object.entries(res)) {
  console.log(`${v.padEnd(10)} ${String(r.admitted).padStart(9)} ${avg(r.inHits).padStart(15)} ${String(r.hoAdmitted).padStart(18)} ${avg(r.hoHits).padStart(14)}`);
}
for (const v of ["SAME_Q", "Q4_SPLIT"]) console.log(`\n${v} admits, CURRENT refuses (${res[v].moved.length}): ${res[v].moved.join(" ")}`);
if (res.CURRENT.moved.length) console.log(`\nREPLICA DISAGREES WITH SHIPPED filerPrecision: ${res.CURRENT.moved.join(" ")}`);

console.log(`\n${"=".repeat(78)}\nWHY NO RECORD — manifest state`);
for (const s of ["O", "ARM"]) {
  const e = manifest.symbols[s] ?? {};
  console.log(`  ${s}: cik=${e.cik} reportDatesAt=${e.reportDatesAt ? new Date(e.reportDatesAt).toISOString() : e.reportDatesAt} ` +
    `lastEventFiled=${e.lastEventFiled ?? "—"} lastFiled=${e.lastFiled ?? "—"} contentHash=${e.contentHash ? "set" : "null"}`);
}
const noRec = all.filter((s) => !manifest.symbols[s].reportDatesAt).length;
console.log(`  symbols with no reportDatesAt at all: ${noRec} of ${all.length}`);
