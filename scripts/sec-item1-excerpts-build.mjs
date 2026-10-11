// THE LONGER ITEM 1 EXCERPT, FOR NAMED SYMBOLS (#552 COWORK #32/#37).
// The SAME locator as the description build (lib/server/secDescription.ts,
// lifted), then itemExcerpt: the section's opening ~6,000 characters. Prints
// one `EXCERPT {json}` line per symbol, [form, filedOn, accession, text], which
// is assembled into data/sec/item1-excerpts.json and reviewed in the PR (the
// artifact host is refused to the sandbox). SEC text only; read-only, no
// credential. ≤8 requests/s.
//   SYMBOLS="QCOM,LRCX" node scripts/sec-item1-excerpts-build.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; item 1 excerpts)";
const desc = await lift(readCodeOnly("lib/server/secDescription.ts"));
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const syms = (process.argv[2] || process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
let lastAt = 0;
async function get(url, as = "json") {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${url.replace(/^https:\/\/[^/]+/, "")}`);
  return as === "json" ? res.json() : res.text();
}
const ANNUAL = ["10-K", "10-K405", "10-KT", "20-F"];
for (const s of syms) {
  const reg = REG[s] ?? REG[s.replace(".", "-")];
  try {
    if (!reg?.cik) throw new Error("no CIK");
    const sub = await get(`https://data.sec.gov/submissions/CIK${reg.cik}.json`);
    const r = sub.filings?.recent ?? {};
    const i = (r.form ?? []).findIndex((f) => ANNUAL.includes(f));
    if (i < 0) throw new Error("no 10-K/20-F in recent filings");
    const html = await get(`https://www.sec.gov/Archives/edgar/data/${Number(reg.cik)}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}`, "text");
    const loc = desc.locateSection(desc.filingText(html), r.form[i]);
    if (!loc.found) throw new Error(loc.why);
    console.log(`EXCERPT ${JSON.stringify({ symbol: s, row: [r.form[i], r.filingDate[i], r.accessionNumber[i], desc.itemExcerpt(loc.body)] })}`);
  } catch (e) { console.log(`MISS ${s}: ${String(e?.message ?? e).slice(0, 160)}`); }
}
