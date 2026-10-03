// CITABLE 20-F / 40-F COVER ROWS FOR #86b (#552 CODE-A #93/#98, COWORK #92).
// READ-ONLY. For every Pickers name that files a 20-F or 40-F and is refused a
// market cap for "no cover count" or "stale", read the latest 20-F/40-F cover
// sentence ("number of outstanding shares of each of the issuer's classes ...
// as of the close of the period") and print what a cited data row needs:
// form, accession, filed date, period, the quoted sentence (SEC text), and each
// number with the class words just before it. Nothing is written; the rows are
// reviewed by hand before any goes into data/sec/.
//
// SEC: 1 submissions + 1 document per name, <=4/s, our User-Agent, OUTSIDE the
// job windows (03:55-06:50, 16:15-16:50 UTC). Stops on 429/403. SEC values
// only; no price, no FMP data.
//   relay task: write-foreign-cover-rows
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const P = await import("../lib/server/pickersSecFundamentals.ts");
const V = await import("../lib/server/secValuation.ts");
const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; cover rows probe)";
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const reg = (s) => REG[s] ?? REG[s.replace(".", "-")] ?? REG[s.replace("-", ".")];
const TODAY = new Date().toISOString().slice(0, 10);

const hh = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
if ((hh >= 3 * 60 + 55 && hh < 6 * 60 + 50) || (hh >= 16 * 60 + 15 && hh < 16 * 60 + 50)) {
  console.log("Inside an SEC job window: nothing requested. Re-dispatch outside 03:55-06:50 and 16:15-16:50 UTC.");
  process.exit(0);
}

let commands = 0, secRequests = 0;
const get = async (url) => {
  secRequests++;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  await new Promise((x) => setTimeout(x, 260));
  if (r.status === 429 || r.status === 403) { console.log(`SEC ${r.status}: stopping, nothing more requested`); process.exit(2); }
  return r.ok ? r.text() : null;
};

// The stored SEC Pickers rows' own fields (pickersBuilder imports next/server).
const universe = [...new Set(((await redis.hkeys(P.PICKERS_SEC_KEY)) ?? []).map((x) => String(x).toUpperCase()))]; commands++;
const rows = await P.readSecPickerRows(universe); commands++;
const targets = [];
for (const s of universe) {
  const row = rows.get(s);
  const form = reg(s)?.annualForm;
  if (!row || !(form === "20-F" || form === "40-F")) continue;
  const f = V.marketCap({ shares: row.inputs.shares, eps: null, refusals: row.inputs.refusals }, null);
  if (f && !f.ok && (f.why === "no-cover-share-count" || f.why === "share-count-is-stale")) targets.push({ s, form, why: f.why });
}

const numRe = /(\d{1,3}(?:[,.]\d{3}){2,})/g;
const out = [];
for (const t of targets) {
  const cik = String(reg(t.s).cik).padStart(10, "0");
  const sub = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const rec = sub ? JSON.parse(sub).filings?.recent : null;
  const i = rec ? rec.form.findIndex((f) => f === "20-F" || f === "40-F") : -1;
  if (i < 0) { out.push({ symbol: t.s, outcome: "no-annual-report-in-recent-list" }); continue; }
  const acc = rec.accessionNumber[i], doc = rec.primaryDocument[i];
  const html = await get(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}/${doc}`);
  const text = (html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'").replace(/\s+/g, " ");
  const at = text.search(/number of outstanding shares of each of the issuer/i);
  const tail = at >= 0 ? text.slice(at, at + 900) : "";
  const cut = tail.search(/Indicate by check mark|Yes\s*☐|Yes\s*☒/i);
  const quote = (cut > 0 ? tail.slice(0, cut) : tail.slice(0, 600)).trim();
  const numbers = [...quote.matchAll(numRe)].map((m) => ({
    n: Number(m[1].replace(/[,.]/g, "")),
    // The class words around the number: whatever follows it up to the next
    // number or 80 chars, and the 60 chars before it.
    before: quote.slice(Math.max(0, m.index - 60), m.index).trim(),
    after: quote.slice(m.index + m[1].length, m.index + m[1].length + 80).split(numRe)[0].trim(),
  })).filter((x) => x.n >= 1e6);
  const period = rec.reportDate[i];
  out.push({
    symbol: t.s, cik, form: rec.form[i], accession: acc, document: doc, filed: rec.filingDate[i], period,
    current: V.coverIsCurrent(period, TODAY), todaysReason: t.why, quote, numbers,
  });
}
console.log(`20-F/40-F Pickers names refused for no-cover or stale: ${targets.length}`);
console.log("ROWS (JSON, one per line):");
for (const r of out) console.log(JSON.stringify(r));
console.log(`Redis commands ${commands} (+1 HMGET in readSecPickerRows), read-only · SEC requests ${secRequests} at <=4/s`);
