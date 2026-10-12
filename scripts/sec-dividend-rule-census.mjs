// THE DIVIDEND-BASIS RULES, CENSUSED (#552 COWORK #208). READ-ONLY.
// Every stored set through THIS BRANCH's splitAdjusted (which now carries the
// dividend-basis pass), against the same set pre-stamped `dvr` (the pass
// skipped = today's behaviour):
//   1. the #226 counts again (ratio buckets, rate filers, differenced cells);
//   2. what each rule withholds, by filer; anything outside the #226 lists;
//   3. CEG, BKNG, WMT: every annual-DPS reader, before and after;
//   4. the semi-annual eleven: each one's filed 3/6/9/12-month DPS frames
//      (one SEC companyfacts request each, ≤ 2/s).
// Store: SCAN, MGET, and one HMGET of the newest-close hash. Nothing else.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);
const READS = new Set(["scan", "mget", "hmget"]);
const counts = {};
let secCalls = 0;
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
  } else if (/^https:\/\/data\.sec\.gov\/api\/xbrl\/companyfacts\/CIK\d{10}\.json$/.test(url)) {
    if (++secCalls > 11) throw new Error("read guard: SEC request cap");
  } else if (!url.startsWith("data:")) throw new Error("read guard: host refused");
  return realFetch(input, init);
};
const { cell } = await import("../lib/server/secFactCodec.ts");
const { splitAdjusted } = await import("../lib/server/secSplitAdjust.ts");
const { buildProfileDividend } = await import("../lib/server/secDividend.ts");
const { buildSecPickerRow, dividendRead } = await import("../lib/server/pickersSecFundamentals.ts");
const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
if (!FACTS) { console.error("FATAL: the facts prefix moved"); process.exit(2); }
const CUT = new Set(JSON.parse(fs.readFileSync("data/due-strip.json", "utf8")).symbols);
const redis = Redis.fromEnv();
const keys = [];
let cursor = "0";
do { const [next, batch] = await redis.scan(cursor, { match: `${FACTS}:*`, count: 1000 }); cursor = String(next); keys.push(...batch); } while (cursor !== "0");

const DPS = "dividendsDeclaredPerShare";
const ROUND4 = true;
const f4 = (v) => (typeof v === "number" ? v.toFixed(4) : "—");
const SKIP = { rate: null, quarters: [], years: [] };
const before = (filed) => splitAdjusted({ ...filed, dvr: SKIP });
const R226 = { rate: "BKNG WMT MSGS HP MBIN SAIC TRS V WTM PAYC LEA IIIN OGN SFBS AA AEIS AGM ASO CDRE CEG H JBHT JJSF LPX MTH OFG TNET VIRT VSTS".split(" "),
  semi: "HEI IBOC OVLY FDX GHC NI ALGT CLX MRSH BORR HPQ".split(" ") };
