// READ-ONLY MEASUREMENT (#552 COWORK #89): the corrected dilution series on
// every stored symbol, rebuilt from the R2 archive with THIS branch's extractor
// (so the split evidence `asr` is present), against the raw series the page
// draws today. Also prints the first periodic report per symbol (archived
// submissions, CIK + predecessor) for data/sec/first-periodic.json.
// SEC values (share counts, dates) and tickers only. Redis: read commands only.
// SEC requests: 0.
//   workflow: sec-archive.yml task "dilution-series" (probe branch only)
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import zlib from "node:zlib";
import { r2Client, decodeFacts, rowsToFacts } from "../lib/secArchive.mjs";

const { extractForSymbol } = await import("../lib/server/secExtractFor.ts");
const { withPredecessorFacts, predecessorCikFor } = await import("../lib/server/secSuccession.ts");
const { toStoredSet } = await import("../lib/server/secFactBuild.ts");
const { defaultSources } = await import("../lib/server/fxRates.ts");
const SH = await import("../lib/server/secShareHistory.ts");
const keyOf = (n) => (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(new RegExp(`export const ${n} = "([^"]+)"`)) ?? [])[1];
const INDEX = keyOf("SEC_FACTS_INDEX_KEY"), MANIFEST = keyOf("SEC_MANIFEST_KEY");
const URL_ = process.env.UPSTASH_REDIS_REST_URL, TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
let cmds = 0, r2reads = 0;
async function redis(cmd) {
  cmds++;
  const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await res.json(); if (j.error) throw new Error("Upstash error"); return j.result;
}
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const r2 = r2Client();
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const archiveFacts = async (cik) => {
  const buf = await r2.get(`facts/${String(cik).padStart(10, "0")}.ndjson.br`); r2reads++;
  if (!buf) return null;
  const { header, rows } = decodeFacts(buf);
  return rowsToFacts(header, rows);
};
const PERIODIC = /^(10-K|10-Q|20-F|40-F|10-KT|10-QT)$/;
async function firstPeriodic(cik) {
  let best = null;
  const buf = await r2.get(`submissions/${String(cik).padStart(10, "0")}.json.gz`); r2reads++;
  if (!buf) return null;
  const { main, pages } = JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
  for (const t of [main?.filings?.recent, ...(pages ?? [])]) {
    if (!t?.form) continue;
    t.form.forEach((f, i) => {
      if (!PERIODIC.test(f)) return;
      const filed = t.filingDate?.[i], rep = t.reportDate?.[i];
      if (filed && (!best || filed < best.filed)) best = { filed, report: rep || null };
    });
  }
  return best;
}
const dir = (a, b) => { const p = ((b - a) / a) * 100; return p > 0.05 ? "up" : p < -0.05 ? "down" : "flat"; };

