// COWORK #2 (#535) ITEMS 2, 3 AND 6, ACROSS THE WHOLE MANIFEST — MEASURE ONLY.
//
//   #3  Why do long-established regular filers read "no pattern"? Every
//       record is run through the SHIPPED outlook (loadOutlookGraph, the real
//       module graph) and the refusals are tallied by reason, with the
//       record's own shape beside the named spot-check symbols.
//   #6  Newest-period net margin above 100%, from the stored sets, with the
//       revenue concept the filer's column uses.
//   #2  Fiscal-year label vs the FILER'S OWN: for every set whose fiscal year
//       ends January-June (the only year-ends where the naming can move), the
//       stored newest-quarter FY against the fy SEC's rows carry for the same
//       period end in the first 10-Q/10-K that reported it.
//
// Read-only: GETs against Redis (read-only token) and SEC; writes nothing.
//   relay task: write-spotcheck-census
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { loadOutlookGraph } from "./lib/outlook-module.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const TODAY = new Date().toISOString().slice(0, 10);
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; spot-check census)";
const strip = (f) => fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const X = await lift([fs.readFileSync("lib/server/secFields.ts", "utf8"), strip("lib/server/secExtract.ts"),
  strip("lib/server/secFactCodec.ts")].join("\n"));

const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (n) => (manifestSrc.match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const MANIFEST = pick("SEC_MANIFEST_KEY");
const FACTS = pick("SEC_FACTS_PREFIX");
const DATES = (fs.readFileSync("lib/server/secReportDatesStore.ts", "utf8")
  .match(/SEC_REPORT_DATES_PREFIX = "([^"]+)"/) ?? [])[1];
const manifest = await redis.get(MANIFEST);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const all = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();
const NAMED = ["GOOGL", "KO", "O", "ARM", "CRWD", "SNOW", "HOOD", "XOM", "SOFI"];

const sets = new Map(), recs = new Map();
for (let i = 0; i < all.length; i += 50) {
  const b = all.slice(i, i + 50);
  const [ss, rr] = await Promise.all([
    Promise.all(b.map((s) => redis.get(`${FACTS}:${s}`))),
    Promise.all(b.map((s) => redis.get(`${DATES}:${s}`))),
  ]);
  b.forEach((s, k) => {
    if (ss[k]?.quarters) sets.set(s, ss[k]);
    if (rr[k] && Array.isArray(rr[k].events)) recs.set(s, rr[k]);
  });
}
console.log(`${all.length} SYMBOLS · ${sets.size} fact sets · ${recs.size} report-date records · today ${TODAY}`);

// ── #3 ──────────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(78)}\n#3 OUTLOOK BY KIND / REASON (shipped outlookFrom over every record)`);
const g = await loadOutlookGraph();
const tally = new Map();
const byReason = new Map();
for (const s of all) {
  const o = g.mod.outlookFrom(s, recs.get(s) ?? null, TODAY);
  const k = o.kind === "no-estimate" ? `no-estimate:${o.reason}` : o.kind;
  tally.set(k, (tally.get(k) ?? 0) + 1);
  if (o.kind === "no-estimate") (byReason.get(o.reason) ?? byReason.set(o.reason, []).get(o.reason)).push(s);
}
for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(34)} ${n}`);
for (const [r, list] of byReason) console.log(`  ${r}: ${list.slice(0, 40).join(" ")}${list.length > 40 ? " …" : ""}`);
console.log("\n  NAMED:");
for (const s of NAMED) {
  const rec = recs.get(s) ?? null;
  const o = g.mod.outlookFrom(s, rec, TODAY);
  const ev = (rec?.events ?? []).slice(0, 6).map((e) => `${e.periodEnd}@${e.announcedOn}(${e.basis ?? "?"})`).join(" ");
  console.log(`  ${s.padEnd(6)} kind=${o.kind}${o.reason ? `:${o.reason}` : ""} hedge="${o.hedge ?? ""}"`);
  console.log(`         record: ${rec ? `${rec.events.length} events, next=${JSON.stringify(rec.next)}, annual=${rec.annual}, at=${rec.at}` : "NONE"}`);
  if (ev) console.log(`         newest events: ${ev}`);
  const set = sets.get(s);
  if (set) console.log(`         set quarters: ${set.quarters.slice(0, 6).map((q) => `${q.fp} FY${q.fy} ${q.e}`).join(" · ")}`);
}
g.cleanup();

// ── #6 ──────────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(78)}\n#6 NEWEST-PERIOD NET MARGIN ABOVE 100%`);
const over = [];
for (const [s, set] of sets) {
  const q = set.quarters[0], y = set.years?.[0];
  const p = q && (!y || q.e >= y.e) ? q : y;
  if (!p) continue;
  const rev = X.valueOf(p, "revenue"), ni = X.valueOf(p, "netIncome");
  if (rev && ni !== null && rev > 0 && ni / rev > 1) {
    over.push(`${s.padEnd(6)} ${p.fp} FY${p.fy} (${p.e}) revenue ${(rev / 1e6).toFixed(1)}M · net income ${(ni / 1e6).toFixed(1)}M · ` +
      `margin ${(100 * ni / rev).toFixed(0)}% · revenue concept ${set.cc?.revenue ?? "(unrecorded)"} · derivation ${p.d?.[X.SEC_FIELD_KEYS.indexOf("revenue")] ?? "?"}`);
  }
}
console.log(`  ${over.length} SYMBOLS`);
for (const l of over) console.log(`  ${l}`);

