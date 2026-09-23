// #535 COWORK #7 — THE REMAINING MEASUREMENTS, READ-ONLY, ONE RUNNER TRIP.
//
//   #6    Net margin > 100%: for every such filer, the newest period's revenue,
//         operating income, pre-tax income, tax and net income — so a genuine
//         below-the-line one-off (a tax valuation-allowance release, a gain)
//         can be told from an incomplete revenue line BY RULE, not by list.
//   #2    CRWD's fiscal-year offset, per 10-K accession (the row the vote kept,
//         its span, its fy), and the filers whose label a candidate fix moves.
//   FX    Filers whose newest period is dropped by the currency step (stored
//         set behind its own companyfacts extraction because no rate reached
//         that period end) — from `fx.refused` and the stored periods.
//   EPS   Filers whose newest quarter has net income but no EPS at all, and for
//         a sample, whether their filing carries EPS only on dimensioned
//         (share-class) contexts.
// relay task: write-spotcheck-census-2
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; spot-check census 2)";
const strip = (f) => fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const EXTRACT = strip("lib/server/secExtract.ts");
const build = (extract) => lift([fs.readFileSync("lib/server/secFields.ts", "utf8"), extract,
  strip("lib/server/fxRates.ts"), strip("lib/server/secCurrency.ts"), strip("lib/server/secFactCodec.ts")].join("\n"));
const X = await build(EXTRACT);
// THE CANDIDATE #2 FIX: an annual filing's reading comes from an ANNUAL row.
// Today the per-accession pick keeps the max-end row whatever its span, so a
// 10-K whose max-end row is its three-month Q4 either drops out of the vote or
// carries that row's reading.
const FIX_FROM = "if (!Number.isFinite(days)) continue;\n          const cur = byAccn.get(r.accn);";
if (!EXTRACT.includes(FIX_FROM)) { console.error("FATAL: #2 fix anchor not found"); process.exit(2); }
const XF = await build(EXTRACT.replace(FIX_FROM,
  "if (!Number.isFinite(days)) continue;\n          if (/^(10-K|20-F|40-F)/.test(r.form) && (days < 330 || days > 400)) continue;\n          const cur = byAccn.get(r.accn);"));

const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (n) => (manifestSrc.match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const manifest = await redis.get(pick("SEC_MANIFEST_KEY"));
const FACTS = pick("SEC_FACTS_PREFIX");
const all = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();
const sets = new Map();
for (let i = 0; i < all.length; i += 50) {
  const b = all.slice(i, i + 50);
  const ss = await Promise.all(b.map((s) => redis.get(`${FACTS}:${s}`)));
  b.forEach((s, k) => { if (ss[k]?.quarters) sets.set(s, ss[k]); });
}
let lastAt = 0;
const get = async (url, as = "json") => {
  const w = Math.max(0, lastAt + 130 - Date.now());
  if (w) await new Promise((r) => setTimeout(r, w));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) return null;
  return as === "json" ? res.json() : res.text();
};
const v = (p, k) => X.valueOf(p, k);
const M = (x) => (x === null || x === undefined ? "—" : `${(x / 1e6).toFixed(1)}M`);
const newestOf = (set) => { const q = set.quarters[0], y = set.years?.[0]; return q && (!y || q.e >= y.e) ? q : y; };

// ── #6 ──────────────────────────────────────────────────────────────────────
console.log(`${"=".repeat(78)}\n#6 NET MARGIN > 100%: WHERE THE EXCESS COMES FROM`);
for (const [s, set] of sets) {
  const p = newestOf(set);
  if (!p) continue;
  const rev = v(p, "revenue"), ni = v(p, "netIncome");
  if (!(rev > 0 && ni !== null && ni / rev > 1)) continue;
  const op = v(p, "operatingIncome"), pre = v(p, "preTaxIncome"), tax = v(p, "incomeTaxExpense");
  const opM = op !== null ? op / rev : null, preM = pre !== null ? pre / rev : null;
  const rule =
    preM !== null && preM <= 1 && tax !== null && tax < 0 ? "ONE-OFF: tax benefit lifts NI past revenue (pre-tax <= revenue)"
      : opM !== null && opM <= 1 && preM !== null && preM > 1 ? "ONE-OFF?: below-the-line gain (operating <= revenue, pre-tax > revenue)"
        : "REVENUE LINE INCOMPLETE: operating or pre-tax income already exceeds revenue, or unread";
  console.log(`  ${s.padEnd(6)} ${p.fp} FY${p.fy} rev ${M(rev)} op ${M(op)} pre-tax ${M(pre)} tax ${M(tax)} NI ${M(ni)} -> ${rule}`);
}

