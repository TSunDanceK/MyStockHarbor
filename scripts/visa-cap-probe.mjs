// WHY A SYMBOL'S SCREENER MARKET CAP IS "–" (#552 COWORK #216 §4: Visa).
// READS ONLY, despite the write- task prefix (the store read needs the credential).
// Redis: 1 GET (the stored fact set) + 2 HGET (the Pickers SEC row, the cover-review row) per symbol.
// Prints the stored cover, the shipped valuationInputs refusals, the Pickers
// row's stored refusals and shares, and the cover-review row (1 HGET). Then the
// cited-class path withClassCover takes for a mapped filer, step by step, with
// the SHIPPED pure functions only (parseCoverClasses, withFilingRates,
// coverFromClasses) on the newest 10-Q/10-K: NOT withClassCover itself, which
// records/clears the cover-review row and so would write.
//   relay task: write-cap-refusal-probe   SYMBOLS="V"
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const V = await import("../lib/server/secValuation.ts");
const { secFieldsHash } = await import("../lib/server/secFields.ts");
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; cap refusal probe)";
const TODAY = new Date().toISOString().slice(0, 10);
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const MAP = JSON.parse(fs.readFileSync("data/sec/share-classes.json", "utf8")).entries;
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const PICKERS = keyOf("lib/server/pickersSecFundamentals.ts", "PICKERS_SEC_KEY");
const SRC = readCodeOnly("lib/server/secCoverClasses.ts");
const FILL = readCodeOnly("lib/server/secFilingFill.ts");
const M = await lift([
  `const ENTRIES = ${JSON.stringify(MAP)};`,
  FILL.match(/^export const FILING_INSTANCE_MAX_BYTES = [^;]+;$/m)[0].replace(/^export /, ""),
  grabFunction(FILL, "pickInstanceName"),
  "function shareClassesFor(s) { return ENTRIES[s] ?? ENTRIES[s.replace('-', '.')] ?? null; }",
  grabFunction(SRC, "parseCoverClasses"),
  grabFunction(SRC, "parseClassRates"),
  grabFunction(SRC, "withFilingRates"),
  grabFunction(SRC, "coverFromClasses"),
  "export { parseCoverClasses, parseClassRates, withFilingRates, coverFromClasses, pickInstanceName, FILING_INSTANCE_MAX_BYTES };",
].join("\n"));
const get = async (u) => { await new Promise((x) => setTimeout(x, 130)); return fetch(u, { headers: { "User-Agent": UA } }); };
let commands = 0;
for (const s of (process.env.SYMBOLS || "V").split(/[,\s]+/).filter(Boolean)) {
  console.log(`\n== ${s}`);
  const set = await redis.get(`${FACTS}:${s}`); commands++;
  if (!set) console.log("  no stored set");
  else {
    console.log(`  stored set: hash ${set.h === secFieldsHash() ? "current" : "STALE"}; extracted ${new Date(set.at).toISOString().slice(0, 19)}Z`);
    console.log(`  stored cover: ${JSON.stringify(set.cover ?? null)}`);
    const r = V.valuationInputs(set, TODAY, { annualForm: REG[s]?.annualForm ?? null });
    console.log(`  valuationInputs: shares ${r.shares ? `${r.shares.val} as of ${r.shares.asOf}` : "null"}; refusals ${JSON.stringify(r.refusals)}`);
  }
  const row = await redis.hget(PICKERS, s); commands++;
  const o = typeof row === "string" ? JSON.parse(row) : row;
  console.log(`  Pickers SEC row: ${o ? `at ${o.at ?? o.updatedAt ?? "?"}; inputs.shares ${JSON.stringify(o.inputs?.shares ?? null)}; inputs.refusals ${JSON.stringify(o.inputs?.refusals ?? null)}` : "none"}`);
  const review = await redis.hget(keyOf("lib/server/secCoverReview.ts", "SEC_COVER_REVIEW_HASH"), s); commands++;
  console.log(`  cover-review row: ${JSON.stringify(review ?? null)}`);
  const cik = String(REG[s]?.cik ?? "");
  const subs = await (await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)).json();
  const r = subs.filings?.recent ?? {};
  const i = (r.form ?? []).findIndex((f) => f === "10-Q" || f === "10-K");
  console.log(`  newest 10-Q/10-K: ${r.form?.[i]} ${r.accessionNumber?.[i]} filed ${r.filingDate?.[i]}`);
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(r.accessionNumber?.[i]).replace(/-/g, "")}`;
  const items = (await (await get(`${base}/index.json`)).json()).directory?.item ?? [];
  const name = M.pickInstanceName(items.map((it) => String(it.name ?? "")));
  const size = Number(items.find((it) => it.name === name)?.size ?? 0);
  console.log(`  instance: ${name ?? "none"} (${size} bytes; limit ${M.FILING_INSTANCE_MAX_BYTES})`);
  if (!name || size > M.FILING_INSTANCE_MAX_BYTES) continue;
  const xml = await (await get(`${base}/${name}`)).text();
  const facts = M.parseCoverClasses(xml);
  console.log(`  per-class cover facts: ${facts.map((f) => `${f.member}=${f.val}@${f.asOf}`).join("; ") || "none"}`);
  const entry = MAP[s];
  if (!entry) { console.log("  no share-classes entry"); continue; }
  if (entry.rates) console.log(`  stated rates: ${JSON.stringify(M.parseClassRates(xml, entry.rates.concept))}`);
  const rated = M.withFilingRates(entry, xml);
  console.log(`  withFilingRates: ${rated.ok ? `ok ${JSON.stringify(rated.entry.weights)}` : `REFUSED — ${rated.why}`}`);
  if (rated.ok) {
    const out = M.coverFromClasses(facts, rated.entry, { accession: r.accessionNumber?.[i] ?? null, filed: r.filingDate?.[i] ?? null });
    console.log(`  coverFromClasses: ${out.ok ? `ok ${JSON.stringify(out.cover)}` : `REFUSED — ${out.why}`}`);
  }
}
console.log(`\nRedis commands used by this read: ${commands}`);