// ── #2 ──────────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(78)}\n#2 FISCAL-YEAR LABEL vs THE FILER'S OWN fy (year ends Jan-Jun)`);
let lastAt = 0;
const getJson = async (url) => {
  const w = Math.max(0, lastAt + 125 - Date.now());
  if (w) await new Promise((r) => setTimeout(r, w));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  return res.ok ? res.json() : null;
};
const cands = [...sets].filter(([, set]) => {
  const ye = set.years?.[0]?.e;
  return ye && Number(ye.slice(5, 7)) <= 6 && set.quarters[0];
});
console.log(`  ${cands.length} candidates`);
const wrong = [], right = [], unread = [];
for (const [s, set] of cands) {
  const q = set.quarters[0];
  const facts = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${manifest.symbols[s].cik}.json`);
  if (!facts) { unread.push(s); continue; }
  // The filer's own fy for this period end: from the FIRST 10-Q/10-K that
  // reported a duration ending on it (later filings repeat it as a comparative
  // under their own fy).
  let first = null;
  for (const tags of Object.values(facts.facts ?? {})) for (const def of Object.values(tags))
    for (const rows of Object.values(def.units ?? {})) for (const r of rows) {
      if (r.end !== q.e || !r.start || !/^10-[QK]$/.test(r.form ?? "") || !r.fy) continue;
      if (!first || r.filed < first.filed) first = r;
    }
  if (!first) { unread.push(`${s}(no 10-Q/10-K row)`); continue; }
  const naming = X.fiscalYearOffset ? X.fiscalYearOffset(facts, set.years[0].e) : null;
  const line = `${s.padEnd(6)} ${q.e}: stored ${q.fp} FY${q.fy} · filer says ${first.fp} FY${first.fy} (${first.form} ${first.filed})` +
    (naming ? ` · offset vote ${naming.offset} from ${naming.basis ?? "nothing"} (${naming.agreeing}/${naming.disagreeing})` : "");
  (Number(first.fy) === q.fy ? right : wrong).push(line);
}
console.log(`  MATCH ${right.length} · MISMATCH ${wrong.length} · UNREAD ${unread.length}`);
for (const l of wrong) console.log(`  ${l}`);
if (unread.length) console.log(`  unread: ${unread.join(" ")}`);
