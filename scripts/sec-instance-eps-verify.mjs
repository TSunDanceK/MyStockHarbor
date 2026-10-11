// VERIFY THE FILING-BASED TTM EPS ON REAL FILINGS (#552 COWORK #33).
// Runs the SHIPPED parseDurationFacts / pickMember / ttmFromInstances
// (lib/server/secInstanceEps.ts, lifted) over the newest 10-Q and 10-K of each
// symbol and prints the twelve-month EPS with its basis, or the refusal.
// SEC data only; read-only, no credential.
//   node scripts/sec-instance-eps-verify.mjs "V,COST,NFLX,BRK.B"
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; instance eps verify)";
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const MAP = JSON.parse(fs.readFileSync("data/sec/share-classes.json", "utf8")).entries;
const SRC = readCodeOnly("lib/server/secInstanceEps.ts");
const VAL = readCodeOnly("lib/server/secValuation.ts");
const constOf = (src, name) => src.match(new RegExp(`^export const ${name}[^=]*= [\\s\\S]*?;$`, "m"))[0].replace(/^export /, "");
const M = await lift([
  constOf(VAL, "Q4_SHARE_BASIS_TOLERANCE"),
  constOf(SRC, "INSTANCE_EPS_CONCEPTS").replace(/: \{[^=]*\}\[\] =/, " ="),
  SRC.match(/^const SHARE_CONCEPTS = [\s\S]*?^\};$/m)[0],
  SRC.match(/^const WANTED = .*$/m)[0],
  "const DAY = 86_400_000;",
  SRC.match(/^const days = .*$/m)[0],
  constOf(SRC, "CHAIN_SLACK_DAYS"), constOf(SRC, "COMPARATIVE_SLACK_DAYS"),
  grabFunction(SRC, "parseDurationFacts"), grabFunction(SRC, "pickMember"), grabFunction(SRC, "ttmFromInstances"),
  "export { parseDurationFacts, ttmFromInstances };",
].join("\n"));

const DEFAULT = "BRK.B,V,XOM,COST,NFLX,PEP,NOW,CRWD,BKNG,C,ONDS,SJM,BKR,AZO,KKR,COF,LEN,AAP,DPZ,LYB,HSY,SATA,RY,WES,VTRS,PS,UHAL,SUN,TD,WTRG,WMG,TECK,SN,QXO,CQP,FERG,PAA,JEF,ATHS,COKE,JHX,FWONK,CRWV,PNFP,MPLX,INIO,ALNY,MFC,MDB,MAIR,TPL";
const syms = (process.argv[2] || DEFAULT).split(",").map((s) => s.trim()).filter(Boolean);
const get = async (u) => { await new Promise((x) => setTimeout(x, 130)); return fetch(u, { headers: { "User-Agent": UA } }); };
const cited = (s) => { const e = MAP[s] ?? MAP[s.replace("-", ".")]; return e ? e.epsMember ?? e.listed : null; };
const out = {};
for (const s of syms) {
  const cik = String(REG[s]?.cik ?? REG[s.replace(".", "-")]?.cik ?? "");
  try {
    const subs = await (await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)).json();
    const r = subs.filings?.recent ?? {};
    const qi = (r.form ?? []).findIndex((f) => f === "10-Q"), ki = (r.form ?? []).findIndex((f) => f === "10-K");
    if (qi < 0 || ki < 0) { out[s] = `REFUSE no ${qi < 0 ? "10-Q" : "10-K"} (forms: ${[...new Set((r.form ?? []).slice(0, 12))].join(",")})`; continue; }
    if (qi > ki) { out[s] = "SKIP the newest periodic filing is the 10-K (the year is the TTM)"; continue; }
    const read = async (i) => {
      const accession = r.accessionNumber[i];
      const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}`;
      const idx = await (await get(`${base}/index.json`)).json();
      const name = (idx.directory?.item ?? []).map((it) => it.name).find((n) => /_htm\.xml$/i.test(n))
        ?? (idx.directory?.item ?? []).map((it) => it.name).find((n) => /\.xml$/i.test(n) && !/(FilingSummary|_cal|_def|_lab|_pre)\.xml$/i.test(n));
      return name ? { accession, facts: M.parseDurationFacts(await (await get(`${base}/${name}`)).text()) } : null;
    };
    const q = await read(qi), k = await read(ki);
    if (!q || !k) { out[s] = "REFUSE no instance"; continue; }
    const t = M.ttmFromInstances(k.facts, q.facts, cited(s), { k: k.accession, q: q.accession });
    out[s] = t.ok
      ? `OK ${t.eps.val} (${t.eps.kind}${t.eps.member ? ", " + t.eps.member : ""}, ${t.eps.concept}) FY to ${t.eps.yearEnd} + ${t.eps.ytdDays}d to ${t.eps.periodEnd} [10-K ${t.eps.k}, 10-Q ${t.eps.q}]`
      : `REFUSE ${t.why}`;
  } catch (e) { out[s] = `ERROR ${String(e?.message ?? e).slice(0, 100)}`; }
}
let ok = 0;
for (const [s, v] of Object.entries(out)) { if (v.startsWith("OK")) ok++; console.log(`  ${s.padEnd(6)} ${v}`); }
console.log(`\nfilings give twelve months for ${ok} of ${syms.length}`);
