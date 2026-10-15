// RE-AUDIT OF PR 1's EPS GATE, AND THE SPLIT ADJUSTMENT ON CVNA (#552 COWORK #245). Reads only.
//   relay task: write-eps-gate-reaudit   (SYMBOLS = the gated sets)
//
// For each symbol, on live companyfacts:
//   REMOVED  every cell the gate removes: main's extractor with the gate vs the
//            same extractor with it disabled (the PR 1 before/after, reproduced);
//   FILED    every undimensioned EPS row companyfacts holds for that exact frame,
//            each with its accession and filed date (a restated comparative shows
//            as a second value);
//   Q4       for a Q4 cell: the fiscal year's filed EPS less Q1-Q3's filed EPS;
//   BASIS    a split / consolidation / ADR-ratio change in the window: the
//            extractor's shareRestated (asr) and its whole-ratio match, the
//            filer's StockSplitConversionRatio facts, the ADS ratio file, and the
//            stored share series' largest step;
//   SPLIT    the stored set's proven splits and per-period factors (secSplitAdjust).
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Redis } from "@upstash/redis";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; eps gate re-audit)";
const SYMBOLS = (process.env.SYMBOLS || "CVNA,AIG,AMBP,BB,BCE,BULL,GSHD,IMTX,MAIN,MKL,PENG,QNME,TRLV").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const keyOf = (f, n) => (fs.readFileSync(f, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const imp = (rel) => import(pathToFileURL(path.join(process.cwd(), rel)).href);
const SA = await imp("lib/server/secSplitAdjust.ts");
const SH = await imp("lib/server/secShareHistory.ts");

const read = (p) => fs.readFileSync(p, "utf8");
const src = () => {
  const cur = read("lib/server/secCurrency.ts").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
  const ex = read("lib/server/secExtract.ts").replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "").replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
  return [read("lib/server/secFields.ts"), read("lib/server/fxRates.ts"), cur, ex];
};
const [F, FX, CUR, EX] = src();
const GATE = "    const closes = ratioCloses(field.key, numerator, denominator);";
if (EX.split(GATE).length !== 2) { console.error("FATAL: gate anchor"); process.exit(2); }
const WITH = await lift(`${F}\n${FX}\n${CUR}\n${EX}`);
const WITHOUT = await lift(`${F}\n${FX}\n${CUR}\n${EX.replace(GATE, "    const closes = true;")}`);
const K = WITH.SEC_FIELD_KEYS;
const I = (k) => K.indexOf(k);

const PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const manifest = await redis.get(keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"));
const ADS = JSON.parse(read("data/sec/ads-ratios.json"));
const adsOf = (s) => (ADS.entries ?? ADS)[s] ?? null;
let lastAt = 0;
const get = async (url) => {
  for (let a = 0; a < 3; a++) {
    const wait = Math.max(0, lastAt + 140 - Date.now()); if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    try { const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } }); if (res.ok) return res.json(); if (res.status === 404) return null; } catch {}
    await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
  }
  return null;
};
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
let cmds = 1;

