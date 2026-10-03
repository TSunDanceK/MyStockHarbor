// WHY V'S CITED share-classes.json ROW STILL READS STALE (#552 CODE-A #93 item
// 2, for the #86b PR). READ-ONLY: runs secCoverClasses' own pure steps
// (parseCoverClasses -> withFilingRates -> coverFromClasses) on the newest
// 10-Q/10-K instance, and prints each step's outcome. No Redis write (the
// review list is not touched); no FMP data. SEC: 3 requests at <=4/s, outside
// the job windows (refuses inside them). Symbols: env SYMBOLS, default V.
//   relay task: write-v-class-trace
import "./lib/register-ts-app.mjs";
import fs from "node:fs";

const C = await import("../lib/server/secCoverClasses.ts");
const { pickInstanceName } = await import("../lib/server/secFilingFill.ts");
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; class cover trace)";
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const hh = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
if ((hh >= 235 && hh < 410) || (hh >= 975 && hh < 1010)) { console.log("Inside an SEC job window: nothing requested."); process.exit(0); }
let n = 0;
const get = async (url) => {
  n++;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  await new Promise((x) => setTimeout(x, 260));
  if (r.status === 429 || r.status === 403) { console.log(`SEC ${r.status}: stopping`); process.exit(2); }
  return r;
};
for (const sym of (process.env.SYMBOLS || "V").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)) {
  const cik = String(REG[sym]?.cik ?? "").padStart(10, "0");
  const entry = C.shareClassesFor(sym);
  console.log(`\n${sym} cik ${cik}: map entry ${entry ? `listed ${entry.listed}; weights ${JSON.stringify(entry.weights)}; rates ${JSON.stringify(entry.rates ?? null)}` : "none"}`);
  const subs = await (await get(`https://data.sec.gov/submissions/CIK${cik}.json`)).json();
  const r = subs.filings?.recent ?? {};
  const i = (r.form ?? []).findIndex((f) => f === "10-Q" || f === "10-K");
  const acc = r.accessionNumber?.[i];
  console.log(`  newest 10-Q/10-K: ${r.form?.[i]} ${acc} filed ${r.filingDate?.[i]} period ${r.reportDate?.[i]}`);
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(acc).replace(/-/g, "")}`;
  const idx = await (await get(`${base}/index.json`)).json();
  const names = (idx.directory?.item ?? []).map((it) => String(it.name ?? ""));
  const inst = pickInstanceName(names);
  console.log(`  instance: ${inst ?? "none found"}`);
  if (!inst) continue;
  const xml = await (await get(`${base}/${inst}`)).text();
  const facts = C.parseCoverClasses(xml);
  console.log(`  per-class cover facts: ${facts.length ? facts.map((f) => `${f.member} ${f.val} @${f.asOf}`).join("; ") : "none"}`);
  if (!entry) continue;
  const rated = C.withFilingRates(entry, xml);
  console.log(`  withFilingRates: ${rated.ok ? `ok; weights ${JSON.stringify(rated.entry.weights)}` : `REFUSED — ${rated.why}`}`);
  if (!rated.ok) continue;
  const out = C.coverFromClasses(facts, rated.entry, { accession: acc, filed: r.filingDate?.[i] ?? null });
  console.log(`  coverFromClasses: ${out.ok ? `ok; ${out.cover.val} as of ${out.cover.asOf}` : `REFUSED — ${out.why}`}`);
}
console.log(`\nSEC requests ${n} at <=4/s; Redis 0`);