const bucket = { rate: [], semi: [], running: [], other: [] };
const rows = [], keep = new Map();
let sets = 0;
for (let i = 0; i < (ROUND4 ? 0 : keys.length); i += 20) {
  const chunk = keys.slice(i, i + 20);
  const raw = await redis.mget(...chunk);
  chunk.forEach((k, j) => {
    const filed = raw[j];
    if (!filed?.quarters?.length || !filed?.years?.length) return;
    sets++;
    const sym = k.slice(FACTS.length + 1);
    if (["CEG", "BKNG", "WMT", ...R226.semi].includes(sym)) keep.set(sym, filed);
    const b = before(filed), a = splitAdjusted(filed);
    // #226's classification, unchanged, on the before set.
    const years = [...b.years].sort((x, y) => (x.e < y.e ? 1 : -1));
    for (const y of years) {
      const fy = cell(y, DPS);
      if (fy.derived !== "as-filed" || !(fy.val > 0) || y.fy == null) continue;
      const c1 = cell(b.quarters.find((p) => p.fy === y.fy && p.fp === "Q1"), DPS);
      if (c1.derived !== "as-filed" || !(c1.val > 0)) continue;
      const r = fy.val / c1.val;
      bucket[r >= 0.8 && r <= 1.25 ? "rate" : r >= 1.7 && r <= 2.4 ? "semi" : r >= 3.2 && r <= 5 ? "running" : "other"].push(sym);
      break;
    }
    if (!a.dvr) return;
    const val = (s, which, e) => cell(s[which].find((p) => p.e === e), DPS).val;
    const q = a.dvr.quarters.map((e) => {
      const p = b.quarters.find((x) => x.e === e);
      return `FY${p.fy} ${p.fp} ${f4(val(b, "quarters", e))}`;
    });
    const y = a.dvr.years.map((e) => `FY${b.years.find((x) => x.e === e).fy} ${f4(val(b, "years", e))}`);
    // THE CLASSING YEAR IN FULL (round 2): a filer that declares the whole year
    // in Q1 files $0 quarters after it, and its year is then a real total.
    const yrQ = a.dvr.rate ? b.quarters.filter((p) => p.fy === a.dvr.rate.fy).sort((x, z) => (x.e < z.e ? -1 : 1))
      .map((p) => { const c = cell(p, DPS); return `${p.fp} ${f4(c.val)}${c.derived === "as-filed" ? " F" : c.derived === "differenced" ? " D" : ""}`; }).join(", ") : "";
    const filedZeroQ = a.dvr.rate ? b.quarters.filter((p) => { const c = cell(p, DPS); return c.derived === "as-filed" && c.val === 0; }).length : 0;
    rows.push({ sym, cut: CUT.has(sym), rate: a.dvr.rate, q, y, yrQ, filedZeroQ, nonPos: a.dvr.quarters.filter((e) => !(val(b, "quarters", e) > 0)).length });
  });
}
const rate = rows.filter((r) => r.rate), split = rows.filter((r) => !r.rate);
console.log(`stored sets with quarters and years: ${sets}`);
console.log(`#226 buckets again: rate ${bucket.rate.length} · semi-annual-like ${bucket.semi.length} · running ${bucket.running.length} · other ${bucket.other.length}`);
console.log(`\nRULES 1–2, RATE FILERS (${rate.length}): quarters withheld ${rate.reduce((s, r) => s + r.q.length, 0)} (≤ 0 before: ${rate.reduce((s, r) => s + r.nonPos, 0)}) · years withheld ${rate.reduce((s, r) => s + r.y.length, 0)}`);
for (const r of rate.sort((x, y) => (x.sym < y.sym ? -1 : 1)))
  console.log(`  ${r.sym}${r.cut ? "*" : ""} (FY${r.rate.fy} ${r.rate.ratio.toFixed(2)}×${R226.rate.includes(r.sym) ? "" : ", NEW vs #226"}): classing year's quarters [${r.yrQ}] · as-filed $0 quarters stored: ${r.filedZeroQ}`);
console.log(`  in #226's 29 but not withheld now: ${R226.rate.filter((s) => !rate.some((r) => r.sym === s)).join(" ") || "none"}`);
console.log(`\nRULE 3 ONLY, ACROSS A SPLIT (${split.length} filers, ${split.reduce((s, r) => s + r.q.length, 0)} quarters):`);
for (const r of split) console.log(`  ${r.sym}${r.cut ? "*" : ""}: ${r.q.join("; ")}`);
console.log(`  (rate filers' quarters across a split are counted under rules 1–2 above)`);