const symbols = ((await redis(["SMEMBERS", INDEX])) ?? []).map(String).sort();
const manifest = parse(await redis(["GET", MANIFEST])) ?? { symbols: {} };
const fx = new Map();
let keptIssuance = 0; const keptEx = [];
const T = { symbols: symbols.length, rawCharted: 0, newCharted: 0, splitAdjusted: 0, started: {}, gaps: 0, three: 0, tooShort: 0, matrix: {}, err: 0, fp: 0, residualSplit: 0, residualScale: 0 };
const ex = { split: [], started: {}, gaps: [], residual: [], gapTrace: [], lost: [] };
const push = (a, s, n = 40) => a.length < n && a.push(s);
const priLines = [];
const SHOW = new Set(["NOW", "NFLX", "BKNG", "CRWD", "GDDY", "AMZN", "PAC", "NVDA", "KO", "AAPL", "AVGO", "MSFT", "ONDS", "LYV", "EPD", "OFLX", "SKM", "ALMU", "BRTX", "LFWD", "PNFP"]);
const fpLines = [];
for (const sym of symbols) {
  const cik = manifest.symbols?.[sym]?.cik ?? REG[sym]?.cik ?? null;
  if (!cik) continue;
  try {
    const facts = await archiveFacts(cik);
    if (!facts || !Object.keys(facts.facts ?? {}).length) continue;
    const merged = await withPredecessorFacts(cik, { ...facts, cik: Number(cik) }, async (pred) => (await archiveFacts(pred)) ?? { cik: Number(pred), facts: {} });
    const set = await toStoredSet(extractForSymbol(sym, merged), defaultSources(), fx);
    const pred = predecessorCikFor(String(cik).padStart(10, "0"));
    const fps = [await firstPeriodic(cik), pred ? await firstPeriodic(pred) : null].filter(Boolean).sort((a, b) => (a.filed < b.filed ? -1 : 1));
    const fp = fps[0] ?? null;
    const listedFrom = fp ? fp.report ?? fp.filed : null;
    const raw = SH.rawShareSeries(set);
    if (raw) T.rawCharted++;
    if (raw && listedFrom && raw.points[0].date < listedFrom) { fpLines.push(`FP\t${sym}\t${listedFrom}`); T.fp++; }
    const lf = raw && listedFrom && raw.points[0].date < listedFrom ? listedFrom : null;
    const h = SH.buildShareHistory(set, { listedFrom: lf });
    // How many split-like steps the re-filed evidence kept as real issuance.
    if (raw) {
      const without = SH.correctShareSeries(raw.points, set.asr ?? [], lf, []);
      const withF = SH.correctShareSeries(raw.points, set.asr ?? [], lf, set.asf ?? []);
      if (withF.points.length > without.points.length) { keptIssuance++; push(keptEx, sym); }
    }
    // WHAT THE REFRESH CHANGES: the chart with and without the new extras.
    {
      const bare = SH.buildShareHistory({ ...set, asr: undefined, asf: undefined }, { listedFrom: lf });
      if (JSON.stringify(bare) !== JSON.stringify(h)) priLines.push(`PRI\t${sym}`);
    }
    if (h?.withheld) { T.withheld = (T.withheld ?? 0) + 1; push((ex.withheld ??= []), `${sym}(${h.withheld.factor === null ? "no cover" : `×${h.withheld.factor.toPrecision(3)}`})`, 80); continue; }
    if (raw && !h) push(ex.lost, sym, 60);
    if (raw && !h && SHOW.has(sym)) {
      const f = SH.correctShareSeries(raw.points, set.asr ?? [], lf, set.asf ?? []);
      console.log(`  ${sym} (no chart): raw ${raw.points.map((p) => `${p.date}=${p.shares}`).join(" ")} | kept ${f.points.map((p) => p.date).join(" ")} | started ${JSON.stringify(f.startedAfter ?? null)} | listed ${listedFrom} | asr ${JSON.stringify(set.asr ?? [])} | asf ${JSON.stringify(set.asf ?? [])}`);
    }
    if (!h) continue;
    T.newCharted++;
    if (h.dropped?.length) { T.dropped = (T.dropped ?? 0) + 1; push((ex.dropped ??= []), `${sym}(${h.dropped.join(",")})`); }
    if (h.splits?.length) { T.splitAdjusted++; push(ex.split, `${sym}(${h.splits.map((x) => `${x.ratio >= 1 ? x.ratio : `1/${Math.round(1 / x.ratio)}`}@${x.date}`).join(",")})`); }
    if (h.startedAfter) { const r = h.startedAfter.reason; T.started[r] = (T.started[r] ?? 0) + 1; push((ex.started[r] ??= []), sym); }
    if (h.gaps?.length) {
      T.gaps++; push(ex.gaps, sym);
      // GAP TRACE: weighted-average share concepts with a full-year row ending inside the gap.
      if (ex.gapTrace.length < 25) {
        const found = new Set();
        for (const g of h.gaps) for (const [ns, concepts] of Object.entries(merged.facts ?? {})) for (const [name, c] of Object.entries(concepts)) {
          if (!/WeightedAverage/i.test(name)) continue;
          for (const rows of Object.values(c.units ?? {})) for (const r of rows) {
            if (!r.start || !r.end || r.end <= g.from || r.end >= g.to) continue;
            const d = (Date.parse(r.end) - Date.parse(r.start)) / 86400000;
            if (d > 340 && d < 380) found.add(`${ns}:${name}`);
          }
        }
        ex.gapTrace.push(`${sym} [${h.gaps.map((g) => `${g.from}..${g.to}`).join(" ")}]: ${[...found].join(", ") || "no full-year weighted-average row in the gap"}`);
      }
    }
    const steps = h.points.slice(1).map((p, n) => p.shares / h.points[n].shares);
    if (steps.some((r) => r > 100 || r < 0.01)) { T.residualScale++; push(ex.residual, `${sym}:scale`); }
    else if (steps.some((r) => SH.splitRatioOf(r) !== null)) { T.residualSplit++; push(ex.residual, `${sym}:split`); }
    const ty = h.threeYear;
    if (ty && ty.pct !== null) {
      T.three++;
      const all = dir(h.points[0].shares, h.points.at(-1).shares);
      const rec = ty.pct > 0.05 ? "up" : ty.pct < -0.05 ? "down" : "flat";
      const k = `${all}->${rec}`; T.matrix[k] = (T.matrix[k] ?? 0) + 1;
    } else T.tooShort++;
    if (SHOW.has(sym)) console.log(`  ${sym}: ${h.points.map((p) => `${p.date}=${p.shares}`).join(" ")} | splits ${JSON.stringify(h.splits ?? [])} | started ${JSON.stringify(h.startedAfter ?? null)} | gaps ${JSON.stringify(h.gaps ?? [])} | 3y ${ty?.pct ?? ty?.reason} | listed ${listedFrom} | asr ${JSON.stringify(set.asr ?? [])}`);
  } catch (e) {
    T.err++;
    if (T.err <= 5) console.log(`  error ${sym}: ${String(e?.message ?? e).replace(/https?:\/\/\S+/g, "<url>").slice(0, 100)}`);
  }
}
console.log(`\nSymbols ${T.symbols}; charted today (raw) ${T.rawCharted}; charted after the fix ${T.newCharted}; errors ${T.err}`);
console.log(`Split-like steps kept as real issuance (earlier period re-filed unchanged): ${keptIssuance}: ${keptEx.join(" ")}`);
console.log(`Split steps scaled from the filer's restatements: ${T.splitAdjusted}: ${ex.split.join(" ")}`);
for (const [r, n] of Object.entries(T.started)) console.log(`Series starting later (${r}): ${n}: ${(ex.started[r] ?? []).join(" ")}`);
console.log(`No chart after the fix (fewer than 3 points left): ${ex.lost.length}: ${ex.lost.join(" ")}`);
console.log(`Residual steps after the fix (should be 0): split ${T.residualSplit}, scale ${T.residualScale}: ${ex.residual.join(" ")}`);
console.log(`Not drawn, units unconfirmed: ${T.withheld ?? 0}: ${(ex.withheld ?? []).join(" ")}`);
console.log(`Series with single mis-scaled filings left out: ${T.dropped ?? 0}: ${(ex.dropped ?? []).join(" ")}`);
console.log(`Series with a gap >15 months (line broken): ${T.gaps}: ${ex.gaps.join(" ")}`);
console.log(`Gap trace:\n${ex.gapTrace.map((l) => `  ${l}`).join("\n")}`);
console.log(`3-year figure: ${T.three}; too short: ${T.tooShort}; since-first -> 3y direction: ${JSON.stringify(T.matrix)}`);
console.log(`First periodic report lines (series starting before it): ${T.fp}`);
for (const l of fpLines) console.log(l);
console.log(`Charts the refresh changes (re-read priority): ${priLines.length}`);
for (const l of priLines) console.log(l);
console.log(`\nRedis commands ${cmds} (reads only) · R2 reads ${r2reads} · SEC requests 0`);
