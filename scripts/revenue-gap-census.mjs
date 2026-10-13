// OPTION G, MEASURED ON EVERY REGISTRANT (#552 COWORK #219). READ-ONLY, SEC only,
// no credential, ≤8 requests/s.
//
// The SHIPPED extractor of this checkout, run three ways on one payload per filer:
//   S  the gap test disabled (revenueGapConcept finds nothing): exactly the
//      rule before option G, since a derived total exists only under G
//   G  as shipped here: the #192 test OR the gap-is-revenue test, floor kept
//   P  a PURE replacement: the #192 test removed, only the gap test left
// Prints one line per filer whose revenue moves S→G (the movers, with the
// newest quarter before → after and its gross margin both ways), and one per
// filer that P would treat differently from G (what a literal replacement of
// tests (a) and (b) would drop or add).
//   SYMBOLS="MELI,CEG,PAYX,LUNR" node scripts/revenue-gap-census.mjs
//   SHARD=1/3 node scripts/revenue-gap-census.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; revenue gap census)";
const [K, N] = (process.env.SHARD || "1/1").split("/").map(Number);
const BUDGET_MS = Number(process.env.BUDGET_MS || 27 * 60 * 1000);
const started = Date.now();
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const parts = (extract) => [
  readCodeOnly("lib/server/secFields.ts"), extract, strip("lib/server/fxRates.ts"), strip("lib/server/secCurrency.ts"), strip("lib/server/secFactCodec.ts"),
  "export { extractCompanyFacts, SEC_FIELD_INDEX, revenueGapConcept, filerTagsExcise };",
].join("\n");
const swap = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`anchor matched ${n} times, needs 1: ${from}`);
  return src.replace(from, to);
};
const EXTRACT = strip("lib/server/secExtract.ts");
const G = await lift(parts(EXTRACT));
const S = await lift(parts(swap(EXTRACT, "const hit = REVENUE_GAP_CONCEPTS.find(equals) ?? null;", "const hit = null;")));
const P = await lift(parts(swap(EXTRACT, "const shippedTest = !excise && ", "const shippedTest = false && ")));
const I = G.SEC_FIELD_INDEX;

const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const CAND = new Set(JSON.parse(fs.readFileSync("data/content-candidates.json", "utf8")).symbols.map((x) => x.symbol));
const only = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
const mine = only.length ? only : Object.keys(REG).sort().filter((s) => REG[s]?.cik).filter((_, i) => i % N === K - 1);
const seenCik = new Set();
let lastAt = 0;
async function get(url) {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
const v = (p, k) => p?.values?.[I[k]]?.val ?? null;
const d = (p, k) => p?.values?.[I[k]]?.derived ?? null;
const m = (x) => (x == null ? "—" : `${(x / 1e6).toFixed(1)}M`);
const gm = (p) => {
  const r = v(p, "revenue"), gp = v(p, "grossProfit") ?? (r != null && v(p, "costOfRevenue") != null ? r - v(p, "costOfRevenue") : null);
  return r && gp != null ? `${((gp / r) * 100).toFixed(1)}%` : "—";
};
const moves = (a, b) => {
  let n = 0, lost = 0, derived = 0;
  for (const [A, B] of [[a.quarters, b.quarters], [a.years, b.years]]) {
    for (const e of new Set([...A.map((p) => p.end), ...B.map((p) => p.end)])) {
      const pa = A.find((p) => p.end === e), pb = B.find((p) => p.end === e);
      if (v(pa, "revenue") !== v(pb, "revenue")) { n++; if (v(pb, "revenue") == null) lost++; if (d(pb, "revenue") === "computed") derived++; }
    }
  }
  return { n, lost, derived };
};
const newestQ = (r) => [...r.quarters].sort((x, y) => x.end.localeCompare(y.end)).at(-1);
const tally = { filers: 0, movers: 0, moversIn877: 0, pureDiffers: 0, ERROR: 0 };
for (const s of mine) {
  if (Date.now() - started > BUDGET_MS) break;
  const cik = String(REG[s].cik);
  if (seenCik.has(cik) && !only.length) continue;
  seenCik.add(cik);
  try {
    const facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`);
    tally.filers++;
    const a = S.extractCompanyFacts(s, facts), b = G.extractCompanyFacts(s, facts), c = P.extractCompanyFacts(s, facts);
    const sg = moves(a, b), gp = moves(b, c);
    const gap = G.revenueGapConcept(facts);
    if (sg.n) {
      tally.movers++;
      if (CAND.has(s)) tally.moversIn877++;
      const qa = newestQ(a), qb = newestQ(b);
      console.log(`MOVE ${s}${CAND.has(s) ? " [877]" : ""} gap=${gap ?? "—"} excise=${G.filerTagsExcise(facts)} | newest q ${qb?.end ?? "—"}: ${m(v(qa, "revenue"))} → ${m(v(qb, "revenue"))}; gross margin ${gm(qa)} → ${gm(qb)} | ${sg.n} periods move, ${sg.derived} derived, ${sg.lost} left unreported`);
    } else if (only.length) {
      console.log(`SAME ${s} gap=${gap ?? "—"} newest q ${newestQ(b)?.end ?? "—"} ${m(v(newestQ(b), "revenue"))}`);
    }
    if (gp.n) {
      tally.pureDiffers++;
      console.log(`PURE ${s}${CAND.has(s) ? " [877]" : ""} a literal replacement (gap test only) differs from G: ${gp.n} periods (newest q ${m(v(newestQ(b), "revenue"))} → ${m(v(newestQ(c), "revenue"))})`);
    }
  } catch (e) { tally.ERROR++; console.log(`ERROR ${s} ${String(e?.message ?? e).slice(0, 60)}`); }
}
console.log(`\nshard ${K}/${N}: ${mine.length} symbols | ${JSON.stringify(tally)} | ${Math.round((Date.now() - started) / 1000)}s`);