if (!ROUND4) {
// ── 3. the three names, every annual-DPS reader ──
const closes = await redis.hmget("msh:tiingo:eod-last:v1", "CEG", "BKNG", "WMT");
const closeOf = (sym) => { const v = closes?.[sym]; const o = typeof v === "string" ? JSON.parse(v) : v; return Number(o?.close ?? o?.c ?? o?.adjClose ?? NaN); };
console.log(`\nREADERS, BEFORE → AFTER (today 2026-10-12)`);
for (const sym of ["CEG", "BKNG", "WMT"]) {
  const filed = keep.get(sym);
  if (!filed) { console.log(`  ${sym}: no stored set`); continue; }
  const px = closeOf(sym);
  const show = (set) => {
    const prof = buildProfileDividend(set);
    const row = buildSecPickerRow(set, "2026-10-12", {}, Date.now());
    const rd = dividendRead(splitAdjusted(set));
    const y0 = splitAdjusted(set).years[0];
    return `profile ${prof.state === "declared" ? `${f4(prof.perShare)} (${prof.periodLabel}${prof.carriedForward ? ", carried" : ""})` : prof.state}` +
      ` · year DPS ${y0 ? `FY${y0.fy} ${f4(cell(y0, DPS).val)}` : "—"}` +
      ` · Div $ ${f4(row.divPerShare)} · yield ${row.divPerShare != null && px > 0 ? ((row.divPerShare / px) * 100).toFixed(2) + "%" : "—"}` +
      ` · growth ${row.divGrowth == null ? "—" : row.divGrowth.toFixed(1) + "%"}` +
      ` · payout ${row.payout ? `${row.payout.val.toFixed(1)}% (${row.payout.basis})` : "—"}` +
      ` · four quarters ${rd.four ? f4(rd.four.regular) : "—"}`;
  };
  console.log(`  ${sym} (close ${Number.isFinite(px) ? px.toFixed(2) : "?"})\n    before: ${show({ ...filed, dvr: SKIP })}\n    after:  ${show(filed)}`);
  const qs = splitAdjusted(filed).quarters.slice(0, 6).map((p) => `FY${p.fy} ${p.fp} ${f4(cell(p, DPS).val)}${cell(p, DPS).derived === "withheld" ? " W" : cell(p, DPS).derived === "differenced" ? " D" : ""}`);
  console.log(`    quarters after: ${qs.join(" · ")}`);
}

}
// ── 4. the semi-annual eleven's filed frames ──
console.log(`\nSEMI-ANNUAL ELEVEN: filed DPS frames (newest two fiscal years), months → value [form]`);
const cikMap = JSON.parse(fs.readFileSync("data/cik-map.json", "utf8"));
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (read-only census)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Round 4: HEI only. Round 1 took the first tag with any frames (Declared,
// last filed FY2013); the tag with the NEWEST frame is the one in use.
for (const sym of ["HEI"]) {
  const cik = cikMap[sym] ? String(cikMap[sym]).padStart(10, "0") : null;
  if (!cik) { console.log(`  ${sym}: no CIK`); continue; }
  await sleep(500);
  let facts;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
    facts = await res.json();
  } catch (e) { console.log(`  ${sym}: fetch failed (${e.message})`); continue; }
  const g = facts?.facts?.["us-gaap"] ?? {};
  const newest = (c) => Math.max(0, ...(g[c]?.units?.["USD/shares"] ?? []).map((f) => Date.parse(f.end) || 0));
  const concept = ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"].filter((c) => newest(c) > 0).sort((a, b) => newest(b) - newest(a))[0];
  if (!concept) { console.log(`  ${sym}: no DPS concept`); continue; }
  // Each fact once, in the filing that first reported it (the period's own filing).
  const first = new Map();
  for (const f of g[concept].units["USD/shares"]) {
    if (!f.start || !f.end) continue;
    const k = `${f.start}|${f.end}`;
    if (!first.has(k) || f.filed < first.get(k).filed) first.set(k, f);
  }
  const all = [...first.values()].map((f) => ({ ...f, m: Math.round((Date.parse(f.end) - Date.parse(f.start)) / (30.44 * 864e5)) }));
  const years = [...new Set(all.filter((f) => f.m >= 11).map((f) => f.end))].sort().slice(-2);
  const lines = years.map((ye) => {
    const ys = all.find((f) => f.end === ye && f.m >= 11).start;
    const inYear = all.filter((f) => f.start >= ys && f.end <= ye).sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : a.m - b.m));
    return `FY to ${ye}: ` + inYear.map((f) => `${f.m}m to ${f.end.slice(5)} ${f.val} [${f.form}]`).join(" · ");
  });
  const stored = keep.get(sym);
  const sq = stored ? splitAdjusted(stored).quarters.slice(0, 4).map((p) => `FY${p.fy} ${p.fp} ${f4(cell(p, DPS).val)}${cell(p, DPS).derived === "differenced" ? " D" : ""}`).join(" · ") : "no stored set";
  console.log(`  ${sym} (${concept.replace("CommonStockDividendsPerShare", "")}):\n    ${lines.join("\n    ")}\n    stored quarters: ${sq}`);
}
console.log(`\nStore commands: ${JSON.stringify(counts)} · SEC requests: ${secCalls}`);