for (const sym of SYMBOLS) {
  const cik = manifest.symbols[sym]?.cik;
  console.log(`\n######## ${sym}`);
  if (!cik) { console.log("  no cik"); continue; }
  const facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`);
  if (!facts) { console.log("  companyfacts fetch failed"); continue; }
  const a = WITH.extractCompanyFacts(sym, facts), b = WITHOUT.extractCompanyFacts(sym, facts);
  const ns = Object.keys(facts.facts ?? {}).filter((n) => n !== "dei");
  const rowsOf = (tag) => ns.flatMap((n) => Object.entries(facts.facts[n]?.[tag]?.units ?? {}).flatMap(([u, rows]) => rows.map((r) => ({ ...r, unit: u }))));
  const filedEps = (start, end, tag) => rowsOf(tag).filter((r) => r.end === end && r.start && Math.abs(days(r.start, start)) <= 7);
  // BASIS
  const asr = a.shareRestated ?? [];
  console.log(`  BASIS asr ${asr.length ? asr.map(([e, r]) => `${e}:x${r.toFixed(3)}${SH.splitRatioOf(r) ? `(ratio ${SH.splitRatioOf(r)})` : ""}`).join(" ") : "none"} · ADS ${JSON.stringify(adsOf(sym))?.slice(0, 120) ?? "none"}`);
  const splitRows = rowsOf("StockholdersEquityNoteStockSplitConversionRatio1").concat(rowsOf("StockholdersEquityReverseStockSplit"));
  if (splitRows.length) console.log(`  BASIS split facts: ${[...new Set(splitRows.map((r) => `${r.end ?? r.start}=${r.val}`))].join(" ")}`);
  const sh = [...a.quarters].sort((x, y) => x.end.localeCompare(y.end)).slice(-8).map((p) => [p.end, p.values[I("sharesDiluted")]?.val ?? p.values[I("sharesBasic")]?.val ?? null]).filter((x) => x[1]);
  let step = null;
  for (let k = 1; k < sh.length; k++) { const r = sh[k][1] / sh[k - 1][1]; if (!step || Math.abs(Math.log(r)) > Math.abs(Math.log(step.r))) step = { r, at: sh[k][0] }; }
  console.log(`  BASIS share series (newest 8q): ${sh.map(([e, v]) => `${e}=${(v / 1e6).toFixed(1)}M`).join(" ")}${step ? ` · largest step x${step.r.toFixed(2)} at ${step.at}` : ""}`);
  // SPLIT (stored set)
  const set = await redis.get(`${PREFIX}:${sym}`); cmds++;
  if (set?.quarters) {
    const ps = SA.provenSplits(set), fx = SA.splitFactors(set);
    console.log(`  SPLIT stored asr ${JSON.stringify(set.asr ?? null)} · proven ${JSON.stringify(ps)} · factors ${JSON.stringify([...fx])}`);
  }
  // REMOVED cells + evidence
  const eps = I("epsDiluted"), epb = I("epsBasic");
  for (const p of b.quarters) {
    const q = a.quarters.find((x) => x.end === p.end);
    for (const [i, tag, alt] of [[eps, "EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"], [epb, "EarningsPerShareBasic", "EarningsPerShareBasicAndDiluted"]]) {
      const before = p.values[i], after = q?.values[i];
      if (!before || before.derived !== "computed" || after?.val != null) continue;
      const start = p.start;
      const filed = [...filedEps(start, p.end, tag), ...filedEps(start, p.end, alt)];
      const fv = filed.map((r) => `${r.val}(${r.form} ${r.filed})`).join(", ") || "none";
      let q4 = "";
      if (p.fp === "Q4") {
        const fy = rowsOf(tag).filter((r) => r.end === p.end && r.start && days(r.start, r.end) > 340).sort((x, y) => (y.filed ?? "").localeCompare(x.filed ?? ""))[0];
        const qs = ["Q1", "Q2", "Q3"].map((fp) => a.quarters.find((x) => x.fy === p.fy && x.fp === fp)?.values[i]?.val ?? null);
        q4 = fy && qs.every((v) => v != null) ? ` · FY ${fy.val} less Q1-Q3 ${qs.join("+")} = ${(fy.val - qs.reduce((s, v) => s + v, 0)).toFixed(4)}` : ` · FY-Q1..Q3 n/a (FY ${fy?.val ?? "none"}, Q1-Q3 ${qs.join(",")})`;
      }
      const shares = p.values[i === eps ? I("sharesDiluted") : I("sharesBasic")]?.val ?? null;
      console.log(`  REMOVED ${p.fp}${p.fy} ${start}..${p.end} ${K[i]} ${before.val.toFixed(4)} = NI ${(p.values[I("netIncome")]?.val / 1e6).toFixed(1)}M / ${(shares / 1e6).toFixed(1)}M · filed: ${fv}${q4}`);
    }
  }
  const note = (a.notes ?? []).find((n) => /does not close/.test(n));
  if (note) {
    // Which filed periods failed to close, and by how much.
    const why = [];
    for (const kind of ["quarters", "years"]) for (const p of [...a[kind]].sort((x, y) => y.end.localeCompare(x.end)).slice(0, kind === "quarters" ? 8 : 4)) {
      const e = p.values[eps], n = p.values[I("netIncome")]?.val, s = p.values[I("sharesDiluted")]?.val;
      if (e?.derived === "as-filed" && e.val && n && s) { const r = n / (e.val * s); if (Math.abs(r - 1) > 0.1) why.push(`${kind[0]}${p.end}:${r.toFixed(2)}`); }
    }
    console.log(`  GATE tripped on: ${why.join(" ") || "(basic only)"}`);
  }
}
console.log(`\nRedis commands: ${cmds}`);
