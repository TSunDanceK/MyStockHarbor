// THE AUTOMATIC TWO-CLASS COVER PATH, ON LIVE FILINGS (#552 COWORK #37).
// For each symbol: the newest 10-Q/10-K, its per-class cover facts, the
// filing text's one-for-one sentence (if any), and what secCoverAuto decides.
// Runs the SHIPPED pure functions; fetches SEC itself. Read-only, no
// credential, no Redis. ≤8 requests/s.
//   SYMBOLS=SPCX,INIO node scripts/sec-cover-auto-probe.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; cover auto probe)";
const A = await import("../lib/server/secCoverAuto.ts");
const D = await import("../lib/server/secDescription.ts");
const FF = await import("../lib/server/secFilingFill.ts");
const CC = await lift([grabFunction(readCodeOnly("lib/server/secCoverClasses.ts"), "parseCoverClasses"), "export { parseCoverClasses };"].join("\n"));
const MAP = JSON.parse(fs.readFileSync("data/sec/share-classes.json", "utf8")).entries;
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const syms = (process.env.SYMBOLS || "SPCX,INIO,MAIR,CBRS,PS,AAPL,GOOGL,META").split(/[,\s]+/).filter(Boolean);
let lastAt = 0;
async function get(url, as = "json") {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} ${url.split("/").slice(-2).join("/")}`);
  return as === "json" ? res.json() : res.text();
}
for (const s of syms) {
  const cik = REG[s]?.cik;
  if (!cik) { console.log(`\n== ${s}: no CIK in registrants.json`); continue; }
  try {
    const r = (await get(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`)).filings?.recent ?? {};
    const i = (r.form ?? []).findIndex((f) => f === "10-Q" || f === "10-K");
    if (i < 0) { console.log(`\n== ${s}: no 10-Q/10-K`); continue; }
    const acc = r.accessionNumber[i];
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}`;
    const items = (await get(`${base}/index.json`)).directory?.item ?? [];
    const name = FF.pickInstanceName(items.map((it) => String(it.name ?? "")));
    const facts = name ? CC.parseCoverClasses(await get(`${base}/${name}`, "text")) : [];
    const newest = facts.map((f) => f.asOf).sort().at(-1);
    console.log(`\n== ${s} ${r.form[i]} ${acc} filed ${r.filingDate[i]} | map entry: ${MAP[s] ? "yes" : "no"}`);
    console.log(`  per-class cover facts on ${newest ?? "-"}: ${facts.filter((f) => f.asOf === newest).map((f) => `${f.member}=${f.val}`).join(", ") || "none"}`);
    if (facts.length) {
      const doc = r.primaryDocument[i];
      const text = D.filingText(await get(`${base}/${doc}`, "text"));
      const stmt = A.oneToOneStatement(text);
      // THE CANDIDATE SENTENCES, so a miss can be read rather than guessed at.
      if (process.env.SHOW) {
        const cands = text.replace(/\s+/g, " ").split(/(?<=[.;])\s+(?=[A-Z(])/).filter((x) => /Class\s+[A-Z]\b/.test(x) && /convert/i.test(x));
        for (const c of cands.slice(0, 8)) console.log(`    · ${c.slice(0, 320)}`);
        console.log(`    (${cands.length} sentence(s) naming a class and conversion)`);
      }
      console.log(`  1:1 statement: ${stmt ? JSON.stringify(stmt) : "none found"}`);
      const out = A.autoCoverFromClasses(facts, stmt, { accession: acc, filed: r.filingDate[i] });
      console.log(`  auto: ${out.ok ? `SUM ${out.cover.val} as of ${out.cover.asOf}` : `REVIEW — ${out.why}`}`);
    }
  } catch (e) { console.log(`\n== ${s}: ERROR ${String(e?.message ?? e).slice(0, 120)}`); }
}