// ── #2 ──────────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(78)}\n#2 FISCAL-YEAR OFFSET, PER ANNUAL ACCESSION`);
const factsCache = new Map();
const cf = async (s) => {
  if (!factsCache.has(s)) factsCache.set(s, await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${manifest.symbols[s].cik}.json`));
  return factsCache.get(s);
};
for (const s of ["CRWD", "SNOW"]) {
  const facts = await cf(s);
  if (!facts) { console.log(`  ${s}: companyfacts unreadable`); continue; }
  const acc = new Map();
  for (const tags of Object.values(facts.facts ?? {})) for (const def of Object.values(tags))
    for (const rows of Object.values(def.units ?? {})) for (const r of rows) {
      if (!r.accn || !r.start || !/^(10-K|20-F|40-F)/.test(r.form ?? "")) continue;
      const days = Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86400000);
      const a = acc.get(r.accn) ?? { form: r.form, fy: r.fy, fp: r.fp, filed: r.filed, maxEnd: "", maxEndSpans: new Set(), annualEnds: new Set() };
      if (r.end > a.maxEnd) { a.maxEnd = r.end; a.maxEndSpans = new Set([days]); } else if (r.end === a.maxEnd) a.maxEndSpans.add(days);
      if (days >= 330 && days <= 400) a.annualEnds.add(r.end);
      acc.set(r.accn, a);
    }
  const rows = [...acc.entries()].sort((a, b) => (a[1].filed < b[1].filed ? 1 : -1)).slice(0, 6);
  console.log(`  ${s}:`);
  for (const [accn, a] of rows) {
    const mid = (end) => X.fiscalMidYear(Date.parse(`${end}T00:00:00Z`));
    console.log(`    ${accn} ${a.form} filed ${a.filed} fy=${a.fy} fp=${a.fp} · max end ${a.maxEnd} spans {${[...a.maxEndSpans].join(",")}}d` +
      ` · offset read ${a.fy - mid(a.maxEnd)} · newest annual end ${[...a.annualEnds].sort().at(-1) ?? "—"}`);
  }
  const anchor = sets.get(s)?.years?.[0]?.e ?? null;
  const now = X.fiscalYearOffset(facts, anchor), fix = XF.fiscalYearOffset(facts, anchor);
  console.log(`    vote shipped: offset ${now.offset} (${now.agreeing}/${now.disagreeing}) · with the fix: offset ${fix.offset} (${fix.agreeing}/${fix.disagreeing})`);
}
console.log(`\n  WHICH FILERS THE FIX RELABELS (year ends Jan-Jun, the only ones it can move):`);
const moved = [];
let seen = 0;
for (const [s, set] of sets) {
  const ye = set.years?.[0]?.e;
  if (!ye || Number(ye.slice(5, 7)) > 6 || !set.quarters[0]) continue;
  const facts = await cf(s);
  if (!facts) continue;
  seen++;
  const a = X.fiscalYearOffset(facts, ye), b = XF.fiscalYearOffset(facts, ye);
  const q = set.quarters[0].e;
  const la = X.fiscalLabel(q, a.yearEnd ?? ye, a), lb = XF.fiscalLabel(q, b.yearEnd ?? ye, b);
  if (la.fy !== lb.fy || la.fp !== lb.fp) moved.push(`${s}: ${la.fp} FY${la.fy} -> ${lb.fp} FY${lb.fy} (offset ${a.offset} -> ${b.offset})`);
}
console.log(`  ${moved.length} of ${seen} change:`);
for (const m of moved) console.log(`    ${m}`);

// ── FX ──────────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(78)}\nFX: NEWEST PERIOD DROPPED BY THE CURRENCY STEP`);
const fxHit = [];
let nonUsd = 0;
for (const [s, set] of sets) {
  if (!set.cur || set.cur === "USD") continue;
  nonUsd++;
  const refused = set.fx?.refused ?? [];
  const newest = [set.quarters[0]?.e, set.years?.[0]?.e].filter(Boolean).sort().at(-1) ?? "";
  const lost = refused.filter((e) => e > newest).sort();
  const applied = (set.fx?.applied ?? []).map((a) => a.end).sort();
  if (lost.length) fxHit.push(`${s.padEnd(6)} ${set.cur} · stored newest ${newest || "none"} · refused newer: ${lost.slice(-3).join(", ")} · rates applied to ${applied.at(-1) ?? "—"} · source ${set.fx?.source ?? "—"}`);
}
console.log(`  ${fxHit.length} of ${nonUsd} non-USD filers lose a newer period to a missing rate`);
for (const l of fxHit) console.log(`  ${l}`);

// ── EPS ─────────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(78)}\nEPS: NET INCOME BUT NO EPS ON THE NEWEST QUARTER`);
const noEps = [];
for (const [s, set] of sets) {
  const q = set.quarters[0];
  if (!q || /^Q4$/.test(q.fp ?? "")) continue; // a derived Q4 never carries EPS, by design
  if (v(q, "netIncome") !== null && v(q, "epsDiluted") === null && v(q, "epsBasic") === null) noEps.push(s);
}
console.log(`  ${noEps.length} filers: ${noEps.join(" ")}`);
console.log(`\n  sample: where does their EPS live in the filing? (first 12)`);
for (const s of noEps.slice(0, 12)) {
  const subs = await get(`https://data.sec.gov/submissions/CIK${manifest.symbols[s].cik}.json`);
  const r = subs?.filings?.recent;
  const i = r ? r.form.findIndex((f) => f === "10-Q" || f === "10-K") : -1;
  if (i < 0) { console.log(`    ${s}: no 10-Q/10-K`); continue; }
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(manifest.symbols[s].cik)}/${r.accessionNumber[i].replace(/-/g, "")}`;
  const idx = await get(`${base}/index.json`);
  const inst = (idx?.directory?.item ?? []).map((x) => x.name).find((n) => /_htm\.xml$/i.test(n));
  const xml = inst ? await get(`${base}/${inst}`, "text") : null;
  if (!xml) { console.log(`    ${s}: no instance`); continue; }
  const dimCtx = new Set([...xml.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)]
    .filter((m) => /segment|scenario/.test(m[2])).map((m) => m[1]));
  const eps = [...xml.matchAll(/<[\w-]+:(EarningsPerShare\w+)\b[^>]*contextRef="([^"]+)"/g)];
  const plain = eps.filter((m) => !dimCtx.has(m[2])).length, dim = eps.length - plain;
  const axes = [...new Set([...xml.matchAll(/dimension="([^"]+)"/g)].map((m) => m[1]).filter((d) => /Class|Stock|Share/i.test(d)))].slice(0, 3);
  console.log(`    ${s}: ${r.form[i]} ${r.filingDate[i]} · EPS facts plain ${plain} / dimensioned ${dim}${axes.length ? ` · class axes ${axes.join(", ")}` : ""}`);
}
